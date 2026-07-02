# Alibaba Cloud Deployment Guide (Proof of Deployment for Track 4)

To satisfy the **Track 4: Autopilot Agent** hackathon deployment scoring requirement, follow these step-by-step instructions to run Grada Autopilot on **Alibaba Cloud** (ECS instance or Alibaba Cloud Workbench).

---

## Option 1: Fast Deployment via Alibaba Cloud Workbench (Recommended)

Alibaba Cloud Workbench provides a built-in cloud terminal connected directly to your Alibaba Cloud infrastructure.

### Step 1: Open Alibaba Cloud Workbench

1. Log into your [Alibaba Cloud Console](https://home.console.aliyun.com/).
2. Open **Cloud Shell / Cloud Workbench** from the top right navigation bar.

### Step 2: Clone & Configure Repo

Run the following commands in your cloud terminal:

```bash
# 1. Clone the repository
git clone https://github.com/arnavbee/grada-qwen-autopilot.git
cd grada-qwen-autopilot/apps/api

# 2. Set up environment variables
export AI_PROVIDER=qwen
export QWEN_API_KEY="your-dashscope-api-key-here"
export QWEN_BASE_URL="https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
export QWEN_MODEL="qwen3.7-plus"
```

### Step 3: Run the Backend Service

You can launch the API server directly or via Docker:

#### Direct Run (Fastest):

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -e .
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

#### Or run via Docker:

```bash
docker build -t grada-api:latest .
docker run -d -p 8000:8000 \
  -e AI_PROVIDER=qwen \
  -e QWEN_API_KEY="$QWEN_API_KEY" \
  -e QWEN_BASE_URL="$QWEN_BASE_URL" \
  -e QWEN_MODEL="$QWEN_MODEL" \
  --name grada-api grada-api:latest
```

---

## Option 2: Deployment on Alibaba Cloud ECS Instance

If deploying on a dedicated Elastic Compute Service (ECS) instance (Ubuntu/Debian or Aliyun Linux):

1. **SSH into your ECS Instance**:
   ```bash
   ssh root@<your-ecs-public-ip>
   ```
2. **Install Docker** (if not installed):
   ```bash
   curl -fsSL https://get.docker.com -o get-docker.sh && sh get-docker.sh
   ```
3. **Clone & Run Container**:
   ```bash
   git clone https://github.com/arnavbee/grada-qwen-autopilot.git
   cd grada-qwen-autopilot/apps/api
   docker build -t grada-api:latest .
   docker run -d --restart=always -p 8000:8000 \
     -e AI_PROVIDER=qwen \
     -e QWEN_API_KEY="your-dashscope-api-key" \
     -e QWEN_BASE_URL="https://dashscope-intl.aliyuncs.com/compatible-mode/v1" \
     -e QWEN_MODEL="qwen3.7-plus" \
     --name grada-api grada-api:latest
   ```

---

## Step 4: Verification & Screen Recording (Scoring Evidence)

Once started, verify the live health endpoint:

```bash
curl http://localhost:8000/api/v1/health
```

**Expected Output:**

```json
{ "status": "ok" }
```

### How to Record Your 10-Second Proof:

1. Open your screen recorder (Loom, QuickTime, OBS).
2. Show your Alibaba Cloud Workbench / ECS console header showing your Alibaba Cloud account.
3. Show the terminal running `curl http://localhost:8000/api/v1/health` returning `{"status":"ok"}`.
4. Show the API interactive Swagger documentation at `http://<ip-or-localhost>:8000/docs`.
5. Attach this screenshot/recording to your Devpost project submission under "Proof of Deployment on Alibaba Cloud".
