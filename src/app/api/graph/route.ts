import { NextRequest, NextResponse } from "next/server";
import { getProvider, getSeedProvider, type Vertical } from "@/lib/context";
import { verticals } from "@/data/verticals";

const ALLOWED = Object.keys(verticals);

/**
 * GET /api/graph?vertical=<id>&action=full|stats|nodes|node|traverse[&source=seed]
 * Read-only. `source=seed` always reads the local demo seed (SQLite), whatever
 * the active mode; without it the active provider answers.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const vertical = (searchParams.get("vertical") || "otsec") as Vertical;
  if (!ALLOWED.includes(vertical)) {
    return NextResponse.json({ error: `Unsupported vertical. Allowed: ${ALLOWED.join(", ")}.` }, { status: 400 });
  }
  const action = searchParams.get("action") || "full";
  const nodeType = searchParams.get("type") || undefined;
  const nodeId = searchParams.get("nodeId") || undefined;
  const hops = parseInt(searchParams.get("hops") || "3");

  const provider = searchParams.get("source") === "seed" ? getSeedProvider() : getProvider();

  try {
    switch (action) {
      case "full": {
        const { nodes, edges, stats } = await provider.getGraph(vertical);
        return NextResponse.json({ nodes, edges, stats });
      }
      case "stats": {
        const stats = await provider.getStats(vertical);
        return NextResponse.json(stats);
      }
      case "nodes": {
        const { nodes } = await provider.getGraph(vertical);
        const filtered = nodeType ? nodes.filter((n) => n.type === nodeType) : nodes;
        return NextResponse.json({ nodes: filtered });
      }
      case "node": {
        if (!nodeId) return NextResponse.json({ error: "nodeId required" }, { status: 400 });
        const { nodes } = await provider.getGraph(vertical);
        const node = nodes.find((n) => n.id === nodeId);
        if (!node) return NextResponse.json({ error: "Node not found" }, { status: 404 });
        return NextResponse.json(node);
      }
      case "traverse": {
        if (!nodeId) return NextResponse.json({ error: "nodeId required for traverse" }, { status: 400 });
        const result = await provider.traverse(vertical, nodeId, hops);
        return NextResponse.json({ ...result, hops, startNode: nodeId });
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    // Upstream (COA) errors can carry response bodies; keep them in the server log only.
    console.error("GET /api/graph failed:", (error as Error).message);
    return NextResponse.json({ error: "Could not load the graph for this vertical." }, { status: 500 });
  }
}
