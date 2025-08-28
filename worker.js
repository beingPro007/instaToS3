import { exec } from "child_process";
import { readFile, readdir, stat, rm } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { configDotenv } from "dotenv";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { ECSClient, RunTaskCommand } from "@aws-sdk/client-ecs";
import mime from "mime-types";
import sharp from "sharp";
import OpenAI from "openai";
import {retryWithBackoff, delay} from "./utils/retry.js";
configDotenv();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const s3 = new S3Client({ region: process.env.AWS_DEFAULT_REGION });
const ecs = new ECSClient({ region: process.env.AWS_DEFAULT_REGION });
const openai = new OpenAI();

async function openAIImageClassification(filePath) {
  const compressedPath = filePath.replace(/(\.[^.]+)$/, "-tiny.jpg");
  await sharp(filePath)
    .resize({ width: 256, height: 256, fit: "inside" })
    .jpeg({ quality: 70 })
    .toFile(compressedPath);

  const mimeType = mime.lookup(compressedPath) || "image/jpeg";
  const base64Content = await readFile(compressedPath, { encoding: "base64" });

  return retryWithBackoff(async () => {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Classify the main subject of this image into exactly ONE of the following categories:
- nature
- people
- anime
- marvel
- gods
- cars
- arts
- objects
- misc

Rules:
1. Return ONLY the single category word.
2. Do not invent new categories.
3. If unsure, choose "misc".`,
            },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${base64Content}` },
            },
          ],
        },
      ],
    });

    let label = response.choices[0].message.content;
    if (Array.isArray(label)) {
      label = label.map((c) => c.text || "").join("");
    }
    return label.trim().toLowerCase();
  });
}

function extractPostId(url) {
  const match = url?.match(/instagram\.com\/p\/([^/?]+)/);
  return match?.[1] || null;
}

async function uploadToS3({ bucketName, key, filePath }) {
  const body = await readFile(filePath);
  return retryWithBackoff(async () => {
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
    });
    return s3.send(command);
  });
}

async function safeCleanup(dirPath) {
  try {
    await rm(dirPath, { recursive: true, force: true });
  } catch {}
}

async function processInstagramPost(instagramUrl) {
  const postID = extractPostId(instagramUrl);
  if (!postID) throw new Error("Invalid Instagram URL");
  const tempDir = path.join(__dirname, `-${postID}`);
  const instaloaderCommand = `instaloader -- -${postID}`;

  return new Promise((resolve, reject) => {
    exec(instaloaderCommand, async (error) => {
      if (error) {
        await safeCleanup(tempDir);
        return reject(new Error("Failed to download media"));
      }

      try {
        const allFiles = await readdir(tempDir);
        const files = (
          await Promise.all(
            allFiles.map(async (f) => {
              const stats = await stat(path.join(tempDir, f));
              return stats.isFile() ? f : null;
            })
          )
        ).filter(Boolean);

        if (files.length === 0) throw new Error("No media files found");

        const uploads = [];
        const allowedMimeTypes = ["image/jpeg", "image/png"];

        for (const file of files) {
          const filePath = path.join(tempDir, file);
          const mimeType = mime.lookup(file);
          if (!allowedMimeTypes.includes(mimeType)) continue;

          const resizedFilePath = path.join(tempDir, `resized-${file}`);
          await sharp(filePath)
            .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
            .toFile(resizedFilePath);

          const label = await openAIImageClassification(resizedFilePath);
          const key = `${label}/${file}`;

          await uploadToS3({
            bucketName: process.env.AWS_BUCKET_NAME,
            key,
            filePath,
          });

          uploads.push(key);
          await delay(3000);
        }

        await safeCleanup(tempDir);
        resolve(uploads);
      } catch (err) {
        await safeCleanup(tempDir);
        reject(err);
      }
    });
  });
}

async function triggerECSTask(url) {
  if (!url) throw new Error("Missing url");

  return retryWithBackoff(async () => {
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
  });
}


export {
  extractPostId,
  uploadToS3,
  safeCleanup,
  processInstagramPost,
  triggerECSTask,
  openAIImageClassification,
  retryWithBackoff,
};
