import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { configDotenv } from "dotenv";

configDotenv();

const s3 = new S3Client({region: process.env.AWS_DEFAULT_REGION });
const lambda = new LambdaClient({region: process.env.AWS_DEFAULT_REGION });

const BUCKET_NAME = process.env.AWS_BUCKET_NAME;
const LAMBDA_FUNCTION_NAME = "s3Categorization";

async function processAllImages() {
  console.log("Starting to process images in configNeeded/ folder...");
  let continuationToken;
  let imageCount = 0;

  do {
    const listCommand = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: "configNeeded/",
      ContinuationToken: continuationToken,
    });

    const listResponse = await s3.send(listCommand);

    if (!listResponse.Contents || listResponse.Contents.length === 0) {
      console.log("No images found to process.");
      return;
    }

    const invocationPromises = listResponse.Contents.map(async (obj) => {
      // Ignore the folder itself
      if (obj.Key.endsWith('/')) return;

      const payload = {
        bucket: BUCKET_NAME,
        key: obj.Key,
      };

      const invokeCommand = new InvokeCommand({
        FunctionName: LAMBDA_FUNCTION_NAME,
        InvocationType: "Event",
        Payload: JSON.stringify(payload),
      });

      try {
        await lambda.send(invokeCommand);
        imageCount++;
      } catch (err) {
        console.error(`Failed to invoke Lambda for ${obj.Key}`, err);
      }
    });

    await Promise.all(invocationPromises);
    continuationToken = listResponse.NextContinuationToken;

  } while (continuationToken);

  console.log(`✅ Successfully triggered Lambda function for ${imageCount} images.`);
}

processAllImages();