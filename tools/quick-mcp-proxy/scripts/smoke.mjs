/**
 * Local smoke test for the Quick→COA MCP proxy.
 *
 * Exercises the MCP protocol exactly as Quick would:
 *   1. initialize
 *   2. tools/list   → expect context_query with a Draft-7 inputSchema
 *   3. tools/call   → ask a cached hero question, expect the NorthStar answer
 *
 * Run against a proxy pointed at the local hero cache (no live COA needed):
 *   export QUICK_INBOUND_TOKEN="$(openssl rand -hex 32)"
 *   COA_BASE_URL=http://unused \
 *   COA_TOKEN=dummy \
 *   COA_CACHE_DIR=../../src/data/coa-cache \
 *   QUICK_INBOUND_TOKENS="$QUICK_INBOUND_TOKEN" \
 *   PORT=8787 node dist/server.js &
 *   node scripts/smoke.mjs
 *
 * Against a deployed proxy, set PROXY_URL and put an OAuth access token in
 * QUICK_INBOUND_TOKEN.
 */
const BASE = process.env.PROXY_URL ?? "http://127.0.0.1:8787/mcp";
const INBOUND = process.env.QUICK_INBOUND_TOKEN; // bearer the proxy requires

const HERO_Q =
  "The VoltCore 20V drill has a cluster of cold-weather battery reviews — which cell lot and supplier are the root cause?";

function headers() {
  const h = {
    "content-type": "application/json",
    // MCP StreamableHTTP requires the client to accept both JSON and SSE.
    accept: "application/json, text/event-stream",
  };
  if (INBOUND) h.authorization = `Bearer ${INBOUND}`;
  return h;
}

/** StreamableHTTP may answer with a single JSON body or an SSE stream. Parse both. */
async function parse(resp) {
  const ct = resp.headers.get("content-type") ?? "";
  const text = await resp.text();
  if (ct.includes("text/event-stream")) {
    // Pull the last `data:` line's JSON.
    const dataLines = text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .filter(Boolean);
    if (!dataLines.length) throw new Error(`No SSE data frames in response:\n${text}`);
    return JSON.parse(dataLines[dataLines.length - 1]);
  }
  return JSON.parse(text);
}

async function rpc(method, params, id) {
  const resp = await fetch(BASE, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  if (!resp.ok) {
    throw new Error(`${method} → HTTP ${resp.status} ${resp.statusText}: ${await resp.text().catch(() => "")}`);
  }
  return parse(resp);
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main() {
  console.log(`Smoke-testing proxy at ${BASE}\n`);

  console.log("1. initialize");
  const init = await rpc(
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "smoke", version: "0.0.0" },
    },
    1
  );
  assert(init.result?.serverInfo?.name === "groundwork-coa-proxy", "server identifies as groundwork-coa-proxy");

  console.log("2. tools/list");
  const list = await rpc("tools/list", {}, 2);
  const tool = (list.result?.tools ?? []).find((t) => t.name === "context_query");
  assert(Boolean(tool), "context_query tool is listed");
  assert(tool.inputSchema?.type === "object", "inputSchema is a JSON Schema object");
  assert(
    Array.isArray(tool.inputSchema?.required) && tool.inputSchema.required.includes("question"),
    "inputSchema.required is a root-level array containing 'question' (Draft-7 compliant)"
  );

  console.log("3. tools/call context_query (cached hero question)");
  const call = await rpc(
    "tools/call",
    { name: "context_query", arguments: { question: HERO_Q, namespace: "prodquality" } },
    3
  );
  const textOut = (call.result?.content ?? []).map((c) => c.text).join("\n");
  assert(!call.result?.isError, "call did not error");
  assert(/NorthStar/i.test(textOut), "answer names NorthStar (the real cached COA root-cause)");
  assert(/NS-2411/i.test(textOut), "answer names cell lot NS-2411");
  console.log("\n--- answer returned to Quick ---\n" + textOut + "\n--------------------------------\n");

  console.log("ALL SMOKE CHECKS PASSED ✅");
}

main().catch((e) => {
  console.error("\nSMOKE TEST FAILED ❌\n" + e.message);
  process.exit(1);
});
