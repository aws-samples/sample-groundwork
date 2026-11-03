/**
 * COA client for the proxy. Two responsibilities:
 *   1. Mint/refresh COA's Cognito user OIDC token (ported from GroundWork's
 *      coa-token.ts) — or use a static COA_TOKEN if supplied.
 *   2. Call COA's query operation (POST /namespaces/{ns}/query), with an
 *      optional pre-captured hero-answer cache for demo reliability (ported
 *      from GroundWork's coa-cache.ts).
 *
 * Deliberately dependency-free (plain fetch) so the proxy stays lean and
 * portable, matching GroundWork's approach.
 */
import fs from "node:fs";
import path from "node:path";
import type { ProxyConfig } from "./config.js";
import { agentCoreQuery, buildAgentCoreEndpoint, readSub } from "./coa-agentcore.js";

// ── Outbound token (COA Cognito user OIDC) ────────────────────────────────────

interface CachedToken {
  token: string;
  expiresAt: number;
}
let tokenCache: CachedToken | null = null;
let inFlight: Promise<string> | null = null;
const REFRESH_SKEW_MS = 5 * 60 * 1000;

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

async function mint(cfg: ProxyConfig): Promise<string> {
  const { region, clientId, username, password } = cfg.coa;
  if (!clientId || !username || !password) {
    throw new Error(
      "COA token minting not configured — set COA_CLIENT_ID + COA_USER + COA_PASS, or supply a static COA_TOKEN."
    );
  }
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
  if (!token) throw new Error("Cognito InitiateAuth returned no IdToken.");
  return token;
}

async function getCoaToken(cfg: ProxyConfig): Promise<string> {
  if (cfg.coa.staticToken) return cfg.coa.staticToken;

  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt - REFRESH_SKEW_MS > now) return tokenCache.token;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const token = await mint(cfg);
      tokenCache = { token, expiresAt: readExpiry(token) || now + 55 * 60 * 1000 };
      return token;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

// ── Hero-answer cache (optional, demo reliability) ────────────────────────────

interface CachedAnswer {
  answer: string;
  tier?: number;
  confidence?: number;
  supportingContent?: Array<Record<string, unknown>>;
}
const cacheMemo = new Map<string, Record<string, CachedAnswer>>();

