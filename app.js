import express from "express";
import { configDotenv } from "dotenv";
import cors from "cors";    

configDotenv();

const app = express();

app.use(cors({
    origin: "*"
}))

export default app;