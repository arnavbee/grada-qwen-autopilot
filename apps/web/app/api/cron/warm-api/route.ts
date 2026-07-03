import { NextRequest, NextResponse } from "next/server";

const LOCAL_API_BASE = "http://127.0.0.1:8000/api/v1";
const LOOPBACK_HOST_REGEX = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i;
const WARMUP_TIMEOUT_MS = 55_000;

function normalizeApiBase(rawBase: string): string {
  const trimmed = rawBase.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/api/v1") ? trimmed : `${trimmed}/api/v1`;
}

function getApiBaseUrl(): string | null {
  const configuredBase =
    process.env.API_PROXY_TARGET?.trim() || process.env.NEXT_PUBLIC_API_URL?.trim();
  if (configuredBase) {
    return normalizeApiBase(configuredBase);
  }

  return normalizeApiBase(LOCAL_API_BASE);
}

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const apiBase = getApiBaseUrl();
  if (!apiBase) {
    return NextResponse.json({ detail: "API warmup target is not configured." }, { status: 500 });
  }

  const startedAt = Date.now();
  try {
    const response = await fetch(`${apiBase}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(WARMUP_TIMEOUT_MS),
    });

    return NextResponse.json(
      {
        ok: response.ok,
        status: response.status,
        target: apiBase,
        elapsed_ms: Date.now() - startedAt,
      },
      { status: response.ok ? 200 : 502 },
    );
  } catch (err) {
    console.error("API warmup failed:", err);
    return NextResponse.json(
      {
        ok: false,
        target: apiBase,
        elapsed_ms: Date.now() - startedAt,
        detail: "Unable to warm API target.",
      },
      { status: 502 },
    );
  }
}
