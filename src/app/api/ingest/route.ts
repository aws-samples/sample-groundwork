import { NextRequest, NextResponse } from "next/server";
import { upsertNode, insertEdge, insertDocument, getGraphStats } from "@/lib/db/queries";

/**
 * POST /api/ingest — Add nodes, edges, or documents to the graph
 * 
 * Body: {
 *   vertical: "otsec" | "cyber" | "energy",
 *   nodes?: Array<{ id, label, type, properties }>,
 *   edges?: Array<{ source, target, relation, properties }>,
 *   documents?: Array<{ id, source, title, type, chunks, entities_extracted }>
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { vertical, nodes = [], edges = [], documents = [] } = body;

    if (!vertical) {
      return NextResponse.json({ error: "vertical is required" }, { status: 400 });
    }

    let nodesInserted = 0;
    let edgesInserted = 0;
    let docsInserted = 0;

    // Insert nodes
    for (const node of nodes) {
      upsertNode(vertical, node.id, node.label, node.type, node.properties || {});
      nodesInserted++;
    }

    // Insert edges
    for (const edge of edges) {
      insertEdge(vertical, edge.source, edge.target, edge.relation, edge.properties || {});
      edgesInserted++;
    }

    // Insert documents
    for (const doc of documents) {
      insertDocument(vertical, doc.id, doc.source, doc.title, doc.type, doc.chunks || 0, doc.entities_extracted || []);
      docsInserted++;
    }

    const stats = getGraphStats(vertical);

    return NextResponse.json({
      success: true,
      inserted: { nodes: nodesInserted, edges: edgesInserted, documents: docsInserted },
      totals: stats,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
