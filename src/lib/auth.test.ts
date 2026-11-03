/**
 * Login gate tests (fail-closed state machine + session signing). No server or
 * network is needed. Run: npm test
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { gateState, setupMessage, checkCredentials, issueSession, verifySession } from "./auth";

const KEYS = ["DEMO_USER", "DEMO_PASS", "AUTH_SECRET", "AUTH_LOCAL_BYPASS"] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function setGate() {
  process.env.DEMO_USER = "user@example.com";
  process.env.DEMO_PASS = "<placeholder-pass>";
  process.env.AUTH_SECRET = "<placeholder-secret-for-tests-only>";
}

test("default state is unconfigured", () => {
  assert.equal(gateState(), "unconfigured");
});

test("only the exact string \"true\" enables bypass", () => {
  for (const v of ["1", "yes", "TRUE ", "True", "TRUE", " true", ""]) {
    process.env.AUTH_LOCAL_BYPASS = v;
    assert.equal(gateState(), "unconfigured", `AUTH_LOCAL_BYPASS=${JSON.stringify(v)}`);
  }
  process.env.AUTH_LOCAL_BYPASS = "true";
  assert.equal(gateState(), "bypass");
});

test("gate requires all three variables", () => {
  process.env.DEMO_USER = "user@example.com";
  process.env.DEMO_PASS = "<placeholder-pass>";
  assert.equal(gateState(), "unconfigured");
  delete process.env.DEMO_PASS;
  process.env.AUTH_SECRET = "<placeholder-secret>";
  assert.equal(gateState(), "unconfigured");
  process.env.DEMO_PASS = "<placeholder-pass>";
  assert.equal(gateState(), "gate");
});

test("a configured gate wins over the bypass flag", () => {
  setGate();
  process.env.AUTH_LOCAL_BYPASS = "true";
  assert.equal(gateState(), "gate");
});

test("setupMessage names missing variables only, never values", () => {
  process.env.DEMO_USER = "user@example.com";
  const msg = setupMessage();
  assert.match(msg, /DEMO_PASS, AUTH_SECRET/);
  assert.doesNotMatch(msg, /user@example\.com/);
});

test("checkCredentials is false when unset", () => {
  assert.equal(checkCredentials("", ""), false);
  assert.equal(checkCredentials("user@example.com", "<placeholder-pass>"), false);
});

test("checkCredentials accepts right values and rejects wrong ones", () => {
  setGate();
  assert.equal(checkCredentials("user@example.com", "<placeholder-pass>"), true);
  assert.equal(checkCredentials("user@example.com", "wrong"), false);
  assert.equal(checkCredentials("other@example.com", "<placeholder-pass>"), false);
});

test("an issued session verifies", () => {
  setGate();
  assert.equal(verifySession(issueSession()), true);
});

test("tampered, expired, malformed or missing tokens fail", () => {
  setGate();
  const token = issueSession();
  const [v, exp, sig] = token.split(".");
  // Tampered expiry with the original signature.
  assert.equal(verifySession(`${v}.${Number(exp) + 1000}.${sig}`), false);
  // Tampered signature.
  const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
  assert.equal(verifySession(`${v}.${exp}.${flipped}`), false);
  // Expired (validly signed, TTL in the past).
  assert.equal(verifySession(issueSession(-1000)), false);
  assert.equal(verifySession("not-a-token"), false);
  assert.equal(verifySession(undefined), false);
});

test("a token signed with a different secret fails", () => {
  setGate();
  const token = issueSession();
  process.env.AUTH_SECRET = "<a-different-placeholder-secret>";
  assert.equal(verifySession(token), false);
});

test("signing throws when unconfigured (no predictable key)", () => {
  assert.throws(() => issueSession(), /AUTH_SECRET/);
});
