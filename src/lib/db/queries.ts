import { getDb } from "./index";
import { cosineSimilarity } from "@/lib/embeddings";

export interface DbNode {
  id: string;
  vertical: string;
  label: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface DbEdge {
  id: number;
  vertical: string;
  source_id: string;
  target_id: string;
  relation: string;
  properties: Record<string, unknown>;
}

export interface DbDocument {
  id: string;
  vertical: string;
  source: string;
  title: string;
  doc_type: string;
  ingested_at: string;
  chunks_count: number;
  entities_extracted: string[];
  content: string | null;
  metadata: Record<string, unknown>;
}

// Raw SQLite rows: JSON columns come back as strings.
type NodeRow = Omit<DbNode, "properties"> & { properties: string };
type EdgeRow = Omit<DbEdge, "properties"> & { properties: string };
type DocumentRow = Omit<DbDocument, "entities_extracted" | "metadata"> & { entities_extracted: string; metadata: string };
type CountRow = { cnt: number };

// --- Nodes ---

export function getAllNodes(vertical: string): DbNode[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM nodes WHERE vertical = ?").all(vertical) as NodeRow[];
  return rows.map((r) => ({ ...r, properties: JSON.parse(r.properties) }));
}

export function getNodeById(vertical: string, id: string): DbNode | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM nodes WHERE vertical = ? AND id = ?").get(vertical, id) as NodeRow | undefined;
  if (!row) return undefined;
  return { ...row, properties: JSON.parse(row.properties) };
}

export function upsertNode(vertical: string, id: string, label: string, type: string, properties: Record<string, unknown> = {}) {
  const db = getDb();
  db.prepare(`
    INSERT INTO nodes (id, vertical, label, type, properties)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id, vertical) DO UPDATE SET label=excluded.label, type=excluded.type, properties=excluded.properties
  `).run(id, vertical, label, type, JSON.stringify(properties));
}

// --- Edges ---

export function getAllEdges(vertical: string): DbEdge[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM edges WHERE vertical = ?").all(vertical) as EdgeRow[];
  return rows.map((r) => ({ ...r, properties: JSON.parse(r.properties) }));
}

export function insertEdge(vertical: string, sourceId: string, targetId: string, relation: string, properties: Record<string, unknown> = {}) {
  const db = getDb();
  db.prepare(`
    INSERT INTO edges (vertical, source_id, target_id, relation, properties)
    VALUES (?, ?, ?, ?, ?)
  `).run(vertical, sourceId, targetId, relation, JSON.stringify(properties));
}

// --- Graph Traversal (BFS) ---

export function traverseGraph(vertical: string, startNodeId: string, maxHops: number = 3): { nodes: DbNode[]; edges: DbEdge[] } {
  const db = getDb();
  const visitedIds = new Set<string>([startNodeId]);
  const resultEdges: DbEdge[] = [];
  let frontier = [startNodeId];

  for (let hop = 0; hop < maxHops; hop++) {
    if (frontier.length === 0) break;
    const placeholders = frontier.map(() => "?").join(",");
    const edgeRows = db.prepare(`
      SELECT * FROM edges WHERE vertical = ? AND (source_id IN (${placeholders}) OR target_id IN (${placeholders}))
    `).all(vertical, ...frontier, ...frontier) as EdgeRow[];

    const nextFrontier: string[] = [];
    for (const row of edgeRows) {
      const edge: DbEdge = { ...row, properties: JSON.parse(row.properties) };
      resultEdges.push(edge);
      const neighbor = edge.source_id === frontier.find((f) => f === edge.source_id) ? edge.target_id : edge.source_id;
      if (!visitedIds.has(neighbor)) {
        visitedIds.add(neighbor);
        nextFrontier.push(neighbor);
      }
    }
    frontier = nextFrontier;
  }

  // Fetch all visited nodes
  const idList = Array.from(visitedIds);
  const nodePlaceholders = idList.map(() => "?").join(",");
  const nodeRows = db.prepare(`SELECT * FROM nodes WHERE vertical = ? AND id IN (${nodePlaceholders})`).all(vertical, ...idList) as NodeRow[];
  const nodes: DbNode[] = nodeRows.map((r) => ({ ...r, properties: JSON.parse(r.properties) }));

  return { nodes, edges: resultEdges };
}

// --- Documents ---

