/**
 * Quick → COA MCP proxy (streamable HTTP).
 *
 * Amazon Quick is a managed MCP client that connects to a remote HTTP MCP
 * server over HTTP streaming (SSE is secondary; stdio is unsupported). This
 * server exposes ONE tool, `context_query`, which proxies a question to COA's
 * governed, graph-grounded `query` operation — the SAME engine GroundWork uses.
 *
 * Auth bridge (the whole reason this proxy exists):
 *   INBOUND  — Quick authenticates via service auth (OAuth client_credentials).
 *              It presents an IdP-issued access token on each MCP request; we
 *              verify the JWT (auth.ts). Nothing configured ⇒ deny everything.
 *              The listener binds 127.0.0.1 unless BIND_HOST says otherwise,
 *              and a non-loopback bind requires OAuth verification.
 *   OUTBOUND — we mint COA's Cognito USER OIDC token server-side (coa-client)
 *              and call COA with it. Quick never sees a COA token.
 *
 * Note on transport: MCP's StreamableHTTP transport uses a single POST endpoint
 * (default `/mcp`). Quick's "MCP server endpoint" field is that URL.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { loadConfig, type ProxyConfig } from "./config.js";
import { coaQuery, formatForQuick } from "./coa-client.js";
import { createAuthorizer, describeAuth, isLoopbackHost } from "./auth.js";

const MCP_PATH = process.env.MCP_PATH ?? "/mcp";

/** Build the MCP server with the single context_query tool. */
function buildMcpServer(cfg: ProxyConfig): McpServer {
  const server = new McpServer(
    { name: "groundwork-coa-proxy", version: "0.1.0" },
    {
      instructions:
        "Query a governed, graph-grounded knowledge graph (AWS Context Ontology Accelerator / COA). " +
        "Use context_query for cross-system, multi-hop questions — root cause, blast radius, " +
        "'what is connected to what' — where the answer must be traced across multiple source systems.",
    }
  );

  // The tool. inputSchema is JSON Schema Draft 7 (required is a ROOT-LEVEL
  // array — the MCP SDK emits Draft-7-compliant schemas from this shape, which
  // is what Quick validates at publish time).
  server.registerTool(
    "context_query",
    {
      title: "Context query (COA knowledge graph)",
      description:
        "Ask a cross-system question against the COA knowledge graph and get a governed, " +
        "graph-grounded answer with its evidence chain. Best for root-cause, blast-radius, " +
        "and relationship questions that span multiple source systems.",
      // Zod shape → the SDK emits a JSON Schema Draft-7 inputSchema in
      // tools/list (required as a root-level array), which is exactly what
      // Quick validates at publish time.
      inputSchema: {
        question: z
          .string()
          .describe("The natural-language question to answer over the knowledge graph."),
        namespace: z
          .string()
          .optional()
          .describe("Optional COA namespace (domain) to query. Defaults to the proxy's configured namespace."),
      },
    },
    async (args: { question?: string; namespace?: string }) => {
      const question = (args.question ?? "").trim();
      if (!question) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: "Please provide a 'question' to ask the knowledge graph." }],
        };
      }
      const namespace = (args.namespace ?? cfg.defaultNamespace).trim();
      try {
        const answer = await coaQuery(cfg, namespace, question);
        return { content: [{ type: "text" as const, text: formatForQuick(answer) }] };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `COA query failed: ${(err as Error).message}`,
            },
          ],
        };
      }
    }
  );

  return server;
}

/** Max MCP request body. A tools/call with one question is a few KB. */
const MAX_BODY_BYTES = 1024 * 1024;

class BodyTooLargeError extends Error {}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let exceeded = false;
    req.on("data", (c: Buffer) => {
      if (exceeded) return; // drain and discard the rest
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        exceeded = true;
        chunks.length = 0;
        reject(new BodyTooLargeError("request body too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function main() {
  const cfg = loadConfig();
  const loopback = isLoopbackHost(cfg.host);

  // Never expose a non-loopback listener without real (OAuth JWT) auth.
  if (!loopback && !cfg.inbound.oauth) {
    throw new Error(
      `BIND_HOST=${cfg.host} is not loopback and QUICK_OAUTH_ISSUER is not set — refusing to start. ` +
        "Configure OAuth client_credentials verification (see docs/QUICK_MCP_INTEGRATION.md) or bind to 127.0.0.1."
    );
  }
  if (!loopback && cfg.inbound.localTokens.length) {
    console.warn("QUICK_INBOUND_TOKENS is ignored on a non-loopback bind (local-testing credential only).");
  }
  const authorize = createAuthorizer(cfg.inbound, { loopback });

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    // Liveness check for load balancers / smoke tests. Unauthenticated, so it
    // discloses nothing about configuration.
    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname !== MCP_PATH) {
      res.writeHead(404).end("Not found");
      return;
    }

    // Inbound service-auth gate (Quick's client_credentials bearer).
    if (!(await authorize(req.headers["authorization"]))) {
      // 401 with WWW-Authenticate is also how an OAuth-discovering client would
      // learn where to get a token; for service auth we simply reject.
      res.writeHead(401, {
        "content-type": "application/json",
        "www-authenticate": 'Bearer realm="groundwork-coa-proxy"',
      });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    // One MCP server + transport per request (stateless mode). Quick does not
    // need server-managed sessions for a single stateless tool, and stateless
    // mode avoids holding per-session state across Quick's connection pool.
    const server = buildMcpServer(cfg);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      const bodyText = req.method === "POST" ? await readBody(req) : undefined;
      const parsed = bodyText ? JSON.parse(bodyText) : undefined;
      await transport.handleRequest(req, res, parsed);
    } catch (err) {
      if (err instanceof BodyTooLargeError) {
        if (!res.headersSent) res.writeHead(413, { "content-type": "application/json", connection: "close" });
        res.end(JSON.stringify({ error: "payload too large" }));
        return;
      }
      console.error("MCP request error:", (err as Error).message);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null }));
      }
    }
  });

  httpServer.listen(cfg.port, cfg.host, () => {
    const hostForUrl = cfg.host.includes(":") ? `[${cfg.host}]` : cfg.host;
    console.log(`quick-mcp-proxy listening on http://${hostForUrl}:${cfg.port}${MCP_PATH}`);
    console.log(`  COA base      : ${cfg.coaBaseUrl}`);
    console.log(`  default ns    : ${cfg.defaultNamespace}`);
    console.log(`  inbound auth  : ${describeAuth(cfg.inbound, loopback)}`);
    console.log(`  cache dir     : ${cfg.cacheDir ?? "(none — all queries live)"}`);
    void randomUUID; // reserved for future session mode
  });
}

main().catch((err) => {
  console.error("Fatal:", (err as Error).message);
  process.exit(1);
});
