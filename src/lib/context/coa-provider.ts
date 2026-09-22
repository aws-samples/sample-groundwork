import type { ContextProvider } from "./provider";
import { VERTICAL_TO_PACK } from "./pack-loader";
import { getCoaToken, readSub } from "./coa-token";
import { agentCoreQuery, buildAgentCoreEndpoint } from "./coa-agentcore";
import { resolveSourceSystem } from "./source-systems";
import { getCachedAnswer } from "./coa-cache";
import type { Citation } from "./types";
import type {
  Vertical,
  QueryMode,
  Fidelity,
  Node,
  Edge,
  GraphStats,
  QueryResult,
  MetricDef,
  MetricResult,
  OntologySchema,
  Document,
} from "./types";

/**
 * Clean + present raw vector-search chunks for display.
 *
 * Retrieved chunks come straight from the ingested `.md` source docs, so they
 * carry noise that reads badly in a UI:
 *   - YAML frontmatter blocks (--- ... ---) with source_url/fetched_at/etc.
 *   - Near-duplicate chunks (kNN often returns overlapping windows of one doc).
 * We strip the frontmatter (surfacing only its human-useful `title`/`source_url`
 * as a heading), collapse duplicates, and number each surviving passage so the
 * panel reads as a ranked list of evidence rather than a raw file paste.
 */