export function getAllDocuments(vertical: string): DbDocument[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM documents WHERE vertical = ? ORDER BY ingested_at DESC").all(vertical) as DocumentRow[];
  return rows.map((r) => ({ ...r, entities_extracted: JSON.parse(r.entities_extracted), metadata: JSON.parse(r.metadata) }));
}

export function insertDocument(vertical: string, id: string, source: string, title: string, docType: string, chunksCount: number = 0, entitiesExtracted: string[] = []) {
  const db = getDb();
  db.prepare(`
    INSERT INTO documents (id, vertical, source, title, doc_type, chunks_count, entities_extracted)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id, vertical) DO UPDATE SET source=excluded.source, title=excluded.title, chunks_count=excluded.chunks_count, entities_extracted=excluded.entities_extracted
  `).run(id, vertical, source, title, docType, chunksCount, JSON.stringify(entitiesExtracted));
}

// --- Chunks + vector retrieval (Gap 2) ---

export interface DbChunk {
  id: string;
  vertical: string;
  document_id: string;
  ordinal: number;
  text: string;
  embedding: number[] | null;
  embedding_backend: string | null;
  metadata: Record<string, unknown>;
}

type ChunkRow = Omit<DbChunk, "embedding" | "metadata"> & { embedding: string; metadata: string };

export function insertChunk(
  vertical: string,
  id: string,
  documentId: string,
  ordinal: number,
  text: string,
  embedding: number[] | null,
  embeddingBackend: string | null,
  metadata: Record<string, unknown> = {}
) {
  const db = getDb();
  db.prepare(`
    INSERT INTO chunks (id, vertical, document_id, ordinal, text, embedding, embedding_backend, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET text=excluded.text, embedding=excluded.embedding, embedding_backend=excluded.embedding_backend, metadata=excluded.metadata
  `).run(
    id,
    vertical,
    documentId,
    ordinal,
    text,
    embedding ? JSON.stringify(embedding) : null,
    embeddingBackend,
    JSON.stringify(metadata)
  );
}

export function getChunkCount(vertical: string): number {
  const db = getDb();
  return (db.prepare("SELECT COUNT(*) as cnt FROM chunks WHERE vertical = ?").get(vertical) as CountRow).cnt;
}

/**
 * Cosine kNN over stored chunk vectors. This is the real vector-retrieval path:
 * it returns the top-k *most similar* chunks — shallow, single-source, sometimes
 * off-topic — which is exactly the honest contrast to graph traversal.
 */
export function searchChunksByVector(
  vertical: string,
  queryVector: number[],
  k: number = 4
): Array<{ chunk: DbChunk; score: number }> {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM chunks WHERE vertical = ? AND embedding IS NOT NULL").all(vertical) as ChunkRow[];
  const scored = rows.map((r) => {
    const embedding: number[] = JSON.parse(r.embedding);
    const chunk: DbChunk = {
      ...r,
      embedding,
      metadata: JSON.parse(r.metadata),
    };
    return { chunk, score: cosineSimilarity(queryVector, embedding) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

// --- Stats ---

export function getGraphStats(vertical: string) {
  const db = getDb();
  const nodeCount = (db.prepare("SELECT COUNT(*) as cnt FROM nodes WHERE vertical = ?").get(vertical) as CountRow).cnt;
  const edgeCount = (db.prepare("SELECT COUNT(*) as cnt FROM edges WHERE vertical = ?").get(vertical) as CountRow).cnt;
  const docCount = (db.prepare("SELECT COUNT(*) as cnt FROM documents WHERE vertical = ?").get(vertical) as CountRow).cnt;

  const typeRows = db.prepare("SELECT type, COUNT(*) as cnt FROM nodes WHERE vertical = ? GROUP BY type").all(vertical) as Array<{ type: string; cnt: number }>;
  const nodesByType: Record<string, number> = {};
  typeRows.forEach((r) => { nodesByType[r.type] = r.cnt; });

  const relRows = db.prepare("SELECT relation, COUNT(*) as cnt FROM edges WHERE vertical = ? GROUP BY relation").all(vertical) as Array<{ relation: string; cnt: number }>;
  const edgesByRelation: Record<string, number> = {};
  relRows.forEach((r) => { edgesByRelation[r.relation] = r.cnt; });

  const totalChunks = (db.prepare("SELECT COALESCE(SUM(chunks_count), 0) as cnt FROM documents WHERE vertical = ?").get(vertical) as CountRow).cnt;

  return { totalNodes: nodeCount, totalEdges: edgeCount, totalDocuments: docCount, nodesByType, edgesByRelation, totalChunks };
}
