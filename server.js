import { configDotenv } from "dotenv";
import app from "./app.js";
import { ECSClient, RunTaskCommand } from "@aws-sdk/client-ecs";

configDotenv();
app.listen(process.env.PORT || 3000, () => {
  console.log(`🚀 Server running on port ${process.env.PORT || 3000}`);
});

const ecs = new ECSClient({ region: process.env.AWS_DEFAULT_REGION });

app.get("/trigger", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "Missing ?url" });

  try {
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
            environment: [
              { name: "INSTAGRAM_URL", value: url },
            ],
          },
        ],
      },
    });

    const result = await ecs.send(task);
    res.json({
      status: "✅ ECS Task started",
      taskArn: result?.tasks?.[0]?.taskArn || null,
    });
  } catch (err) {
    console.error("❌ ECS error:", err.message);
    res.status(500).json({ error: err.message });
  }
});