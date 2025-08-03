import express from "express";
import { exec } from "child_process";
import path from "path";
import fs from "fs";
import axios from "axios";
import mime from "mime-types";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import { authorize } from "./auth.js";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper: Extract Instagram post ID
function extractPostId(url) {
    const regex = /instagram\.com\/p\/([^/?]+)/;
    const match = url ? url.match(regex) : null;
    return (match && match[1]) ? match[1] : null;
}

// Helper: Upload single file to Google Drive
const uploadToDrive = async (filePath, fileName, folderId) => {
    const auth = await authorize();
    const drive = google.drive({ version: 'v3', auth });

    const fileMetadata = {
        name: fileName,
        parents: [folderId],
    };
    const media = {
        mimeType: mime.lookup(filePath) || 'application/octet-stream',
        body: fs.createReadStream(filePath),
    };

    const response = await drive.files.create({
        resource: fileMetadata,
        media,
        fields: 'id, name, webViewLink, webContentLink',
    });

    console.log("✅ Uploaded:", response.data.name);
    return response.data;
};

// Helper: Clean up folder
function safeCleanup(dirPath) {
    try {
        fs.rmSync(dirPath, { recursive: true, force: true });
        console.log("🧹 Cleaned up temp directory");
    } catch (err) {
        console.error("Failed to clean temp folder:", err.message);
    }
}

// Endpoint: OAuth callback (not used in flow if token already stored)
app.get("/oauth2callback", async (req, res) => {
    const code = req.query.code;
    if (!code) {
        return res.status(400).send("Missing `code` query parameter.");
    }
    res.send("OAuth callback hit, but not needed if tokens are stored.");
});

// Endpoint: Main fetch + upload flow
app.get("/fetchLink", async (req, res) => {
    const instagramUrl = req.query.url;
    const postID = extractPostId(instagramUrl);

    if (!postID) {
        return res.status(400).send("Invalid Instagram post URL.");
    }

    const tempdir = path.join(__dirname, `-${postID}`);
    const instaloaderCommand = `instaloader -- -${postID}`;

    exec(instaloaderCommand, async (error, stdout, stderr) => {
        if (error) {
            console.error(`❌ Instaloader error: ${error.message}`);
            safeCleanup(tempdir);
            return res.status(500).send("Error downloading media.");
        }

        console.log("📥 Instaloader Output:\n", stdout);

        try {
            const files = fs.readdirSync(tempdir);
            const mediaFiles = files.filter(file =>
                fs.statSync(path.join(tempdir, file)).isFile()
            );

            if (mediaFiles.length === 0) {
                throw new Error("No media files found.");
            }

            const driveFolderId = '1LrHRR9QqE33wp-ZLL8YcnFLGb3s9rI0Z';
            const uploadedFiles = [];

            for (const file of mediaFiles) {
                const filePath = path.join(tempdir, file);
                const uploaded = await uploadToDrive(filePath, file, driveFolderId);
                uploadedFiles.push(uploaded);
            }

            safeCleanup(tempdir);

            return res.status(200).send({
                message: "All files uploaded successfully!",
                files: uploadedFiles
            });

        } catch (err) {
            console.error("❌ Upload error:", err.message);
            safeCleanup(tempdir);
            return res.status(500).send(`Upload failed: ${err.message}`);
        }
    });
});

app.listen(process.env.PORT || 8000, () => {
    console.log("🚀 Upload Server running on port:", process.env.PORT || 8000);
});