function normalizeQuestion(q: string): string {
  return q
    .replace(/answer concisely in under \d+ words.*/i, "")
    .replace(/answer in under \d+ words.*/i, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function cacheLookup(cfg: ProxyConfig, namespace: string, question: string): CachedAnswer | null {
  if (!cfg.cacheDir) return null;
  // COA addresses namespaces by UUID; cache files are named by vertical. The
  // UUID → vertical map comes from COA_NAMESPACE_<VERTICAL> env vars (config.ts).
  const cacheKey = cfg.namespaceAliases[namespace] ?? namespace;
  // Cache keys become file names — only allow plain basenames.
  if (!/^[A-Za-z0-9_-]+$/.test(cacheKey)) return null;
  let table = cacheMemo.get(cacheKey);
  if (!table) {
    try {
      const file = path.join(cfg.cacheDir, `${cacheKey}.json`);
      table = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, CachedAnswer>) : {};
    } catch {
      table = {};
    }
    cacheMemo.set(cacheKey, table);
  }
  const key = normalizeQuestion(question);
  if (table[key]) return table[key];
  for (const [k, v] of Object.entries(table)) {
    if ((k.includes(key) || key.includes(k)) && Math.abs(k.length - key.length) < 15) return v;
  }
  return null;
}

// ── COA query ─────────────────────────────────────────────────────────────────

export interface CoaAnswer {
  answer: string;
  tier?: number;
  confidence?: number;
  namespace: string;
  source: "cache" | "live";
  supporting?: Array<Record<string, unknown>>;
  latencyMs: number;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`COA query exceeded ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Ask COA a question against a namespace. Returns the governed, graph-grounded
 * answer — the SAME engine GroundWork calls. Hero questions can be served from
 * the local cache (genuine pre-captured COA output); everything else runs live.
 */
export async function coaQuery(cfg: ProxyConfig, namespace: string, question: string): Promise<CoaAnswer> {
  const start = Date.now();

  const cached = cacheLookup(cfg, namespace, question);
  if (cached) {
    return {
      answer: cached.answer,
      tier: cached.tier,
      confidence: cached.confidence,
      namespace,
      source: "cache",
      supporting: cached.supportingContent,
      latencyMs: Date.now() - start,
    };
  }

  const token = await getCoaToken(cfg);
  // Keep COA's Tier-3 synthesis focused (same directive GroundWork uses) so it
  // returns a crisp chain rather than a wall of text.
  const conciseQuestion = `${question} Answer concisely, focusing on the key entities and the chain between them.`;

  // AgentCore SSE transport first (if configured): COA's REST query sits behind
  // API Gateway's hard ~29s cap, but Tier-3 synthesis runs 20-90s → 504. The
  // AgentCore runtime streams the answer with no gateway cap. On any failure we
  // fall through to REST, so enabling it can only help. Mirrors GroundWork.
  const endpoint = buildAgentCoreEndpoint(cfg.coa.region, cfg.serveRuntimeArn);
  if (cfg.transport === "agentcore" && endpoint) {
    try {
      const raw = await agentCoreQuery({
        endpoint,
        token,
        sub: readSub(token),
        namespace,
        query: conciseQuestion,
        options: { execute: true, mode: "standard", includeSupporting: true, maxResults: 5 },
        timeoutMs: cfg.queryTimeoutMs,
      });
      const res = (raw.result ?? {}) as Record<string, unknown>;
      const answer = String(res.synthesizedAnswer ?? res.answer ?? "");
      const confRaw = res.confidence as { score?: number } | number | undefined;
      const confidence = typeof confRaw === "object" ? confRaw?.score : confRaw;
      if (answer) {
        return {
          answer,
          tier: typeof res.tier === "number" ? res.tier : undefined,
          confidence,
          namespace,
          source: "live",
          supporting: Array.isArray(res.supportingContent)
            ? (res.supportingContent as Array<Record<string, unknown>>)
            : undefined,
          latencyMs: Date.now() - start,
        };
      }
      // Empty answer → fall through to REST rather than return nothing.
    } catch (err) {
      console.warn(`coaQuery: AgentCore failed, falling back to REST — ${(err as Error).message}`);
    }
  }

  const run = fetch(`${cfg.coaBaseUrl}/namespaces/${encodeURIComponent(namespace)}/query`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      query: conciseQuestion,
      execute: true,
      mode: "standard",
      includeSupporting: true,
      maxResults: 5,
    }),
  }).then(async (resp) => {
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      const hint = resp.status === 403 ? " (COA token may be expired — it refreshes automatically on next call)" : "";
      throw new Error(`COA query failed: ${resp.status} ${resp.statusText} ${text}${hint}`.trim());
    }
    return resp.json() as Promise<Record<string, unknown>>;
  });

  const raw = await withTimeout(run, cfg.queryTimeoutMs);
  const res = (raw.result ?? raw) as Record<string, unknown>;
  const answer = String(res.synthesizedAnswer ?? res.answer ?? "");
  const confidenceRaw = res.confidence as { score?: number } | number | undefined;
  const confidence = typeof confidenceRaw === "object" ? confidenceRaw.score : confidenceRaw;

  return {
    answer,
    tier: typeof res.tier === "number" ? res.tier : undefined,
    confidence,
    namespace,
    source: "live",
    supporting: Array.isArray(res.supportingContent) ? (res.supportingContent as Array<Record<string, unknown>>) : undefined,
    latencyMs: Date.now() - start,
  };
}

/**
 * Format a COA answer into a single Markdown block for Quick's chat surface.
 * Quick renders text (not an interactive graph), so we present the synthesized
 * chain plus the source systems it was stitched from — the evidence trail.
 */
export function formatForQuick(a: CoaAnswer): string {
  // LEADING source tag — a bold first line the agent is unlikely to strip (a
  // trailing italic footer gets dropped when Quick reformats the answer). This
  // is how a demo-watcher can always tell live-vs-cached at a glance.
  const tag = a.source === "cache" ? "**🟡 [CACHED COA ANSWER]**" : "**🟢 [LIVE COA]**";
  const lines: string[] = [tag, "", a.answer.trim()];

  const sources = citationTitles(a.supporting);
  if (sources.length) {
    lines.push("", "**Evidence (source documents):**", ...sources.map((s) => `- ${s}`));
  }

  const meta: string[] = [];
  if (a.tier != null) meta.push(`COA tier ${a.tier}`);
  if (a.confidence != null) meta.push(`confidence ${a.confidence}`);
  meta.push(`namespace ${a.namespace}`);
  meta.push(a.source === "cache" ? "pre-captured COA output" : "live COA");
  lines.push("", `_Source: ${meta.join(" · ")}_`);
  return lines.join("\n");
}

function citationTitles(supporting?: Array<Record<string, unknown>>): string[] {
  if (!supporting?.length) return [];
  const titles = new Set<string>();
  for (const s of supporting) {
    const src = String(s.sourceDoc ?? s.source ?? "");
    // The captured supporting chunks embed a "source": "(path, ...)" string;
    // lift a readable file name out of it when present.
    const m = /([\w-]+\.md)/.exec(src) ?? /([\w-]+\.md)/.exec(String(s.text ?? ""));
    if (m) titles.add(m[1]);
  }
  return Array.from(titles).slice(0, 8);
}
