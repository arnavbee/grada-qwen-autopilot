import { NextRequest, NextResponse } from "next/server";

const LOCAL_API_BASE = "http://127.0.0.1:8000/api/v1";
const PROXY_ERROR_MESSAGE = "API proxy target is not configured.";
const LOOPBACK_HOST_REGEX = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i;
const UPSTREAM_TIMEOUT_MS = 60_000;

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

async function proxyRequest(
  request: NextRequest,
  { params }: { params: { path: string[] } },
): Promise<NextResponse> {
  const apiBase = getApiBaseUrl();
  if (!apiBase) {
    return NextResponse.json(
      {
        detail: `${PROXY_ERROR_MESSAGE} Set API_PROXY_TARGET or NEXT_PUBLIC_API_URL.`,
      },
      { status: 500 },
    );
  }

  const upstreamUrl = new URL(`${apiBase}/${params.path.join("/")}`);
  upstreamUrl.search = request.nextUrl.search;

  const method = request.method.toUpperCase();
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("connection");
  headers.delete("accept-encoding");
  headers.delete("content-length");

  let body: ArrayBuffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    body = await request.arrayBuffer();
  }

  try {
    const upstreamResponse = await fetch(upstreamUrl.toString(), {
      method,
      headers,
      body,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    const responseHeaders = new Headers(upstreamResponse.headers);
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");
    responseHeaders.delete("transfer-encoding");
    responseHeaders.delete("connection");

    return new NextResponse(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  } catch (err) {
    console.error("API proxy fetch error:", err);
    return NextResponse.json(
      {
        detail: `Unable to reach API target: ${apiBase}.`,
      },
      { status: 502 },
    );
  }
}

export const dynamic = "force-dynamic";

export function GET(
  request: NextRequest,
  context: { params: { path: string[] } },
): Promise<NextResponse> {
  return proxyRequest(request, context);
}

export function POST(
  request: NextRequest,
  context: { params: { path: string[] } },
): Promise<NextResponse> {
  return proxyRequest(request, context);
}

export function PUT(
  request: NextRequest,
  context: { params: { path: string[] } },
): Promise<NextResponse> {
  return proxyRequest(request, context);
}

export function PATCH(
  request: NextRequest,
  context: { params: { path: string[] } },
): Promise<NextResponse> {
  return proxyRequest(request, context);
}

export function DELETE(
  request: NextRequest,
  context: { params: { path: string[] } },
): Promise<NextResponse> {
  return proxyRequest(request, context);
}

export function OPTIONS(
  request: NextRequest,
  context: { params: { path: string[] } },
): Promise<NextResponse> {
  return proxyRequest(request, context);
}

export function HEAD(
  request: NextRequest,
  context: { params: { path: string[] } },
): Promise<NextResponse> {
  return proxyRequest(request, context);
}
