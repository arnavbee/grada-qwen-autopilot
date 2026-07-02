# Qwen Cloud Hackathon Submission

## Track

Track 4: Autopilot Agent

## Project

Grada Autopilot is a wholesale operations agent that turns messy marketplace purchase orders into reviewed, compliant dispatch documents.

The workflow is intentionally production-shaped:

1. Upload a buyer PO in PDF, XLS, or XLSX format.
2. Parse and normalize PO header and line-item data.
3. Use Qwen Cloud to reason over parsed rows, critical checks, risk, and next action.
4. Run deterministic exception tools for field-level fixes and confidence scoring.
5. Pause for human review on risky commercial decisions.
6. Generate barcode stickers, commercial invoices, and packing lists after confirmation.
7. Persist every agent action, tool result, and human checkpoint in the Autopilot timeline.

## Why It Fits Autopilot Agent

- Real business workflow, not a toy prompt: marketplace PO intake through dispatch documents.
- Ambiguous inputs: buyer exports vary by file type, header name, row quality, and missing commercial fields.
- External tools: parser, Qwen reasoner, exception resolver, document generators, storage, background jobs, and audit logs.
- Human-in-the-loop checkpoints: risky rows require operator review before invoices, packing lists, or barcode PDFs are generated.
- Production readiness: tenant-scoped data, auth, durable jobs, object-storage support, health checks, and audit history.

## Qwen Cloud Evidence (Proof of Deployment)

Qwen/OpenAI-compatible provider configuration clearly visible in code:

- `apps/api/app/core/config.py` (Base URL: `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`)
- `apps/api/app/services/ai.py` (Explicit constants `QWEN_DASHSCOPE_BASE_URL` and `QWEN_TOKEN_PLAN_BASE_URL`)

Qwen PO risk reasoning:

- `apps/api/app/services/ai.py::AIService.assess_received_po_autopilot`
- `apps/api/app/services/received_po_reasoning.py`

Timeline proof:

- Parse jobs emit `agent.qwen_reasoning_completed`.
- The event metadata includes `source`, `provider`, `model`, `overall_risk`, `confidence`, `decision`, `critical_checks`, `review_questions`, and `suggested_next_action`.

Required production env:

```bash
AI_PROVIDER=qwen
QWEN_API_KEY=...
# Standard DashScope International Base URL:
QWEN_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
# Token Plan Alternative:
# QWEN_BASE_URL=https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen3.7-plus
```

Local development without a Qwen key uses a marked `local_rule_fallback` so the app remains testable. Production judging should use `source=qwen_cloud` in the timeline metadata.

## Demo Script

1. Show Alibaba Cloud backend health endpoint.
2. Show env/config proving `AI_PROVIDER=qwen`.
3. Sign in to Grada and upload a messy marketplace PO.
4. Open the PO review screen and expand the Autopilot timeline.
5. Point out:
   - upload accepted
   - parse queued/started
   - Qwen risk reasoning completed
   - exceptions evaluated
   - human edits or accepts risky rows
6. Confirm the PO.
7. Generate barcode stickers, commercial invoice, and packing list PDFs.
8. Show document download/history and the final timeline.

## Architecture

See `docs/qwen-hackathon-architecture.md`.

## Judging Checklist ✅

- [x] **Public, open-source code repo**: Repository with `LICENSE`
- [x] **Code file with Qwen Cloud Base URL clearly visible**: [`apps/api/app/services/ai.py`](apps/api/app/services/ai.py) and [`apps/api/app/core/config.py`](apps/api/app/core/config.py)
- [ ] **Screenshot showing proof of deployment on Alibaba Cloud**: Capture running resources from Alibaba Cloud Workbench and include in Devpost submission question / project images
- [x] **3-min demo video**: Working real app recording demonstrating the workflow above
- [x] **Track identified**: Track 4, Autopilot Agent
