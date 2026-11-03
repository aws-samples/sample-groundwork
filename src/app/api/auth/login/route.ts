import { NextRequest, NextResponse } from "next/server";
import { checkCredentials, issueSession, gateState, AUTH_COOKIE } from "@/lib/auth";

/**
 * POST /api/auth/login { email, password }
 *
 * Validates against the login gate credentials (DEMO_USER / DEMO_PASS) and, on
 * success, sets a signed httpOnly session cookie that the proxy checks on every
 * protected route. A session is issued ONLY when the gate is configured; no
 * login is ever accepted otherwise (fail closed):
 *   - bypass (AUTH_LOCAL_BYPASS=true): 409, no session is needed.
 *   - unconfigured: 503 (the proxy normally answers this state first).
 */
export async function POST(request: NextRequest) {
  const state = gateState();
  if (state === "bypass") {
    return NextResponse.json(
      { error: "Login is disabled in local bypass mode; no session is needed." },
      { status: 409 }
    );
  }
  if (state === "unconfigured") {
    return NextResponse.json({ error: "Login gate is not configured." }, { status: 503 });
  }

  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON { email, password }" }, { status: 400 });
  }

  const email = (body.email ?? "").trim();
  const password = body.password ?? "";
  if (!email || !password) {
    return NextResponse.json({ error: "Enter your credentials" }, { status: 400 });
  }

  if (!checkCredentials(email, password)) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, issueSession(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 12 * 60 * 60, // 12h
  });
  return res;
}
