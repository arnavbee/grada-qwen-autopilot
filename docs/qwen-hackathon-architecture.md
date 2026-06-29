# Grada Autopilot Architecture

Grada Autopilot is a Track 4 Autopilot Agent submission for the Global AI Hackathon with Qwen Cloud.

It automates a real wholesale operations workflow: ingest a buyer purchase order, extract and normalize line items, flag risky rows, wait for human confirmation, then generate barcode stickers, a commercial invoice, and a packing list.

## System Diagram

```mermaid
flowchart LR
  user["Wholesale operator"] --> web["Next.js dashboard"]
  web --> api["FastAPI backend on Alibaba Cloud"]

  api --> qwen["Qwen Cloud model API\nOpenAI-compatible endpoint"]
  api --> db["Postgres or SQLite\nTenant data, agent events, documents"]
  api --> storage["Object storage\nUploaded POs and generated PDFs"]
  api --> worker["Durable job worker"]

  worker --> parser["PO parser tool\nPDF/XLS/XLSX extraction"]
  worker --> resolver["Exception resolver tool\nconfidence + suggested fixes"]
  worker --> docs["Document tools\nbarcode, invoice, packing list"]

  parser --> db
  resolver --> db
  docs --> storage
  docs --> db

  db --> timeline["Autopilot timeline\nagent actions + human checkpoints"]
  timeline --> web
```

## Agent Flow

1. Operator uploads a marketplace PO.
2. Grada queues a Qwen-powered extraction run and records the agent timeline.
3. Parser tools extract PO header data and line items from PDF/XLS/XLSX inputs.
4. Exception resolver normalizes low-risk rows and flags risky rows for review.
5. Human reviewer accepts, edits, or rejects suggested fixes.
6. Human confirmation unlocks downstream document generation.
7. Agent tools generate barcode stickers, commercial invoice, and packing list PDFs.
8. Every agent action, tool call, and human checkpoint is visible in the Autopilot timeline.

## Why This Is An Autopilot Agent

- Handles ambiguous real-world inputs instead of a toy prompt.
- Invokes external tools for parsing, review, document generation, storage, and background jobs.
- Uses human-in-the-loop gates before commercial documents can be generated.
- Persists an audit-friendly timeline of agent actions, tool results, and human decisions.
- Can run on Alibaba Cloud with Qwen Cloud as the model provider through `AI_PROVIDER=qwen`.

## Qwen Cloud Integration Points

- AI provider configuration: `apps/api/app/core/config.py`
- Qwen/OpenAI-compatible client selection: `apps/api/app/services/ai.py`
- Required env:

```bash
AI_PROVIDER=qwen
QWEN_API_KEY=...
QWEN_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen-vl-max
```

## Alibaba Cloud Deployment Proof

For judging, deploy the FastAPI backend on Alibaba Cloud and include:

- a public backend health URL
- a short screen recording showing the backend running on Alibaba Cloud
- environment configuration showing `AI_PROVIDER=qwen`
- this code path showing Qwen Cloud API use: `apps/api/app/services/ai.py`
