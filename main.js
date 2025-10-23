import { processInstagramPost } from "./worker.js";

(async () => {
  try {
    const url = process.env.INSTAGRAM_URL;
    if (!url) throw new Error("INSTAGRAM_URL env not set");
    const uploadedFiles = await processInstagramPost(url);
    console.log("Uploaded files:", uploadedFiles);
  } catch (error) {
    console.error("Error processing Instagram post:", error);
    process.exit(1);
  }
})();