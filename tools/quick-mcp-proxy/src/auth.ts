/**
 * Inbound authentication — how Amazon Quick proves who it is to this proxy.
 *
 * Quick's MCP "Service authentication" is the OAuth 2.0 client_credentials flow:
 * Quick exchanges a Client ID + Client Secret at your IdP's Token URL and sends
 * the resulting access token as `Authorization: Bearer <jwt>`. We verify that
 * JWT against the issuer's JWKS (signature, iss, exp/nbf), require it to be for
 * this proxy (audience or client-id allowlist), and optionally require a scope.
 * Works with Amazon Cognito (resource server + app client with client_credentials)
 * or any standards-compliant OIDC/OAuth 2.0 IdP.
 *
 * Fail closed: if nothing is configured, every request is rejected.
 *
 * `QUICK_INBOUND_TOKENS` is a LOCAL-TESTING credential only (curl / smoke test
 * on your own machine). It is honored only when the proxy is bound to loopback,
 * and compared in constant time. It is never a substitute for OAuth on a
 * reachable deployment.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

export interface OAuthConfig {
  /** Expected `iss` claim, e.g. https://cognito-idp.<region>.amazonaws.com/<user-pool-id>. */
  issuer: string;
  /** JWKS URL. Defaults to `<issuer>/.well-known/jwks.json` (Cognito's layout). */
  jwksUrl: string;
  /** Accepted `aud` values (IdPs that set an audience). */
  audiences: string[];
  /** Accepted `client_id` / `azp` values (Cognito client_credentials tokens have no `aud`). */
  clientIds: string[];
  /** Scope the token must carry, e.g. `groundwork-coa/query`. Optional. */
  requiredScope?: string;
}

export interface InboundAuthConfig {
  oauth?: OAuthConfig;
  /** Local-testing bearer tokens; honored only on a loopback bind. */
  localTokens: string[];
}

/** Asymmetric algorithms only — never accept HS* (shared-secret) or `none`. */
const ALLOWED_ALGS = ["RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512", "EdDSA"];

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host) || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

function digest(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

/** Constant-time membership check (fixed-length digests, no early exit). */
function matchesLocalToken(presented: string, tokens: string[]): boolean {
  const p = digest(presented);
  let ok = false;
  for (const t of tokens) {
    if (timingSafeEqual(p, digest(t))) ok = true;
  }
  return ok;
}

function extractBearer(header: string | string[] | undefined): string | null {
  if (!header || Array.isArray(header)) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return m ? m[1] : null;
}

function scopesOf(payload: JWTPayload): string[] {
  const out: string[] = [];
  const { scope, scp } = payload as { scope?: unknown; scp?: unknown };
  if (typeof scope === "string") out.push(...scope.split(/\s+/));
  if (typeof scp === "string") out.push(...scp.split(/\s+/));
  if (Array.isArray(scp)) out.push(...scp.filter((s): s is string => typeof s === "string"));
  return out.filter(Boolean);
}

/** Authorization decision for a verified token. Exported for tests. */
export function claimsAuthorized(oauth: OAuthConfig, payload: JWTPayload): boolean {
  // Cognito marks token type; an ID token must never be accepted as an access token.
  const tokenUse = (payload as { token_use?: unknown }).token_use;
  if (tokenUse !== undefined && tokenUse !== "access") return false;

  if (oauth.clientIds.length) {
    const { client_id, azp } = payload as { client_id?: unknown; azp?: unknown };
    const cid = typeof client_id === "string" ? client_id : typeof azp === "string" ? azp : undefined;
    // If both allowlists are set, either an allowed client id OR an allowed aud
    // (already enforced by jwtVerify when audiences is non-empty) is required.
    if (!cid || !oauth.clientIds.includes(cid)) {
      if (!oauth.audiences.length) return false;
    }
  }
  if (oauth.requiredScope && !scopesOf(payload).includes(oauth.requiredScope)) return false;
  return true;
}

export type Authorizer = (authorizationHeader: string | string[] | undefined) => Promise<boolean>;

export interface AuthorizerOptions {
  /** Whether the server is bound to loopback (gates local tokens). */
  loopback: boolean;
  /** Inject a key set (tests). Defaults to a cached remote JWKS. */
  jwks?: JWTVerifyGetKey;
}

export function createAuthorizer(cfg: InboundAuthConfig, opts: AuthorizerOptions): Authorizer {
  const localTokens = opts.loopback ? cfg.localTokens : [];
  const oauth = cfg.oauth;
  const jwks = oauth ? (opts.jwks ?? createRemoteJWKSet(new URL(oauth.jwksUrl))) : undefined;

  return async (header) => {
    const token = extractBearer(header);
    if (!token) return false;
    if (localTokens.length && matchesLocalToken(token, localTokens)) return true;
    if (!oauth || !jwks) return false; // fail closed: nothing configured ⇒ deny
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: oauth.issuer,
        audience: oauth.audiences.length ? oauth.audiences : undefined,
        algorithms: ALLOWED_ALGS,
        clockTolerance: 5,
      });
      return claimsAuthorized(oauth, payload);
    } catch {
      return false; // bad signature, wrong issuer/audience, expired, malformed
    }
  };
}

/** Human-readable auth mode for the startup log (never prints secrets). */
export function describeAuth(cfg: InboundAuthConfig, loopback: boolean): string {
  const parts: string[] = [];
  if (cfg.oauth) {
    parts.push(
      `oauth-jwt (issuer ${cfg.oauth.issuer}${cfg.oauth.requiredScope ? `, scope ${cfg.oauth.requiredScope}` : ""})`
    );
  }
  if (cfg.localTokens.length && loopback) parts.push(`local-test token x${cfg.localTokens.length} (loopback only)`);
  return parts.length ? parts.join(" + ") : "NOT CONFIGURED — every /mcp request is rejected (fail closed)";
}
