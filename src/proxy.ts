import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySession, gateState, setupMessage, AUTH_COOKIE } from "@/lib/auth";

/**
 * Access gate (Next 16 `proxy`, formerly `middleware`).
 *
 * Runs on the Node runtime, so it can use the same HMAC session helper as the
 * login route. It fails closed (see lib/auth.ts):
 *   - gate configured: every protected route requires a valid signed session
 *     cookie, else redirect to /login (pages) or 401 (API).
 *   - AUTH_LOCAL_BYPASS=true: explicit local-only opt-out; everything passes.
 *   - unconfigured: every route except /api/health returns 503 with a setup
 *     message. Nothing is served openly.
 *
 * Public when the gate is configured: /login, /api/auth/*, /api/health, static assets.
 */
export function proxy(request: NextRequest) {
  const state = gateState();

  // Explicit local-only opt-out → let everything through unchanged.
  if (state === "bypass") return NextResponse.next();

  const { pathname } = request.nextUrl;

  // Unconfigured → refuse everything except the health check.
  if (state === "unconfigured") {
    if (pathname === "/api/health") return NextResponse.next();
    const message = setupMessage();
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: message }, { status: 503 });
    }
    return new NextResponse(`Setup required.\n\n${message}\n`, {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  // Always-public paths.
  if (
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/health"
  ) {
    return NextResponse.next();
  }

  const authed = verifySession(request.cookies.get(AUTH_COOKIE)?.value);
  if (authed) return NextResponse.next();

  // Unauthenticated: API → 401 JSON; pages → redirect to /login.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|txt|woff2?)$).*)"],
};
