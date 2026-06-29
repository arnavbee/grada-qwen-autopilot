# Kira API

FastAPI backend for authentication, catalog workflows, PO-builder automation, received marketplace PO processing, settings, uploads, and super-admin reporting.

## What lives here

- JWT auth and tenancy-aware user/company management
- Catalog CRUD, image analysis hooks, marketplace exports, and correction logging
- PO request builder and extraction workflows
- Received PO upload, parsing, review, confirmation, and document generation
- Brand-profile, PO-builder, and carton-rule settings
- Local or S3-compatible file storage
- In-process durable job worker for parse and PDF-generation tasks

## Local setup

### 1. Create and activate a virtualenv

```bash
python -m venv .venv
source .venv/bin/activate
```

### 2. Install the package in editable mode

```bash
pip install -e .[dev]
```

### 3. Configure environment

Copy the example file and update the required values:

```bash
cp .env.example .env
```

Most important settings:

```bash
AI_PROVIDER=qwen
QWEN_API_KEY=...
QWEN_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen-vl-max
DATABASE_URL=sqlite:///./kira.db
FRONTEND_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
JWT_SECRET_KEY=change-me
JWT_REFRESH_SECRET_KEY=change-me-too
```

Notes:

- `AI_PROVIDER=qwen` routes image analysis and PO attribute extraction through Qwen Cloud's OpenAI-compatible API.
- `AI_MODEL` can override the provider-specific model for one-off experiments.
- `OPENAI_API_KEY` and `OPENAI_MODEL` remain available for local fallback runs.
- SQLite is the simplest local path; Postgres is supported and is the intended production target.
- The API reads `.env` from `apps/api/`.

### 4. Run the server

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Available health checks:

- `GET /health`
- `GET /api/v1/health`
- `GET /api/v1/health/storage`

## Quality checks

```bash
ruff check .
pytest
```

If you already have the local venv set up:

```bash
.venv/bin/ruff check .
.venv/bin/pytest
```

## Main route groups

All business routes are mounted under `/api/v1`.

- `/auth`
- `/catalog`
- `/settings`
- `/users`
- `/uploads`
- `/po-requests`
- `/received-pos`
- `/admin`

## Background jobs

The API starts a built-in worker on application startup.

Current supported durable job types:

- received PO parsing
- barcode PDF generation
- invoice PDF generation
- packing-list PDF generation

Relevant config:

```bash
JOB_WORKER_ENABLED=true
JOB_WORKER_POLL_INTERVAL_SECONDS=0.5
```

This worker currently runs in-process. The repo also includes `apps/jobs` as a future scaffold for a separate worker service.

## File storage

### Local fallback

Without object-storage credentials, uploads and generated documents are stored under:

- `static/uploads`
- `static/generated`

### S3-compatible object storage

To avoid ephemeral local files in production, configure S3-compatible object storage such as Cloudflare R2.

Required environment variables:

```bash
R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=...
```

Recommended public-access settings:

```bash
R2_PUBLIC_BASE_URL=https://<your-public-domain-or-r2-dev>
R2_REGION=auto
```

When these values are set, the upload/document services store files in object storage and return object-backed URLs. If not set, the API falls back to local `static/` storage.

### Production setup for durable PDFs

For Render-hosted API deployments, set these on the API service:

```bash
APP_ENV=production
R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=...
R2_PUBLIC_BASE_URL=https://<public-r2-domain-or-cdn-domain>
R2_REGION=auto
```

Notes:

- `R2_PUBLIC_BASE_URL` should be a publicly readable bucket/CDN domain so saved `file_url` values remain downloadable later.
- Once configured, newly generated barcode, invoice, and packing-list PDFs will be stored in R2 instead of local disk.
- Existing local-disk PDFs from older deploys cannot be recovered automatically after the host filesystem is replaced.
- Verify the deployment is using R2 with `GET /api/v1/health/storage` and check that `storage.enabled` is `true`.

## Development notes

- CORS origins are configured from `FRONTEND_ORIGINS`.
- The default local database in code is SQLite (`sqlite:///./kira.db`).
- Compose uses Postgres and Redis for a more production-like setup.
- The current job worker does not require Redis for local execution, even though the wider platform plan includes a future external queue/worker setup.
