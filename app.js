import express from "express";
import { configDotenv } from "dotenv";
import cors from "cors";

configDotenv();

const app = express();

const isProd = process.env.NODE_ENV === "production";

app.use(cors({
  origin: isProd
    ? process.env.CORS_ORIGIN || "*"
    : "*",
}));

export default app;
