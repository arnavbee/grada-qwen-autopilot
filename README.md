# Grada

Grada helps wholesale teams move from scattered spreadsheets and manual follow-ups to a clean, reliable operations flow.

From catalog to PO to final documents, Grada keeps your team faster, more accurate, and easier to scale.

## Qwen Cloud Hackathon Submission (Devpost Checklist)

**Track:** Track 4: Autopilot Agent  
**Open Source License:** [MIT License](LICENSE) (Visible at top of repository page)

### 🔗 Required Judging Links & Proofs

1. **Alibaba Cloud & Qwen API Proof (Code File):**
   - [`apps/api/app/services/ai.py`](apps/api/app/services/ai.py) — Demonstrates direct API integration with Alibaba Cloud DashScope (`dashscope-intl.aliyuncs.com`) using `qwen-vl-max`.
   - [`apps/api/app/services/received_po_reasoning.py`](apps/api/app/services/received_po_reasoning.py) — Demonstrates Qwen-powered structured risk reasoning over parsed PO rows.
2. **System Architecture Diagram:**
   - Detailed Documentation: [`docs/qwen-hackathon-architecture.md`](docs/qwen-hackathon-architecture.md)
   - Comprehensive Hackathon Guide: [`HACKATHON.md`](HACKATHON.md)
3. **Video Recordings (To Be Added by Team on Devpost):**
   - **3-Minute Functional Demo Video:** Demonstrating upload, Qwen vision extraction, Autopilot timeline, human-in-the-loop exception resolution, and 1-click dispatch document generation.
   - **Alibaba Cloud Deployment Proof Recording:** A separate short recording proving the FastAPI backend server running on Alibaba Cloud infrastructure.

### 🏛️ System Architecture Diagram

```mermaid
flowchart LR
  user["Wholesale operator"] --> web["Next.js dashboard"]
  web --> api["FastAPI backend on Alibaba Cloud"]

  api --> qwen["Qwen Cloud model API\nOpenAI-compatible endpoint"]
  api --> db["Postgres or SQLite\nTenant data, agent events, documents"]
  api --> storage["Object storage\nUploaded POs and generated PDFs"]
  api --> worker["Durable job worker"]

  worker --> parser["PO parser tool\nPDF/XLS/XLSX extraction"]
  worker --> qwenReasoner["Qwen PO risk reasoner\ncritical checks + next action"]
  worker --> resolver["Exception resolver tool\nconfidence + suggested fixes"]
  worker --> docs["Document tools\nbarcode, invoice, packing list"]

  parser --> db
  qwenReasoner --> qwen
  qwenReasoner --> db
  resolver --> db
  docs --> storage
  docs --> db

  db --> timeline["Autopilot timeline\nagent actions + human checkpoints"]
  timeline --> web
```

### 🤖 Autopilot Workflow Overview

Grada Autopilot is a production-shaped wholesale operations agent that automates the intake of unstructured purchase orders into compliant commercial dispatch documents:

1. **Multimodal Ingest:** Upload buyer POs in PDF, XLS, or XLSX format.
2. **Extraction & Normalization:** Qwen vision models and domain parsers extract item SKUs, sizes, colors, and pricing.
3. **Autonomous Risk Reasoning:** Qwen classifies PO risk, evaluates deterministic critical checks, and outlines next actions.
4. **Human-in-the-Loop Verification:** Operators verify flagged discrepancies with bi-directional spreadsheet cell tracing before confirming.
5. **Document Synthesis:** Confirmed POs automatically trigger generated barcode stickers, commercial invoices, and packing lists.

## Why Teams Use Grada

- Ship POs and documents faster with less back-and-forth
- Reduce manual data entry and avoid costly formatting mistakes
- Standardize workflows across catalog, purchasing, and dispatch
- Keep operations audit-friendly with structured records and history

## Core Product Areas

- Smart Catalog: organize products, attributes, and reusable data
- PO Builder: generate buyer-ready PO files in the exact required format
- Received PO Processing: upload marketplace POs, review parsed lines, confirm quickly
- Dispatch Documents: generate barcode labels, invoices, and packing lists
- Ops Settings and Admin: keep rules, defaults, and visibility in one place

Product walkthrough: [docs/current-product-features.md](docs/current-product-features.md)

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Python 3.11+

### 1. Install dependencies

```bash
pnpm install
```

### 2. Create local env files

```bash
cp apps/web/.env.example apps/web/.env
cp apps/api/.env.example apps/api/.env
cp apps/jobs/.env.example apps/jobs/.env
```

### 3. Set minimum env values

`apps/web/.env`

```bash
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
```

`apps/api/.env`

```bash
AI_PROVIDER=qwen
QWEN_API_KEY=your_key_here
QWEN_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen-vl-max
FRONTEND_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

Use either DB mode:

- Fast local mode: `DATABASE_URL=sqlite:///./kira.db`
- Docker parity mode: `DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/kira`

### 4. Run API (Terminal A)

```bash
cd apps/api
python -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 5. Run Web (Terminal B, repo root)

```bash
pnpm --filter @kira/web dev --hostname 0.0.0.0 --port 3000
```

Open [http://localhost:3000](http://localhost:3000)

## Local Stack with Docker (Optional)

```bash
docker compose up --build
```

This starts:

- Postgres on `5432`
- Redis on `6379`
- API on `8000`
- Web on `3000`

## Useful Commands

Repo root:

```bash
pnpm dev
pnpm build
pnpm lint
pnpm test
pnpm format
pnpm format:check
```

API checks:

```bash
cd apps/api
.venv/bin/ruff check .
.venv/bin/pytest
```

Web checks:

```bash
cd apps/web
pnpm lint
pnpm test
```

## Monorepo Structure

- `apps/web`: Next.js frontend
- `apps/api`: FastAPI backend
- `apps/jobs`: worker scaffold for future separation
- `packages/shared`: shared TypeScript package
- `docs/adr`: architecture decisions

## Notes

- API route groups are under `/api/v1`
- API starts an in-process worker for parsing and PDF generation jobs
- Local files are stored under `apps/api/static/` unless object storage is configured
- API details: [apps/api/README.md](apps/api/README.md)
