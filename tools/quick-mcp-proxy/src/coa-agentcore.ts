/**
 * AgentCore Runtime transport for COA queries — the timeout-free alternative to
 * the REST/API-Gateway path. Ported from GroundWork's
 * src/lib/context/coa-agentcore.ts (kept functionally identical).
 *
 * Why: COA's REST surface sits behind API Gateway with a hard ~29s cap, but
 * Tier-3 synthesis runs 20-90s → 504. The AgentCore `/invocations` endpoint is a
 * different host (no gateway cap) that streams the answer over SSE. This consumes
 * the whole stream server-side and returns the terminal `done` payload as
 * `{ result }`, the same envelope the REST path returns.
 */

const RUNTIME_SESSION_ID_MIN_LEN = 33;

export function buildAgentCoreEndpoint(region: string, runtimeArn?: string): string | undefined {
  if (!runtimeArn) return undefined;
  if (!/^[a-z]{2}-[a-z]+-\d+$/.test(region)) return undefined;
  const encoded = encodeURIComponent(runtimeArn);
  return `https://bedrock-agentcore.${region}.amazonaws.com/runtimes/${encoded}/invocations?qualifier=DEFAULT`;
}

/** Decode an OIDC `sub` from an ID token (unverified — routing hint only). */
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

export function deriveRuntimeSessionId(sub: string | undefined): string {
  const seed = sub && sub.length > 0 ? sub : "groundwork-proxy";
  const prefixed = `${seed.length.toString().padStart(3, "0")}-${seed}`;
  return prefixed.padEnd(RUNTIME_SESSION_ID_MIN_LEN, "0");
}

export interface AgentCoreQueryArgs {
  endpoint: string;
  token: string;
  sub: string;
  namespace: string;
  query: string;
  options?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface AgentCoreResult {
  result: Record<string, unknown>;
}

export async function agentCoreQuery(args: AgentCoreQueryArgs): Promise<AgentCoreResult> {
  const { endpoint, token, sub, namespace, query, options, timeoutMs = 180_000 } = args;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const body = {
    query,
    namespace,
    requestId: globalThis.crypto?.randomUUID?.() ?? `cf-${Date.now()}`,
    options: options ?? {},
    stream: true,
  };

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": deriveRuntimeSessionId(sub),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      const hint =
        resp.status === 401 || resp.status === 403
          ? " (ID token expired/invalid, or USER_PASSWORD_AUTH not enabled on this client)"
          : "";
      throw new Error(`AgentCore query failed: ${resp.status} ${resp.statusText} ${detail}${hint}`.trim());
    }
    if (!resp.body) throw new Error("AgentCore query returned no response body");

    return await consumeStream(resp.body);
  } finally {
    clearTimeout(timer);
  }
}

async function consumeStream(stream: ReadableStream<Uint8Array>): Promise<AgentCoreResult> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done: AgentCoreResult | null = null;
  let errorMessage: string | null = null;

  const handleFrame = (jsonText: string) => {
    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(jsonText) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = evt.type;
    if (type === "done") {
      const payload = (evt.payload ?? {}) as Record<string, unknown>;
      const result = (payload.result ?? {}) as Record<string, unknown>;
      done = { result };
    } else if (type === "error") {
      const payload = (evt.payload ?? {}) as Record<string, unknown>;
      errorMessage = String(payload.message ?? payload.error ?? "AgentCore stream error");
    }
  };

  for (;;) {
    const { done: streamDone, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = indexOfDoubleNewline(buffer)) !== -1) {
      const rawEvent = buffer.slice(0, sep);
      buffer = buffer.slice(sep).replace(/^(\r?\n){1,2}/, "");
      for (const line of rawEvent.split(/\r?\n/)) {
        if (line.startsWith("data:")) handleFrame(line.slice(5).trimStart());
      }
      if (done || errorMessage) break;
    }
    if (done || errorMessage) break;
    if (streamDone) break;
  }

  if (!done && !errorMessage && buffer.trim()) {
    for (const line of buffer.split(/\r?\n/)) {
      if (line.startsWith("data:")) handleFrame(line.slice(5).trimStart());
    }
  }

  try {
    await reader.cancel();
  } catch {
    /* best effort */
  }

  if (errorMessage) throw new Error(`AgentCore stream error: ${errorMessage}`);
  if (!done) throw new Error("AgentCore stream ended without a terminal 'done' frame");
  return done;
}

function indexOfDoubleNewline(s: string): number {
  const lf = s.indexOf("\n\n");
  const crlf = s.indexOf("\r\n\r\n");
  if (lf === -1) return crlf;
  if (crlf === -1) return lf;
  return Math.min(lf, crlf);
}
