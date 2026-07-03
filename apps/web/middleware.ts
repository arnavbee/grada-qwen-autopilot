import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const protectedRoutes = ["/dashboard"];
const authRoutes = ["/login", "/signup", "/forgot-password", "/reset-password"];
const LOOPBACK_HOST_REGEX = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i;

function normalizeToken(raw: string | undefined): string {
  if (!raw) return "";
  let token = raw.trim();
  if (token.startsWith('"') && token.endsWith('"') && token.length > 1) {
    token = token.slice(1, -1).trim();
  }
  if (token.toLowerCase().startsWith("bearer ")) {
    token = token.slice("bearer ".length).trim();
  }
  return token;
}

function looksLikeJwt(raw: string | undefined): boolean {
  const token = normalizeToken(raw);
  const parts = token.split(".");
  return parts.length === 3 && parts.every((part) => part.length > 0);
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = `${normalized}${"=".repeat(padLength)}`;
  return atob(padded);
}

function getJwtExpMs(raw: string | undefined): number | null {
  const token = normalizeToken(raw);
  if (!looksLikeJwt(token)) {
    return null;
  }
  const payloadSegment = token.split(".")[1];
  if (!payloadSegment) {
    return null;
  }
  try {
    const payload = JSON.parse(decodeBase64Url(payloadSegment)) as { exp?: number };
    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
      return null;
    }
    return payload.exp * 1000;
  } catch {
    return null;
  }
}

function hasActiveJwt(raw: string | undefined): boolean {
  if (!looksLikeJwt(raw)) {
    return false;
  }
  const expMs = getJwtExpMs(raw);
  if (!expMs) {
    return true;
  }
  const nowMs = Date.now();
  const graceWindowMs = 30_000;
  return expMs > nowMs + graceWindowMs;
}

function isProtectedPath(pathname: string): boolean {
  return protectedRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

function isAuthPath(pathname: string): boolean {
  return authRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

function buildApiBaseUrl(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (configured) {
    return configured.endsWith("/api/v1") ? configured : `${configured.replace(/\/+$/, "")}/api/v1`;
  }
  return `${request.nextUrl.origin}/api/v1`;
}

function clearAuthCookies(response: NextResponse): void {
  response.cookies.set("kira_access_token", "", { path: "/", maxAge: 0 });
  response.cookies.set("kira_refresh_token", "", { path: "/", maxAge: 0 });
}

async function validateSession(request: NextRequest, accessToken: string): Promise<boolean> {
  try {
    const response = await fetch(`${buildApiBaseUrl(request)}/auth/me`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${normalizeToken(accessToken)}`,
      },
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const accessToken = request.cookies.get("kira_access_token")?.value;
  const refreshToken = request.cookies.get("kira_refresh_token")?.value;
  const hasToken = Boolean(normalizeToken(accessToken) || normalizeToken(refreshToken));

  const looksSessionLikeJwt = hasActiveJwt(accessToken) || hasActiveJwt(refreshToken);
  const hasValidSession =
    isAuthPath(pathname) && looksSessionLikeJwt && accessToken
      ? await validateSession(request, accessToken)
      : looksSessionLikeJwt;

  if (isProtectedPath(pathname) && !hasValidSession) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    const response = NextResponse.redirect(loginUrl);
    if (hasToken) {
      clearAuthCookies(response);
    }
    return response;
  }

  if (isAuthPath(pathname) && hasValidSession) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (isAuthPath(pathname) && hasToken && !hasValidSession) {
    const response = NextResponse.next();
    clearAuthCookies(response);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/login", "/signup", "/forgot-password", "/reset-password"],
};
