import {
  getAllNodes,
  getAllEdges,
  getGraphStats,
  getAllDocuments,
  traverseGraph,
  type DbNode,
  type DbEdge,
} from "@/lib/db/queries";
import type { ContextProvider } from "./provider";
import { rootCauseChain } from "./root-cause";
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
 * Mode 1 — the demo. Wraps the existing SQLite-backed db/queries.ts.
 *
 * Behavior is identical to the pre-refactor app: same BFS traversal, same
 * subgraph query, same stats. Governed metrics are approximated (blast radius =
 * reachable-node count via BFS). This is what boots in seconds with no AWS.
 */
export class LocalMockProvider implements ContextProvider {
  readonly fidelity: Fidelity = "mock";

  async getGraph(vertical: Vertical) {
    return {
      nodes: getAllNodes(vertical) as Node[],
      edges: getAllEdges(vertical) as Edge[],
      stats: getGraphStats(vertical) as GraphStats,
    };
  }

  async getStats(vertical: Vertical): Promise<GraphStats> {
    return getGraphStats(vertical) as GraphStats;
  }

  async traverse(vertical: Vertical, nodeId: string, hops: number) {
    const { nodes, edges } = traverseGraph(vertical, nodeId, hops);
    return { nodes: nodes as Node[], edges: edges as Edge[] };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async query(vertical: Vertical, question: string, mode: QueryMode, startNodes: string[] = [], model?: string): Promise<QueryResult> {
    if (mode === "vector") {
      // Simulated vector search (Mode 1). Real semantic retrieval arrives in Mode 3.
      await new Promise((r) => setTimeout(r, 200));
      const stats = getGraphStats(vertical);
      const sources = Math.min(3, stats.totalDocuments);
      return {
        mode: "vector",
        query: question,
        answer: `Based on ${sources} retrieved document chunks, here is relevant information about your query. [Simulated vector response — real semantic retrieval runs in Live COA mode via rag_retrieval.]`,
        sources,
        latency: 250 + Math.floor(Math.random() * 100),
        model: "Simulated vector retrieval",
        backend: "OpenSearch Serverless (simulated)",
      };
    }

    // GraphRAG mode — BFS from inferred entry nodes.
    const entryNodeIds = startNodes.length > 0 ? startNodes : inferEntryNodes(vertical, question);

    const allNodes: DbNode[] = [];
    const allEdges: DbEdge[] = [];
    for (const nodeId of entryNodeIds) {
      const result = traverseGraph(vertical, nodeId, 4);
      allNodes.push(...result.nodes);
      allEdges.push(...result.edges);
    }

    const nodeMap = new Map(allNodes.map((n) => [n.id, n]));
    const uniqueNodes = Array.from(nodeMap.values());
    const edgeSet = new Set(allEdges.map((e) => `${e.source_id}-${e.relation}-${e.target_id}`));
    const uniqueEdges = allEdges.filter((e) => {
      const key = `${e.source_id}-${e.relation}-${e.target_id}`;
      if (edgeSet.has(key)) {
        edgeSet.delete(key);
        return true;
      }
      return false;
    });

    const answer = summarizeSubgraph(uniqueNodes, uniqueEdges, entryNodeIds, question);

    return {
      mode: "graph",
      query: question,
      answer,
      entryNodes: entryNodeIds,
      subgraph: {
        nodes: uniqueNodes as Node[],
        edges: uniqueEdges as Edge[],
        nodeCount: uniqueNodes.length,
        edgeCount: uniqueEdges.length,
      },
      hops: 4,
      latency: 700 + Math.floor(Math.random() * 400),
      model: "Deterministic summary (simulated, no LLM)",
      backend: "SQLite (dev)",
      note: "Mode 1 answer is a deterministic summary of the real graph traversal (no LLM). Mode 3 has COA's LLM synthesize the same subgraph into prose.",
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async listMetrics(vertical: Vertical): Promise<MetricDef[]> {
    // Mode 1 exposes a single approximated headline metric. The full governed
    // metric set (from metrics.osi.yaml) arrives in Mode 2 / Mode 3.
    return [
      {
        name: "blast_radius_score",
        description: "Approximate count of reachable nodes from an entry node (BFS). Governed definition arrives in ontology/COA modes.",
        args: ["nodeId", "maxHops"],
        unit: "nodes",
      },
    ];
  }

  async computeMetric(vertical: Vertical, name: string, args: Record<string, unknown>): Promise<MetricResult> {
    const start = Date.now();
    if (name !== "blast_radius_score") {
      throw new Error(`Metric '${name}' is not available in mock mode. Switch to CONTEXT_MODE=ontology or coa.`);
    }
    const nodeId = String(args.nodeId ?? "");
    const maxHops = Number(args.maxHops ?? 4);
    if (!nodeId) throw new Error("blast_radius_score requires a nodeId argument");
    const { nodes } = traverseGraph(vertical, nodeId, maxHops);
    // Reachable nodes excluding the entry node itself.
    const value = Math.max(0, nodes.length - 1);
    return {
      name,
      value,
      method: `BFS reachable-node count to ${maxHops} hops (mock approximation)`,
      args,
      latency: Date.now() - start,
    };
  }

  async describeSchema(vertical: Vertical): Promise<OntologySchema> {
    // Mode 1 derives a minimal schema from whatever types/relations exist in the
    // seed data. Mode 2 replaces this with the real OWL ontology from the pack.
    const stats = getGraphStats(vertical);
    return {
      vertical,
      source: "hardcoded (derived from seed data)",
      classes: Object.keys(stats.nodesByType).map((t) => ({ id: t, label: t })),
      properties: Object.keys(stats.edgesByRelation).map((r) => ({ id: r, label: r })),
    };
  }

  async listDocuments(vertical: Vertical): Promise<Document[]> {
    return getAllDocuments(vertical) as Document[];
  }
}

/**
 * Build a readable natural-language answer from the real BFS subgraph.
 *
 * This is deterministic (no LLM) — it summarizes what the graph traversal
 * actually found: the entry point, how many entities were reached, the breakdown
 * by type, and the notable reachable assets. In Mode 3, COA's LLM synthesizes the
 * same subgraph into richer prose; here we prove the *graph* found connected
 * facts a vector search never would. Honest, and enough to carry the demo.
 */
function summarizeSubgraph(
  nodes: DbNode[],
  edges: DbEdge[],
  entryNodeIds: string[],
  question: string
): string {
  if (nodes.length === 0) {
    return `No connected entities were found for "${question}". Try an entry point that exists in this vertical's graph (see the Graph page), or switch verticals (top-right).`;
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const entry = entryNodeIds.map((id) => byId.get(id)).find(Boolean) as DbNode | undefined;
  const entryLabel = entry?.label ?? entryNodeIds[0] ?? "the entry point";

  // Count reachable nodes by type (excluding the entry node itself).
  const byType = new Map<string, string[]>();
  for (const n of nodes) {
    if (entry && n.id === entry.id) continue;
    const arr = byType.get(n.type) ?? [];
    arr.push(n.label);
    byType.set(n.type, arr);
  }

  const reachable = nodes.length - (entry ? 1 : 0);
  const typeBreakdown = Array.from(byType.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .map(([type, labels]) => `${labels.length} ${type}${labels.length > 1 ? "s" : ""}`)
    .join(", ");

  const lines: string[] = [];
  lines.push(
    `Starting from ${entryLabel}, the graph reaches ${reachable} connected ${reachable === 1 ? "entity" : "entities"} within 4 hops` +
      (typeBreakdown ? ` — ${typeBreakdown}.` : ".")
  );

  // Highlight the assets on the path — the "blast radius" (security verticals).
  const assets = (byType.get("OTAsset") ?? byType.get("Asset") ?? []).slice(0, 8);
  if (assets.length) {
    lines.push("");
    lines.push(`Assets in the blast radius: ${assets.join(", ")}.`);
  }

  // Highlight the likely root cause. When the subgraph carries good-path decoys
  // (a prior good lot, a clean backup supplier), naming every Supplier/lot/PO
  // muddies the finding — so the shared rootCauseChain scores failure signals
  // and follows edges to name only the actual culprit. Shared with Mode 2.
  const chain = rootCauseChain(nodes, edges);
  if (chain.length) {
    lines.push("");
    lines.push(`Root cause traced to: ${chain.join(" — via ")}.`);
  }

  lines.push("");
  lines.push(
    `This is connected reasoning: ${edges.length} relationships stitch the entry point to downstream entities across the graph — the multi-hop path a vector search over similar text would miss.`
  );
  return lines.join("\n");
}

/**
 * Keyword-based entry-node inference. Ported verbatim from the original
 * api/query route so Mode 1 answers the canonical demo questions identically.
 * Mode 3 replaces this with COA's semantic resolution.
 */
function inferEntryNodes(vertical: string, query: string): string[] {
  const lower = query.toLowerCase();
  if (vertical === "otsec") {
    if (lower.includes("voltzite") || lower.includes("vpn") || lower.includes("blast radius")) return ["voltzite"];
    if (lower.includes("electrum") || lower.includes("industroyer")) return ["electrum"];
    if (lower.includes("chernovite") || lower.includes("pipedream")) return ["chernovite"];
    if (lower.includes("plc") || lower.includes("controller")) return ["plc-sub1"];
    if (lower.includes("compliance") || lower.includes("cip") || lower.includes("nerc")) return ["cip007"];
    return ["voltzite"];
  }
  if (vertical === "energy") {
    if (lower.includes("4471") || lower.includes("maple") || lower.includes("power out")) return ["outage-4471"];
    if (lower.includes("4472") || lower.includes("elm")) return ["outage-4472"];
    return ["outage-4471"];
  }
  if (vertical === "prodquality") {
    // Cross-product blast radius from the bad lot — start at the lot so BFS fans
    // out to both products through the shared battery pack.
    if (lower.includes("ns-2411") || lower.includes("other product") || lower.includes("affected") || lower.includes("blast radius") || lower.includes("cross-product"))
      return ["cell-lot-ns"];
    // Corrective-action / qualification questions start at the supplier so BFS
    // reaches the CAPA, the electrolyte change, and the prior good lot.
    if (lower.includes("corrective") || lower.includes("capa") || lower.includes("qualification") || lower.includes("qualify") || lower.includes("electrolyte"))
      return ["supplier-northstar"];
    if (lower.includes("supplier") || lower.includes("purchase order") || lower.includes("po ")) return ["supplier-northstar"];
    if (lower.includes("impact driver") || lower.includes("driver")) return ["driver-vc20i"];
    if (lower.includes("motor") || lower.includes("chuck") || lower.includes("charger")) return ["return-batch-winter"];
    if (lower.includes("battery")) return ["battery-pack"];
    // Root-cause questions ("bad reviews", "root cause") start from the product so
    // BFS walks reviews → region → stores → returns → battery → lot → supplier → PO.
    return ["drill-vc20"];
  }
  // cyber
  if (lower.includes("solarwinds") || lower.includes("apt29") || lower.includes("midnight")) return ["apt29"];
  if (lower.includes("log4") || lower.includes("44228")) return ["cve-2021-44228"];
  if (lower.includes("volt") || lower.includes("typhoon")) return ["vt"];
  return ["apt29"];
}
