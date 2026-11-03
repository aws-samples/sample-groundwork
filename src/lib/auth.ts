/**
 * Lightweight shared-password access gate.
 *
 * The gate FAILS CLOSED. It is in one of three states:
 *   - "gate":         DEMO_USER, DEMO_PASS and AUTH_SECRET are all set. Every
 *                     protected page and API route requires a signed session.
 *   - "bypass":       AUTH_LOCAL_BYPASS=true is set explicitly. No login is
 *                     required. For local-only use on 127.0.0.1; never set it
 *                     on a shared deployment.
 *   - "unconfigured": anything else. Every protected route is refused with a
 *                     setup message; nothing is served openly.
 *
 * Mechanism: on successful login we set an httpOnly, signed cookie. The proxy
 * verifies the signature on every protected request. Signing uses an HMAC over
 * a fixed payload + expiry with AUTH_SECRET, so the cookie can't be forged
 * without the secret. This is a basic gate, not an IdP; put your organisation's
 * identity provider in front of any shared deployment.
 */
import { createHmac, randomBytes, timingSafeEqual } from "crypto";

export const AUTH_COOKIE = "cf_session";
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000; // 12h

export type GateState = "gate" | "bypass" | "unconfigured";

const GATE_VARS = ["DEMO_USER", "DEMO_PASS", "AUTH_SECRET"] as const;

/** Resolve the gate state from the environment. Defaults to "unconfigured". */
export function gateState(): GateState {
  if (GATE_VARS.every((k) => Boolean(process.env[k]))) return "gate";
  // Only the exact string "true" opts in; "1", "yes", "TRUE " etc. do not.
  if (process.env.AUTH_LOCAL_BYPASS === "true") return "bypass";
  return "unconfigured";
}

/** Setup message for the unconfigured state. Names variables only, never values. */
export function setupMessage(): string {
  const missing = GATE_VARS.filter((k) => !process.env[k]);
  return (
    `Login gate is not configured (missing ${missing.join(", ")}). ` +
    "Set DEMO_USER, DEMO_PASS and AUTH_SECRET in .env.local (see .env.example). " +
    "For local-only use on 127.0.0.1 without a login, set AUTH_LOCAL_BYPASS=true instead."
  );
}

// Per-process random key, used only in bypass (where sessions are never checked).
const EPHEMERAL_SECRET = randomBytes(32).toString("base64url");

function secret(): string {
  const s = process.env.AUTH_SECRET;
  // Never sign cookies with a predictable key.
  if (s) return s;
  if (gateState() === "bypass") return EPHEMERAL_SECRET;
  throw new Error("AUTH_SECRET must be set to a strong random value to sign session cookies.");
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** Validate a username/password against the configured demo credentials. */
export function checkCredentials(user: string, pass: string): boolean {
  const U = process.env.DEMO_USER ?? "";
  const P = process.env.DEMO_PASS ?? "";
  if (!U || !P) return false;
  // Constant-time compare to avoid timing leaks.
  const okU = safeEqual(user, U);
  const okP = safeEqual(pass, P);
  return okU && okP;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Create a signed session token: `<expiry>.<sig>`. */
export function issueSession(ttlMs: number = DEFAULT_TTL_MS): string {
  const exp = Date.now() + ttlMs;
  const payload = `v1.${exp}`;
  return `${payload}.${sign(payload)}`;
}

/** Verify a session token's signature and expiry. */
export function verifySession(token: string | undefined | null): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [v, exp, sig] = parts;
  const payload = `${v}.${exp}`;
  const expected = sign(payload);
  if (!safeEqual(sig, expected)) return false;
  const expMs = Number(exp);
  return Number.isFinite(expMs) && expMs > Date.now();
}