function formatVectorChunks(
  chunks: Array<Record<string, unknown>>
): { answer: string; citations: Array<{ documentId: string; title: string; factCount: number }> } {
  const seen = new Set<string>();
  const out: string[] = [];
  const citations: Array<{ documentId: string; title: string; factCount: number }> = [];
  let rank = 0;

  // Match a YAML frontmatter block anywhere in the text (leading or embedded),
  // capturing its body so we can lift out title/source_url.
  const FM = /(^|\n)---[ \t]*\n([\s\S]*?)\n---[ \t]*\n?/g;

  for (const c of chunks) {
    let text = String(c.text ?? c.content ?? "").trim();
    if (!text) continue;

    // Lift the first useful title + source_url out of ANY frontmatter block,
    // then strip every frontmatter block from the body.
    let title = "";
    let url = "";
    let m: RegExpExecArray | null;
    FM.lastIndex = 0;
    while ((m = FM.exec(text)) !== null) {
      const body = m[2];
      if (!title) title = /^\s*title:\s*["']?(.+?)["']?\s*$/m.exec(body)?.[1] ?? "";
      if (!url) url = /^\s*source_url:\s*["']?(.+?)["']?\s*$/m.exec(body)?.[1] ?? "";
    }
    text = text.replace(FM, "\n\n").trim();

    // The doc repeats its title as an H1 (`# T0873.001 — …`) right after the
    // frontmatter. Drop that leading H1 so it doesn't duplicate our heading.
    text = text.replace(/^#\s+.*\n+/, "").trim();

    if (!text) continue;

    // Dedupe on a normalized fingerprint of the first ~200 chars.
    const fp = text.slice(0, 200).replace(/\s+/g, " ").toLowerCase();
    if (seen.has(fp)) continue;
    seen.add(fp);

    rank++;
    // Heading: link to the real origin doc when we have a source_url.
    const name = title || (typeof c.sourceDocumentId === "string" && c.sourceDocumentId) || "";
    const headingText = name
      ? url
        ? `[${name}](${url})`
        : String(name)
      : `Passage ${rank}`;
    // Relevance score → a match badge (COA returns 0..1).
    const score = typeof c.relevanceScore === "number" ? c.relevanceScore : undefined;
    const badge = score != null ? `  \`${Math.round(score * 100)}% match\`` : "";
    out.push(`### ${rank}. ${headingText}${badge}\n\n${text}`);

    // Emit a citation so the UI can show a "source documents" list with the
    // real filename/title. documentId links to the origin doc when known.
    const docId = url || (typeof c.chunkId === "string" ? c.chunkId : `chunk-${rank}`);
    citations.push({
      documentId: docId,
      title: String(name) || `Passage ${rank}`,
      factCount: score != null ? Math.round(score * 100) : 1,
    });
  }

  return { answer: out.join("\n\n---\n\n"), citations };
}

/**
 * Build per-system citations for a graph answer from COA's `supportingContent`.
 *
 * Each supporting item's `text` is a JSON blob whose `source` field carries the
 * real document filename (e.g. ".../05-purchase-order-ledger.md (…)"). We pull
 * that filename, resolve it to a friendly title + originating system of record
 * (SAP Ariba, LIMS, Salesforce, …), and de-dupe. `factCount` counts how many
 * supporting chunks traced to each document. The result is the "evidence
 * stitched across systems" list the GraphRAG panel renders.
 */
function buildGraphCitations(supporting: unknown, vertical: string): Citation[] {
  if (!Array.isArray(supporting)) return [];
  const byDoc = new Map<string, Citation>();

  for (const item of supporting as Array<Record<string, unknown>>) {
    // The filename lives in the chunk text's `source` field (a JSON string) or,
    // as a fallback, anywhere in the text. Extract the first "*.md" token.
    const text = typeof item.text === "string" ? item.text : "";
    const rawSource =
      /"source"\s*:\s*"([^"]+)"/.exec(text)?.[1] ??
      (typeof item.sourceDoc === "string" ? item.sourceDoc : "") ??
      text;
    const { title, system } = resolveSourceSystem(String(rawSource), vertical);
    const key = `${title}|${system}`;
    const existing = byDoc.get(key);
    if (existing) {
      existing.factCount += 1;
    } else {
      byDoc.set(key, { documentId: key, title, system, factCount: 1 });
    }
  }
  return Array.from(byDoc.values());
}

/**
 * Mode 3 — Live COA. Implements the same ContextProvider interface by calling a
 * deployed Context Ontology Accelerator.
 *
 * COA exposes six MCP tools (verified against the vendored source,
 * packages/mcp-server/src/coa_mcp/server.py):
 *   query · translate_sparql · rag_retrieval · graph_traversal ·
 *   list_metrics · describe_schema
 * All are namespace-scoped. GroundWork maps one vertical → one COA namespace
 * (the same namespace a pack is installed into via `coa-pack install`).
 *
 * Transport note: COA's tools run over MCP (on AgentCore Runtime) and, for
 * machine callers, are fronted by the AgentCore Gateway (see infra/gateway and
 * docs/MODE3_COA.md). Because the exact HTTP surface depends on the customer's
 * deployment (direct Data Layer REST vs. Gateway MCP endpoint), this class keeps
 * all wire calls behind a single `callTool()` method — that is the one place to
 * adapt per deployment. Everything above it is deployment-agnostic.
 *
 * See docs/RUNNING.md and docs/MODE3_COA.md.
 */
export class CoaProvider implements ContextProvider {
  readonly fidelity: Fidelity = "coa";

  private readonly baseUrl: string;
  /** Token captured at construction — a fallback if the env token is unset later. */
  private readonly initialToken?: string;
  /** Optional per-vertical namespace override (env: COA_NAMESPACE_OTSEC, ...). */
  private readonly namespaceOverride: Record<string, string>;
  /**
   * Query transport. "rest" (default) uses the API-Gateway REST surface — simple
   * and portable, but capped at ~29s by API Gateway. "agentcore" sends the slow
   * `query` synthesis over the AgentCore Runtime SSE endpoint instead, which has
   * no 29s ceiling (serve allows ~170s). Set COA_TRANSPORT=agentcore +
   * COA_SERVE_RUNTIME_ARN to enable. All other (fast) tools stay on REST.
   */
  private readonly transport: "rest" | "agentcore";
  private readonly serveRuntimeArn?: string;

  /**
   * Resolve a COA OIDC bearer token for this request. Precedence:
   *   1. process.env.COA_TOKEN — an explicitly supplied token (local script
   *      flow, refreshed by scripts/demo-coa.sh). Read fresh each call so a
   *      re-mint takes effect with no restart.
   *   2. this.initialToken — the constructor fallback.
   *   3. Server-side auto-mint (coa-token.ts) — when COA_USER/COA_PASS/
   *      COA_CLIENT_ID are set (hosted flow). Mints + caches + refreshes so a
   *      public deployment never 403s on an aged-out token.
   */
  private async resolveToken(): Promise<string | undefined> {
    const explicit = process.env.COA_TOKEN || this.initialToken;
    if (explicit) return explicit;
    return (await getCoaToken()) ?? undefined;
  }

  constructor(baseUrl?: string, token?: string) {
    if (!baseUrl) {
      throw new Error(
        "CONTEXT_MODE=coa requires COA_BASE_URL (the deployed COA endpoint). See docs/MODE3_COA.md."
      );
    }
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.initialToken = token;
    this.transport = process.env.COA_TRANSPORT === "agentcore" ? "agentcore" : "rest";
    this.serveRuntimeArn = process.env.COA_SERVE_RUNTIME_ARN || undefined;
    this.namespaceOverride = {
      otsec: process.env.COA_NAMESPACE_OTSEC ?? "",
      energy: process.env.COA_NAMESPACE_ENERGY ?? "",
      manufacturing: process.env.COA_NAMESPACE_MANUFACTURING ?? "",
      cyber: process.env.COA_NAMESPACE_CYBER ?? "",
      // Product Quality (drill root-cause) has its own COA namespace, installed
      // with the manufacturing ontology pack. Resolved by UUID via env.
      prodquality: process.env.COA_NAMESPACE_PRODQUALITY ?? "",
    };
  }

  /** vertical → COA namespace id. Defaults to the pack directory name. */
  private namespace(vertical: Vertical): string {
    return this.namespaceOverride[vertical] || VERTICAL_TO_PACK[vertical] || vertical;
  }

  async getGraph(vertical: Vertical): Promise<{ nodes: Node[]; edges: Edge[]; stats: GraphStats }> {
    // COA has no "return the whole graph" tool by design (the graph is virtual,
    // Ontop over live sources). We seed the visualization from a broad traversal
    // and let describe_schema drive typing. Callers wanting the full picture in
    // Mode 3 should traverse from a known entry node.
    const schema = await this.describeSchema(vertical);
    const stats: GraphStats = {
      totalNodes: 0,
      totalEdges: 0,
      totalDocuments: 0,
      nodesByType: Object.fromEntries(schema.classes.map((c) => [c.id, 0])),
      edgesByRelation: Object.fromEntries(schema.properties.map((p) => [p.id, 0])),
      totalChunks: 0,
    };
    return { nodes: [], edges: [], stats };
  }

  async getStats(vertical: Vertical): Promise<GraphStats> {
    return (await this.getGraph(vertical)).stats;
  }

  async traverse(vertical: Vertical, nodeId: string, hops: number): Promise<{ nodes: Node[]; edges: Edge[] }> {
    const res = await this.callTool("graph_traversal", {
      namespace_id: this.namespace(vertical),
      startUri: nodeId,
      maxDepth: hops,
    });
    return normalizeSubgraph(res, vertical);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async query(vertical: Vertical, question: string, mode: QueryMode, startNodes: string[] = [], model?: string): Promise<QueryResult> {
    const start = Date.now();
    const namespace_id = this.namespace(vertical);

    if (mode === "vector") {
      // Serve KBSearch: { chunks: [{text, score, sourceId, ...}], trace }.
      const res = await this.callTool("rag_retrieval", { namespace_id, query: question, topK: 8 });
      const chunks = (res.chunks ?? []) as Array<Record<string, unknown>>;
      const { answer, citations } = formatVectorChunks(chunks);
      return {
        mode: "vector",
        query: question,
        answer: answer || undefined,
        citations: citations.length ? citations : undefined,
        sources: chunks.length,
        latency: Date.now() - start,
        model: "COA kb/search (OpenSearch + Bedrock embeddings)",
        backend: "Context Ontology Accelerator",
      };
    }

    // Demo fast-path: if this is a scripted hero question we've pre-captured a
    // real COA answer for, serve it instantly. COA's Tier-3 latency is variable
    // (~16-30s) and rides the API Gateway 29s cap, so a live query can time out
    // mid-demo and fall back to vector — making the graph panel look broken.
    // The cache is genuine COA output (see scripts/capture-hero-answers.mjs);
    // set COA_DISABLE_CACHE=1 to force the live path. Ad-hoc questions never
    // hit the cache and always go live.
    const cached = getCachedAnswer(vertical, question);
    if (cached) {
      const citations = buildGraphCitations(cached.supportingContent, vertical);
      let subgraph;
      const entry = startNodes[0];
      if (entry) {
        // The subgraph is pure visualization on top of an already-instant cached
        // answer. traverse() is a LIVE COA call, and when COA is cold/slow it can
        // hang for many seconds — which would defeat the whole point of the cache
        // (a hero demo query must be instant). Time-box it hard: if COA doesn't
        // return the subgraph within the budget, render the answer immediately
        // without it. COA_TRAVERSE_TIMEOUT_MS overrides the 2500ms default.
        const budget = Number(process.env.COA_TRAVERSE_TIMEOUT_MS) || 2500;
        const sg = await withTimeout(this.traverse(vertical, entry, 4), budget);
        if (sg) {
          subgraph = { nodes: sg.nodes, edges: sg.edges, nodeCount: sg.nodes.length, edgeCount: sg.edges.length };
        }
      }
      return {
        mode: "graph",
        query: question,
        answer: cached.answer,
        entryNodes: entry ? [entry] : undefined,
        subgraph,
        hops: 4,
        citations: citations.length ? citations : undefined,
        sources: citations.length || (cached.supportingContent?.length ?? undefined),
        latency: Date.now() - start,
        model: `COA tiered resolution (tier ${cached.tier ?? 3}${cached.confidence != null ? `, confidence ${cached.confidence}` : ""})`,
        backend: "Neptune via COA (Ontop VKG)",
        note: "Answer synthesized by COA's Context Manager.",
      };
    }

    // GraphRAG: COA's `query` does tiered resolution (Tier-1 governed metric →
    // Tier-2 SPARQL over VKG → Tier-3 agentic synthesis). Response envelope is
    // { result: QueryResult, requestId, sessionId } where QueryResult carries
    // `tier`, `confidence`, `synthesizedAnswer`, and supporting content.
    // COA's Tier-3 agentic synthesis is an in-line LLM call that runs ~25-30s and
    // sits right at API Gateway's 30s hard timeout — includeSupporting:true +
    // maxResults:50 tips it over into intermittent 504s. Trimming to
    // includeSupporting:false + maxResults:10 holds it near ~25s while still
    // returning the full synthesized answer. The subgraph the UI shows is built
    // from the separate traverse() call below, so dropping supporting content
    // here costs the answer nothing.
    //
    // Even trimmed, the heaviest questions can still tip past 30s. Rather than
    // surface a raw 504, degrade gracefully to the vector path — which is fast
    // and hits the same ingested corpus — so the user always gets a grounded
    // answer. We label it clearly so the demo stays honest about what happened.
    // COA's synthesis latency is dominated by LLM *output length*, not
    // retrieval: verbose Tier-3 answers run 25-31s and straddle API Gateway's
    // hard 29s REST timeout (→ intermittent 504s), while concise answers finish
    // reliably in ~16-22s. So we ask COA for a focused answer and cap the
    // retrieved context. This is the real answer from the graph — just tight —
    // and it demos better (a crisp chain, not a wall of text). Measured: the
    // heaviest questions that used to 504 now return 200 every run.
    //
    // `includeSupporting: true` returns the source chunks COA synthesized over,
    // which we turn into per-system citations for the UI. Verified it stays
    // ~19s with the concise directive, so it's safe under the gateway cap.
    const conciseQuestion =
      `${question} Answer concisely in under 120 words, focusing on the key entities and the chain between them.`;
    const runQuery = () =>
      this.callTool("query", {
        namespace_id,
        query: conciseQuestion,
        execute: true,
        mode: "standard",
        includeSupporting: true,
        maxResults: 5,
      });
    let raw: Awaited<ReturnType<typeof this.callTool>>;
    try {
      raw = await runQuery();
    } catch (err) {
      // COA occasionally returns a transient 5xx (a slow upstream, a cold
      // synthesis worker). These are not deterministic failures — one quick
      // retry usually succeeds — so retry once before giving up.
      const msg1 = (err as Error).message || "";
      const transient = /50\d|502|503|504|timed out/i.test(msg1);
      if (transient) {
        try {
          raw = await runQuery();
        } catch {
          raw = undefined as unknown as Awaited<ReturnType<typeof this.callTool>>;
        }
      }
      if (!raw) {
      // Still failing after a retry — fall back to vector over the same corpus
      // so the user always gets a grounded answer instead of a raw error.
      const vres = await this.callTool("rag_retrieval", { namespace_id, query: question, topK: 8 });
      const chunks = (vres.chunks ?? []) as Array<Record<string, unknown>>;
      const { answer: vanswer, citations } = formatVectorChunks(chunks);
      return {
        mode: "graph",
        query: question,
        answer: vanswer || undefined,
        citations: citations.length ? citations : undefined,
        sources: chunks.length,
        latency: Date.now() - start,
        model: "COA vector fallback (graph synthesis unavailable)",
        backend: "Context Ontology Accelerator",
        fallback: true,
        note: "COA's Tier-3 graph synthesis was momentarily unavailable for this question, so this answer came from the vector retrieval path over the same corpus. Retry to get the full graph-synthesized answer.",
      };
      }
    }
    const res = raw.result ?? raw;
    const answer = res.synthesizedAnswer ?? res.answer;
    const tier = res.tier;
    const confidence = res.confidence?.score ?? res.confidence;

    // Enrich with a subgraph for the UI, traversing from any entry node COA
    // resolved (or a caller-supplied one). This is a *second* COA call on top of
    // an already ~25s query, so keep it strictly best-effort: if it errors or is
    // slow, we still return the synthesized answer rather than failing the whole
    // request. The subgraph is visualization, not the answer.
    const entry = startNodes[0] ?? res.entryUris?.[0] ?? res.entryNodes?.[0];
    let subgraph;
    if (entry) {
      // Enrichment only — never let a slow/cold traverse() add unbounded latency
      // on top of an already ~25s query. Time-box it; if it doesn't return in
      // budget we ship the synthesized answer without the subgraph. Slightly
      // longer than the cache-hit budget since we've already paid the query cost.
      const budget = Number(process.env.COA_TRAVERSE_TIMEOUT_MS) || 5000;
      const sg = await withTimeout(this.traverse(vertical, entry, 4), budget);
      if (sg) {
        subgraph = { nodes: sg.nodes, edges: sg.edges, nodeCount: sg.nodes.length, edgeCount: sg.edges.length };
      }
    }

    // Turn the supporting chunks COA synthesized over into per-system citations
    // — the visible proof the answer was stitched across separate systems of
    // record (SAP Ariba, LIMS, Salesforce, …) rather than one document.
    const citations = buildGraphCitations(res.supportingContent, vertical);

    return {
      mode: "graph",
      query: question,
      answer,
      entryNodes: entry ? [entry] : undefined,
      subgraph,
      hops: 4,
      citations: citations.length ? citations : undefined,
      sources: citations.length || (res.supportingContent as unknown[])?.length || subgraph?.nodeCount,
      latency: Date.now() - start,
      model: `COA tiered resolution (tier ${tier ?? "?"}${confidence != null ? `, confidence ${confidence}` : ""})`,
      backend: "Neptune via COA (Ontop VKG)",
      note: "Answer synthesized by COA's Context Manager. Governed metrics resolve in Tier 1 with no LLM.",
    };
  }

  async listMetrics(vertical: Vertical): Promise<MetricDef[]> {
    const res = await this.callTool("list_metrics", { namespace_id: this.namespace(vertical) });
    const metrics = res.metrics ?? [];
    return metrics.map((m: Record<string, unknown>) => ({
      name: String(m.name),
      description: String(m.description ?? ""),
      unit: m.return_type ? String(m.return_type) : undefined,
      args: Array.isArray(m.dimensions) ? (m.dimensions as string[]) : undefined,
    }));
  }

  async computeMetric(vertical: Vertical, name: string, args: Record<string, unknown>): Promise<MetricResult> {
    const start = Date.now();
    // Governed metrics resolve through COA's `query` Tier-1 path (no LLM). We ask
    // by metric name + args; COA returns the deterministic value.
    const argStr = Object.entries(args)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(", ");
    const raw = await this.callTool("query", {
      namespace_id: this.namespace(vertical),
      query: argStr ? `${name}(${argStr})` : name,
      execute: true,
      tierOverride: 1, // pin to the deterministic governed-metric tier
    });
    const res = raw.result ?? raw;
    const value = Number(res.value ?? res.metricValue ?? res.result ?? NaN);
    const confidence = res.confidence?.score ?? res.confidence ?? "1.0";
    return {
      name,
      value,
      method: `COA governed metric (Tier-1, confidence ${confidence})`,
      args,
      latency: Date.now() - start,
    };
  }

  async describeSchema(vertical: Vertical): Promise<OntologySchema> {
    // Serve DescribeSchema: { classes: [{uri, label, description, parentClass,
    // properties: [{uri, label, range, ...}]}], ontologyVersion }. Object
    // properties are nested per class, so we flatten + de-dupe them.
    const res = await this.callTool("describe_schema", { namespace_id: this.namespace(vertical) });
    const rawClasses = (res.classes ?? []) as Array<Record<string, unknown>>;

    const classes = rawClasses.map((c) => ({
      id: localName(String(c.uri ?? c.id ?? c.name)),
      label: String(c.label ?? c.name ?? c.uri),
      comment: c.description ?? c.comment ? String(c.description ?? c.comment) : undefined,
      subClassOf: c.parentClass ? localName(String(c.parentClass)) : undefined,
    }));

    const propMap = new Map<string, OntologySchema["properties"][number]>();
    for (const c of rawClasses) {
      const domainId = localName(String(c.uri ?? c.id ?? ""));
      for (const p of ((c.properties as Array<Record<string, unknown>>) ?? [])) {
        // Only object properties (those with a class range) go in the schema's
        // property list; datatype properties are attributes, not edges.
        const id = localName(String(p.uri ?? p.id ?? p.name));
        if (!id || propMap.has(id)) continue;
        propMap.set(id, {
          id,
          label: String(p.label ?? p.name ?? p.uri),
          domain: domainId || undefined,
          range: p.range ? localName(String(p.range)) : undefined,
          transitive: Boolean(p.transitive),
          comment: p.description ? String(p.description) : undefined,
        });
      }
    }

    // COA may also return a top-level object-properties list on some versions.
    for (const p of (res.properties ?? res.objectProperties ?? []) as Array<Record<string, unknown>>) {
      const id = localName(String(p.uri ?? p.id ?? p.name));
      if (!id || propMap.has(id)) continue;
      propMap.set(id, {
        id,
        label: String(p.label ?? p.name ?? p.uri),
        domain: p.domain ? localName(String(p.domain)) : undefined,
        range: p.range ? localName(String(p.range)) : undefined,
        transitive: Boolean(p.transitive),
      });
    }

    return {
      vertical,
      source: "COA describe_schema (Serve /schema)",
      classes,
      properties: Array.from(propMap.values()),
    };
  }

  async listDocuments(vertical: Vertical): Promise<Document[]> {
    // Documents live behind COA's Serve/Data Layer, not the six MCP tools. If a
    // deployment exposes a documents endpoint, wire it here; otherwise return [].
    void vertical;
    return [];
  }

  /**
   * The single wire seam. COA's six query "tools" are also REST operations on
   * the Serve / Data Layer surface (Smithy `DataLayerService`), so a plain-HTTP
   * caller with a user OIDC token can invoke them directly — no MCP/AgentCore
   * client needed. Each tool maps one-for-one to a Serve operation:
   *
   *   query           POST /namespaces/{ns}/query
   *   translate_sparql POST /namespaces/{ns}/translate
   *   rag_retrieval   POST /namespaces/{ns}/kb/search
   *   graph_traversal POST /namespaces/{ns}/graph/traverse
   *   list_metrics    GET  /namespaces/{ns}/metrics
   *   describe_schema GET  /namespaces/{ns}/schema
   *
   * The namespace is a path label (`namespace_id` in args). Remaining args are
   * the request body, already keyed to the Serve input shape by each caller.
   * This is the one method to adapt if a deployment fronts Serve differently
   * (e.g. behind the AgentCore MCP gateway instead of the REST surface).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- parsed COA JSON; shape varies per tool and is narrowed at each call site.
  private async callTool(tool: string, args: Record<string, unknown>): Promise<any> {
    const { namespace_id, ...body } = args as { namespace_id?: string } & Record<string, unknown>;
    const ns = encodeURIComponent(String(namespace_id ?? ""));

    // AgentCore SSE transport — only for the slow `query` synthesis, and only
    // when explicitly enabled with a runtime ARN. This is the one call that
    // exceeds API Gateway's 29s cap; the fast tools (metrics/schema/traverse/
    // kb-search) stay on REST. Any misconfiguration or per-request failure falls
    // through to the REST path below so behaviour degrades rather than breaks.
    if (this.transport === "agentcore" && tool === "query") {
      const region = process.env.AWS_REGION || "us-west-2";
      const endpoint = buildAgentCoreEndpoint(region, this.serveRuntimeArn);
      const token = await this.resolveToken();
      if (endpoint && token) {
        try {
          const { query, ...rest } = body as { query?: string } & Record<string, unknown>;
          // Serve resolves execute/tier/etc. from the request options; forward
          // the same knobs the REST body carried (minus the query string).
          return await agentCoreQuery({
            endpoint,
            token,
            sub: readSub(token),
            namespace: String(namespace_id ?? ""),
            query: String(query ?? ""),
            options: rest,
          });
        } catch (err) {
          // Log and fall back to REST — a transient AgentCore failure should not
          // be worse than the REST path we already tolerate.
          console.warn(
            `CoaProvider: AgentCore query failed, falling back to REST — ${(err as Error).message}`
          );
        }
      }
    }

    const routes: Record<string, { method: "GET" | "POST"; path: string }> = {
      query: { method: "POST", path: `/namespaces/${ns}/query` },
      translate_sparql: { method: "POST", path: `/namespaces/${ns}/translate` },
      rag_retrieval: { method: "POST", path: `/namespaces/${ns}/kb/search` },
      graph_traversal: { method: "POST", path: `/namespaces/${ns}/graph/traverse` },
      list_metrics: { method: "GET", path: `/namespaces/${ns}/metrics` },
      describe_schema: { method: "GET", path: `/namespaces/${ns}/schema` },
    };
    const route = routes[tool];
    if (!route) throw new Error(`CoaProvider: unknown tool '${tool}'`);

    const headers: Record<string, string> = { "content-type": "application/json" };
    const token = await this.resolveToken();
    if (token) headers["authorization"] = `Bearer ${token}`;

    const init: RequestInit = { method: route.method, headers };
    if (route.method === "POST") init.body = JSON.stringify(body);

    const resp = await fetch(`${this.baseUrl}${route.path}`, init);
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      // A 403 explicit-deny here almost always means an expired/absent COA_TOKEN.
      const hint = resp.status === 403 ? " (COA_TOKEN may be expired — refresh it; Cognito id tokens last ~1h)" : "";
      throw new Error(`COA ${tool} failed: ${resp.status} ${resp.statusText} ${text}${hint}`.trim());
    }
    return resp.json();
  }
}

/**
 * Race a promise against a time budget. Resolves to the promise's value if it
 * settles first, or `null` if the budget elapses (the underlying work is left
 * to finish/fail in the background — callers use this only for best-effort
 * enrichment that must never block the response).
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      }
    );
  });
}

/** Local name of an IRI — the part after the last '#' or '/'. */
function localName(iri: string): string {
  const hash = iri.lastIndexOf("#");
  const slash = iri.lastIndexOf("/");
  const cut = Math.max(hash, slash);
  return cut >= 0 ? iri.slice(cut + 1) : iri;
}

/**
 * Normalize a COA GraphTraverse payload into our Node/Edge shape.
 *
 * The Serve `GraphTraverse` op returns `entities` + `relationships` (with IRI
 * `uri`/`sourceUri`/`targetUri` fields). We also accept the older `nodes`/`edges`
 * shape so a deployment that fronts traversal differently still normalizes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- parsed COA GraphTraverse JSON.
function normalizeSubgraph(res: any, vertical: string): { nodes: Node[]; edges: Edge[] } {
  const rawNodes = res.entities ?? res.nodes ?? [];
  const rawEdges = res.relationships ?? res.edges ?? [];

  const nodes: Node[] = rawNodes.map((n: Record<string, unknown>) => ({
    id: String(n.uri ?? n.id),
    vertical,
    label: String(n.label ?? n.uri ?? n.id),
    type: String(n.type ?? n.class ?? n.classUri ?? "Entity"),
    properties: (n.properties as Record<string, unknown>) ?? {},
  }));
  const edges: Edge[] = rawEdges.map((e: Record<string, unknown>, i: number) => ({
    id: (e.id as string | number) ?? i,
    vertical,
    source_id: String(e.sourceUri ?? e.source ?? e.source_id ?? e.from),
    target_id: String(e.targetUri ?? e.target ?? e.target_id ?? e.to),
    relation: String(e.predicate ?? e.relation ?? e.type ?? "related"),
    properties: (e.properties as Record<string, unknown>) ?? {},
  }));
  return { nodes, edges };
}
