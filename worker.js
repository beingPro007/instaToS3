import { exec } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { configDotenv } from "dotenv";
import { readFile } from "fs/promises";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { ECSClient, RunTaskCommand } from "@aws-sdk/client-ecs";
import mime from "mime-types"

configDotenv();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const s3 = new S3Client({ region: process.env.AWS_DEFAULT_REGION });
const ecs = new ECSClient({ region: process.env.AWS_DEFAULT_REGION });

function extractPostId(url) {
  const match = url?.match(/instagram\.com\/p\/([^/?]+)/);
  return match?.[1] || null;
}

async function uploadToS3({ bucketName, key, filePath }) {
  const body = await readFile(filePath);
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: body,
  });
  return s3.send(command);
}

function safeCleanup(dirPath) {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
    console.log("🧹 Cleaned up:", dirPath);
  } catch (err) {
    console.error("❌ Cleanup error:", err.message);
  }
}

async function processInstagramPost(instagramUrl) {
  const postID = extractPostId(instagramUrl);
  if (!postID) {
    throw new Error("Invalid Instagram URL");
  }

  const tempDir = path.join(__dirname, `-${postID}`);
  const instaloaderCommand = `instaloader -- -${postID}`;

  return new Promise((resolve, reject) => {
    exec(instaloaderCommand, async (error, stdout, stderr) => {
      if (error) {
        safeCleanup(tempDir);
        return reject(new Error("Failed to download media"));
      }

      try {
        if (!fs.existsSync(tempDir)) {
          throw new Error("Download folder missing");
        }

        const files = fs.readdirSync(tempDir).filter(f =>
          fs.statSync(path.join(tempDir, f)).isFile()
        );

        if (files.length === 0) {
          throw new Error("No media files found");
        }

        const uploads = [];
        const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/svg+xml'];

        for (const file of files) {
          const filePath = path.join(tempDir, file);
          const mimeType = mime.lookup(file);
          if (!allowedMimeTypes.includes(mimeType)) {
            continue;
          }
          const key = `${file}`;
          await uploadToS3({
            bucketName: process.env.AWS_BUCKET_NAME,
            key,
            filePath,
          });
          uploads.push(key);
        }

        safeCleanup(tempDir);
        resolve(uploads);
      } catch (err) {
        safeCleanup(tempDir);
        reject(err);
      }
    });
  });
}

async function triggerECSTask(url) {
  if (!url) throw new Error("Missing url");
  const task = new RunTaskCommand({
    cluster: process.env.ECS_CLUSTER,
    launchType: "FARGATE",
    taskDefinition: process.env.ECS_TASK_DEF,
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: [process.env.ECS_SUBNET],
        securityGroups: [process.env.ECS_SECURITY_GROUP],
        assignPublicIp: "ENABLED",
      },
    },
    overrides: {
      containerOverrides: [
        {
          name: process.env.CONTAINER_NAME,
          environment: [{ name: "INSTAGRAM_URL", value: url }],
        },
      ],
    },
  });

  const result = await ecs.send(task);
  return result?.tasks?.[0]?.taskArn || null;
}

export {
  extractPostId,
  uploadToS3,
  safeCleanup,
  processInstagramPost,
  triggerECSTask,
};
