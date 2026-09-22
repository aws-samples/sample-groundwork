/**
 * AgentCore Runtime transport for COA queries — the timeout-free alternative to
 * the REST/API-Gateway path.
 *
 * Why this exists: COA's REST surface sits behind API Gateway, whose Lambda-proxy
 * integration has a hard ~29s response cap. COA's Tier-3 graph synthesis routinely
 * runs 20-90s, so a graph query over REST intermittently 504s at the gateway even
 * though serve itself allows up to ~170s. The AgentCore Runtime `/invocations`
 * endpoint is a *different host* (not behind that API Gateway) and streams the
 * answer back over SSE, so the 29s ceiling does not apply.
 *
 * This module mirrors COA's own web-app client
 * (third_party/coa/packages/web-app/src/utils/invoke-agentcore.ts and
 * api-hooks/use-playground-stream.ts). It is server-side and does NOT stream to
 * the browser token-by-token; it consumes the whole SSE stream and returns the
 * terminal `done` payload, so CoaProvider.query() can treat it exactly like the
 * REST response envelope ({ result: QueryResult }).
 *
 * Auth: same Cognito ID token as REST (coa-token.ts). AgentCore validates the
 * token audience and Cedar reads the email/groups claims. Programmatic minting
 * via USER_PASSWORD_AUTH is enabled on the default app client in COA dev
 * environments (confirmed with the COA team); M2M/agent auth is a future path.
 */

const RUNTIME_SESSION_ID_MIN_LEN = 33;

/**
 * Build the AgentCore `/invocations` URL from a runtime ARN + region. Mirrors
 * COA's build-query-endpoint.ts, including the region-format guard that prevents
 * URL injection from a tampered/misconfigured value. Returns undefined when the
 * ARN is missing or the region is malformed — the caller then falls back to REST.
 */
export function buildAgentCoreEndpoint(region: string, runtimeArn?: string): string | undefined {
  if (!runtimeArn) return undefined;
  if (!/^[a-z]{2}-[a-z]+-\d+$/.test(region)) return undefined;
  const encoded = encodeURIComponent(runtimeArn);
  return `https://bedrock-agentcore.${region}.amazonaws.com/runtimes/${encoded}/invocations?qualifier=DEFAULT`;
}

/**
 * Derive a stable, ≥33-char AgentCore runtime session id from an OIDC `sub`.
 * Mirrors COA's runtime-session-id.ts. The `NNN-` length prefix makes the
 * encoding injective so two distinct subs never collide onto one sticky session
 * (padding alone would: "noah" and "noah0" both pad to "noah0000…"). Falls back
 * to a fixed but valid id when no sub is available, so the header is still sent.
 */
export function deriveRuntimeSessionId(sub: string | undefined): string {
  const seed = sub && sub.length > 0 ? sub : "groundwork-server";
  const prefixed = `${seed.length.toString().padStart(3, "0")}-${seed}`;
  return prefixed.padEnd(RUNTIME_SESSION_ID_MIN_LEN, "0");
}

export interface AgentCoreQueryArgs {
  endpoint: string;
  token: string;
  /** OIDC sub for the sticky-session header (may be empty). */
  sub: string;
  /** COA namespace UUID (NOT the display name — a name matches no partition). */
  namespace: string;
  query: string;
  /** Extra options merged into the request `options` object (e.g. { mode }). */
  options?: Record<string, unknown>;
  /** Overall timeout; well above serve's ~170s cap so the stream can finish. */
  timeoutMs?: number;
}

/** A COA QueryResult envelope, matching what the REST `query` path returns. */
export interface AgentCoreResult {
  result: Record<string, unknown>;
}

/**
 * Invoke COA over AgentCore SSE and return the terminal `done` payload as
 * `{ result }` (same shape CoaProvider.query already consumes from REST).
 *
 * Throws on an `error` frame, a non-OK HTTP status, or a stream that ends
 * without a terminal frame — the caller decides whether to fall back to REST.
 */
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

/**
 * Read the SSE stream to its terminal frame.
 *
 * AgentCore frames each event as `data: {json}\n\n`. The event *type* is a
 * `type` field INSIDE the JSON (step | token | done | error) — NOT the SSE
 * `event:` field, so a naive `event:`-keyed parser sees nothing. We only care
 * about the terminal frames: `done` carries the answer in `payload.result`;
 * `error` carries `payload.message`. `step`/`token` frames are progress and are
 * ignored (this is a non-streaming consumer).
 */
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
      return; // keepalive/comment/partial — skip
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

    // SSE events are separated by a blank line. Process complete events as they
    // arrive so a terminal `done`/`error` can short-circuit a long stream.
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

  // Flush any trailing event with no blank-line terminator (stream closed).
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

/** Index of the first blank-line SSE separator (\n\n or \r\n\r\n), or -1. */
function indexOfDoubleNewline(s: string): number {
  const lf = s.indexOf("\n\n");
  const crlf = s.indexOf("\r\n\r\n");
  if (lf === -1) return crlf;
  if (crlf === -1) return lf;
  return Math.min(lf, crlf);
}
