/**
 * Server-side COA token manager.
 *
 * COA is guarded by Cognito OIDC id tokens that expire ~1h. For local dev the
 * launch script (scripts/demo-coa.sh) mints one and sets COA_TOKEN. But a hosted
 * deployment (App Runner) can't rely on someone re-running a script hourly — the
 * server must mint and refresh the token itself.
 *
 * This module does exactly that: given Cognito credentials (from env, which on
 * App Runner are sourced from Secrets Manager), it performs USER_PASSWORD_AUTH
 * against the Cognito IDP endpoint, caches the resulting id token in memory, and
 * re-mints when the cached token is missing or within a refresh window of expiry.
 *
 * No AWS SDK dependency: Cognito's InitiateAuth is a plain JSON-over-HTTPS API,
 * so we call it with fetch. This keeps the container lean and the app portable.
 *
 * Precedence (see CoaProvider.token):
 *   1. process.env.COA_TOKEN   — an explicitly supplied token (local script flow)
 *   2. this manager            — auto-mint from COA_USER / COA_PASS (hosted flow)
 */

interface CachedToken {
  token: string;
  /** Epoch ms when the token expires (from the JWT `exp` claim). */
  expiresAt: number;
}

let cache: CachedToken | null = null;
let inFlight: Promise<string> | null = null;

/** Re-mint this many ms before actual expiry to avoid mid-request 403s. */
const REFRESH_SKEW_MS = 5 * 60 * 1000; // 5 minutes

/** Decode a JWT payload without verifying (we only need the `exp` claim). */
function readExpiry(idToken: string): number {
  try {
    const payload = idToken.split(".")[1];
    const json = Buffer.from(payload, "base64").toString("utf8");
    const { exp } = JSON.parse(json) as { exp?: number };
    return typeof exp === "number" ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/**
 * The `sub` claim from a COA ID token — the AgentCore transport derives the
 * runtime session id from it (sticky routing). Decoded without verification;
 * we only read a routing hint, not an authorization decision. Returns "" when
 * the token is malformed or carries no `sub`.
 */
export function readSub(idToken: string): string {
  try {
    const payload = idToken.split(".")[1];
    const json = Buffer.from(payload, "base64").toString("utf8");
    const { sub } = JSON.parse(json) as { sub?: string };
    return typeof sub === "string" ? sub : "";
  } catch {
    return "";
  }
}

/**
 * Whether server-side minting is configured. When false, the CoaProvider falls
 * back to whatever COA_TOKEN is in the environment (local script flow).
 */
export function canMintCoaToken(): boolean {
  return Boolean(process.env.COA_USER && process.env.COA_PASS && process.env.COA_CLIENT_ID);
}

/** Perform the Cognito USER_PASSWORD_AUTH call and return the id token. */
async function mint(): Promise<string> {
  const region = process.env.AWS_REGION || "us-west-2";
  const clientId = process.env.COA_CLIENT_ID!;
  const username = process.env.COA_USER!;
  const password = process.env.COA_PASS!;

  const resp = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
    method: "POST",
    headers: {
      "content-type": "application/x-amz-json-1.1",
      "x-amz-target": "AWSCognitoIdentityProviderService.InitiateAuth",
    },
    body: JSON.stringify({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: clientId,
      AuthParameters: { USERNAME: username, PASSWORD: password },
    }),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`Cognito InitiateAuth failed: ${resp.status} ${resp.statusText} ${detail}`.trim());
  }

  const data = (await resp.json()) as { AuthenticationResult?: { IdToken?: string } };
  const token = data.AuthenticationResult?.IdToken;
  if (!token) {
    throw new Error("Cognito InitiateAuth returned no IdToken (check COA_USER / COA_PASS / COA_CLIENT_ID).");
  }
  return token;
}

/**
 * Return a valid COA id token, minting/refreshing as needed. Concurrent callers
 * share a single in-flight mint so we never hammer Cognito. Returns null if
 * minting isn't configured (caller should then use process.env.COA_TOKEN).
 */
export async function getCoaToken(): Promise<string | null> {
  if (!canMintCoaToken()) return null;

  const now = Date.now();
  if (cache && cache.expiresAt - REFRESH_SKEW_MS > now) {
    return cache.token;
  }

  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const token = await mint();
      const expiresAt = readExpiry(token) || now + 55 * 60 * 1000; // fallback ~55m
      cache = { token, expiresAt };
      return token;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Test helper — clear the cached token. */
export function _resetCoaTokenCache() {
  cache = null;
  inFlight = null;
}
