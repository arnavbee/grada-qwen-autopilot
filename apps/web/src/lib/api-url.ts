const LOCAL_API_ORIGIN = "http://127.0.0.1:8000";
const LOOPBACK_HOST_REGEX = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i;

function normalizeApiBaseUrl(rawBase: string): string {
  const trimmed = rawBase.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/api/v1") ? trimmed : `${trimmed}/api/v1`;
}

export function getResolvedApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (configured) {
    return normalizeApiBaseUrl(configured);
  }

  if (typeof window !== "undefined" && window.location?.origin) {
    return normalizeApiBaseUrl(window.location.origin);
  }

  return normalizeApiBaseUrl(LOCAL_API_ORIGIN);
}

export function getResolvedApiOriginUrl(): string {
  return getResolvedApiBaseUrl().replace(/\/api\/v1$/, "");
}
