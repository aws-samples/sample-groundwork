/**
 * Proxy configuration, all from environment. Two credential sets live here and
 * must not be confused:
 *
 *   INBOUND  — how Amazon Quick authenticates TO this proxy (service auth /
 *              client_credentials). Quick sends an IdP-issued access token
 *              (JWT); we verify it (see auth.ts).
 *   OUTBOUND — how this proxy authenticates TO COA (COA's Cognito user OIDC
 *              token, minted server-side — the same flow GroundWork uses).
 *
 * The whole point of the proxy is to bridge these two: Quick speaks
 * client_credentials, COA speaks user-token, and neither has to change.
 */

import type { InboundAuthConfig, OAuthConfig } from "./auth.js";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function list(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Inbound OAuth (client_credentials JWT) settings, or undefined if not configured. */
function loadOAuth(): OAuthConfig | undefined {
  const issuer = process.env.QUICK_OAUTH_ISSUER?.trim().replace(/\/+$/, "");
  if (!issuer) return undefined;
  const audiences = list("QUICK_OAUTH_AUDIENCE");
  const clientIds = list("QUICK_OAUTH_CLIENT_IDS");
  if (!audiences.length && !clientIds.length) {
    // Without one of these, any token the issuer mints for ANY client would pass.
    throw new Error("QUICK_OAUTH_ISSUER is set but neither QUICK_OAUTH_CLIENT_IDS nor QUICK_OAUTH_AUDIENCE is — refusing to start.");
  }
  return {
    issuer,
    jwksUrl: process.env.QUICK_OAUTH_JWKS_URL?.trim() || `${issuer}/.well-known/jwks.json`,
    audiences,
    clientIds,
    requiredScope: process.env.QUICK_OAUTH_REQUIRED_SCOPE?.trim() || undefined,
  };
}

/**
 * Namespace-UUID → cache-file basename aliases, from the same
 * `COA_NAMESPACE_<VERTICAL>=<uuid>` vars the GroundWork app uses. COA addresses
 * namespaces by UUID, but hero-answer cache files are named by vertical
 * (prodquality.json, otsec.json), so a UUID default namespace still finds its cache.
 */
function loadNamespaceAliases(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    const m = /^COA_NAMESPACE_([A-Z0-9_]+)$/.exec(k);
    if (m && v && v.trim()) out[v.trim()] = m[1].toLowerCase();
  }
  return out;
}

export interface ProxyConfig {
  port: number;
  /** Interface to bind. Defaults to loopback; non-loopback requires OAuth. */
  host: string;
  /** COA Serve/Data-Layer base URL (same COA_BASE_URL GroundWork uses). */
  coaBaseUrl: string;
  /** Default COA namespace a question resolves against when the caller omits one. */
  defaultNamespace: string;
  /** Outbound COA token: either a static token or Cognito mint creds. */
  coa: {
    staticToken?: string;
    region: string;
    clientId?: string;
    username?: string;
    password?: string;
  };
  /** Inbound auth. `oauth` = Quick's Service authentication (client_credentials
   *  JWT). `localTokens` = local-testing bearer(s), honored on loopback only.
   *  Neither set ⇒ every /mcp request is rejected (fail closed). */
  inbound: InboundAuthConfig;
  /** Serve hero-answer cache from a local dir for demo reliability. */
  cacheDir?: string;
  /** Namespace UUID → cache basename (from COA_NAMESPACE_<VERTICAL>). */
  namespaceAliases: Record<string, string>;
  /** Hard timeout (ms) for a COA query. Quick allows 5 min; stay under it. */
  queryTimeoutMs: number;
  /** AgentCore SSE transport — bypasses COA's REST 29s API-Gateway cap.
   *  When transport=agentcore AND a runtime ARN is set, the slow `query` goes
   *  over AgentCore; otherwise (or on failure) it falls back to REST. */
  transport: "rest" | "agentcore";
  serveRuntimeArn?: string;
}

export function loadConfig(): ProxyConfig {
  return {
    port: Number(process.env.PORT ?? 8787),
    host: process.env.BIND_HOST?.trim() || "127.0.0.1",
    coaBaseUrl: req("COA_BASE_URL").replace(/\/+$/, ""),
    defaultNamespace: process.env.COA_DEFAULT_NAMESPACE ?? "prodquality",
    coa: {
      staticToken: process.env.COA_TOKEN,
      region: process.env.AWS_REGION ?? "us-west-2",
      clientId: process.env.COA_CLIENT_ID,
      username: process.env.COA_USER,
      password: process.env.COA_PASS,
    },
    inbound: { oauth: loadOAuth(), localTokens: list("QUICK_INBOUND_TOKENS") },
    cacheDir: process.env.COA_CACHE_DIR,
    namespaceAliases: loadNamespaceAliases(),
    queryTimeoutMs: Number(process.env.COA_QUERY_TIMEOUT_MS ?? 240_000), // 4 min (< Quick's 5)
    transport: process.env.COA_TRANSPORT === "agentcore" ? "agentcore" : "rest",
    serveRuntimeArn: process.env.COA_SERVE_RUNTIME_ARN,
  };
}
