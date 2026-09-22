/**
 * Seed script: loads JSON datasets into SQLite database
 * Run: npx tsx scripts/seed.ts
 */
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "groundwork.db");
const DATASETS_DIR = path.join(process.cwd(), "src/data/datasets");

// Shapes of the dataset JSON files under src/data/datasets/<vertical>/.
interface SeedNode { id: string; label: string; type: string; properties?: Record<string, unknown> }
interface SeedEdge { source: string; target: string; relation: string; properties?: Record<string, unknown> }
interface SeedDoc { id: string; source: string; title: string; type: string; chunks?: number; entities_extracted?: string[] }

// Initialize DB
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS nodes (
    id TEXT NOT NULL,
    vertical TEXT NOT NULL,
    label TEXT NOT NULL,
    type TEXT NOT NULL,
    properties TEXT DEFAULT '{}',
    PRIMARY KEY (id, vertical)
  );
  CREATE TABLE IF NOT EXISTS edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vertical TEXT NOT NULL,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    relation TEXT NOT NULL,
    properties TEXT DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT NOT NULL,
    vertical TEXT NOT NULL,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    doc_type TEXT NOT NULL,
    ingested_at TEXT DEFAULT (datetime('now')),
    chunks_count INTEGER DEFAULT 0,
    entities_extracted TEXT DEFAULT '[]',
    content TEXT,
    metadata TEXT DEFAULT '{}',
    PRIMARY KEY (id, vertical)
  );
  CREATE TABLE IF NOT EXISTS pipeline_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vertical TEXT NOT NULL,
    source_name TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    docs_processed INTEGER DEFAULT 0,
    entities_extracted INTEGER DEFAULT 0,
    started_at TEXT,
    completed_at TEXT,
    error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_nodes_vertical_type ON nodes(vertical, type);
  CREATE INDEX IF NOT EXISTS idx_edges_vertical ON edges(vertical);
  CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
  CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
  CREATE INDEX IF NOT EXISTS idx_documents_vertical ON documents(vertical);
`);

const verticals = ["cyber", "energy", "otsec", "prodquality"];

// Clear existing data
console.log("🗑️  Clearing existing data...");
db.exec("DELETE FROM edges");
db.exec("DELETE FROM nodes");
db.exec("DELETE FROM documents");
db.exec("DELETE FROM pipeline_jobs");

const insertNode = db.prepare("INSERT OR REPLACE INTO nodes (id, vertical, label, type, properties) VALUES (?, ?, ?, ?, ?)");
const insertEdge = db.prepare("INSERT INTO edges (vertical, source_id, target_id, relation, properties) VALUES (?, ?, ?, ?, ?)");
const insertDoc = db.prepare("INSERT OR REPLACE INTO documents (id, vertical, source, title, doc_type, chunks_count, entities_extracted) VALUES (?, ?, ?, ?, ?, ?, ?)");

for (const vertical of verticals) {
  const dir = path.join(DATASETS_DIR, vertical);
  if (!fs.existsSync(dir)) {
    console.log(`⏭️  Skipping ${vertical} (no dataset directory)`);
    continue;
  }

  console.log(`\n📦 Seeding ${vertical}...`);

  // Nodes
  const nodesFile = path.join(dir, "nodes.json");
  if (fs.existsSync(nodesFile)) {
    const nodes: SeedNode[] = JSON.parse(fs.readFileSync(nodesFile, "utf-8"));
    const insertMany = db.transaction((items: SeedNode[]) => {
      for (const node of items) {
        insertNode.run(node.id, vertical, node.label, node.type, JSON.stringify(node.properties || {}));
      }
    });
    insertMany(nodes);
    console.log(`  ✓ ${nodes.length} nodes`);
  }

  // Edges
  const edgesFile = path.join(dir, "edges.json");
  if (fs.existsSync(edgesFile)) {
    const edges: SeedEdge[] = JSON.parse(fs.readFileSync(edgesFile, "utf-8"));
    const insertMany = db.transaction((items: SeedEdge[]) => {
      for (const edge of items) {
        insertEdge.run(vertical, edge.source, edge.target, edge.relation, JSON.stringify(edge.properties || {}));
      }
    });
    insertMany(edges);
    console.log(`  ✓ ${edges.length} edges`);
  }

  // Documents
  const docsFile = path.join(dir, "documents.json");
  if (fs.existsSync(docsFile)) {
    const docs: SeedDoc[] = JSON.parse(fs.readFileSync(docsFile, "utf-8"));
    const insertMany = db.transaction((items: SeedDoc[]) => {
      for (const doc of items) {
        insertDoc.run(doc.id, vertical, doc.source, doc.title, doc.type, doc.chunks || 0, JSON.stringify(doc.entities_extracted || []));
      }
    });
    insertMany(docs);
    console.log(`  ✓ ${docs.length} documents`);
  }
}

// Summary
console.log("\n📊 Database summary:");
const countOf = (table: string) =>
  (db.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get() as { cnt: number }).cnt;
const nodeCount = countOf("nodes");
const edgeCount = countOf("edges");
const docCount = countOf("documents");
console.log(`  Nodes: ${nodeCount}`);
console.log(`  Edges: ${edgeCount}`);
console.log(`  Documents: ${docCount}`);
console.log(`\n✅ Seed complete. Database: ${DB_PATH}`);

db.close();
