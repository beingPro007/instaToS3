import os
import modal
from fastapi import Query, HTTPException

# Create Modal app
app = modal.App("insta-to-s3-server")
insta_ecs_secrets = modal.Secret.from_name("insta-ecs-secrets")

image = modal.Image.debian_slim().pip_install(
    "boto3",
    "fastapi",
)

# ECS client
@app.function(image=image, secrets=[insta_ecs_secrets])
@modal.fastapi_endpoint(method="POST")
async def trigger(url: str = Query(..., description="URL to process")):
    """
    Modal FastAPI endpoint to trigger an ECS Fargate task
    """
    import boto3

    ecs_client = boto3.client(
        "ecs",
        region_name=os.getenv("AWS_DEFAULT_REGION"),
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
    )

    if not url:
        raise HTTPException(status_code=400, detail="Missing ?url")

    try:
        response = ecs_client.run_task(
            cluster=os.getenv("ECS_CLUSTER"),
            launchType="FARGATE",
            taskDefinition=os.getenv("ECS_TASK_DEF"),
            networkConfiguration={
                "awsvpcConfiguration": {
                    "subnets": [os.getenv("ECS_SUBNET")],
                    "securityGroups": [os.getenv("ECS_SECURITY_GROUP")],
                    "assignPublicIp": "ENABLED",
                }
            },
            overrides={
                "containerOverrides": [
                    {
                        "name": os.getenv("CONTAINER_NAME"),
                        "environment": [
                            {"name": "INSTAGRAM_URL", "value": url},
                            {"name": "OPEN_AI_API_KEY", "value": os.getenv("OPEN_AI_API_KEY")},
                        ],
                    }
                ]
            },
        )

        task_arn = response.get("tasks", [{}])[0].get("taskArn")
        return {"status": "✅ ECS Task started", "taskArn": task_arn}

    except Exception as e:
        print("❌ ECS error:", str(e))
        raise HTTPException(status_code=500, detail=str(e))
