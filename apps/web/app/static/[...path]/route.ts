import { NextRequest, NextResponse } from "next/server";

const LOCAL_API_ORIGIN = "http://127.0.0.1:8000";
const PROXY_ERROR_MESSAGE = "Static proxy target is not configured.";
const LOOPBACK_HOST_REGEX = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i;
const UPSTREAM_TIMEOUT_MS = 60_000;

function normalizeApiOrigin(rawBase: string): string {
  return rawBase
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api\/v1$/, "");
}

function getApiOriginUrl(): string | null {
  const configuredBase =
    process.env.API_PROXY_TARGET?.trim() || process.env.NEXT_PUBLIC_API_URL?.trim();
  if (configuredBase) {
    return normalizeApiOrigin(configuredBase);
  }

  return normalizeApiOrigin(LOCAL_API_ORIGIN);
}

async function proxyStaticRequest(
  request: NextRequest,
  { params }: { params: { path: string[] } },
): Promise<NextResponse> {
  const apiOrigin = getApiOriginUrl();
  if (!apiOrigin) {
    return NextResponse.json(
      {
        detail: `${PROXY_ERROR_MESSAGE} Set API_PROXY_TARGET or NEXT_PUBLIC_API_URL.`,
      },
      { status: 500 },
    );
  }

  const upstreamUrl = new URL(`${apiOrigin}/static/${params.path.join("/")}`);
  upstreamUrl.search = request.nextUrl.search;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("connection");
  headers.delete("accept-encoding");

  try {
    const upstreamResponse = await fetch(upstreamUrl.toString(), {
      method: request.method.toUpperCase(),
      headers,
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
    console.error("Static proxy fetch error:", err);
    return NextResponse.json(
      {
        detail: `Unable to reach static target: ${apiOrigin}.`,
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
  return proxyStaticRequest(request, context);
}

export function HEAD(
  request: NextRequest,
  context: { params: { path: string[] } },
): Promise<NextResponse> {
  return proxyStaticRequest(request, context);
}
