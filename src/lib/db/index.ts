import Database from "better-sqlite3";
import path from "path";

/**
 * DB location. Defaults to <cwd>/groundwork.db for local dev. In a container
 * the app dir is read-only (and WAL needs to write sidecar files), so set
 * DB_PATH to a writable path like /tmp/groundwork.db — the entrypoint seeds a
 * copy there. See Dockerfile.
 */
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "groundwork.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
    initSchema(_db);
  }
  return _db;
}

function initSchema(db: Database.Database) {
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

    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      vertical TEXT NOT NULL,
      document_id TEXT NOT NULL,
      ordinal INTEGER DEFAULT 0,
      text TEXT NOT NULL,
      embedding TEXT,
      embedding_backend TEXT,
      metadata TEXT DEFAULT '{}'
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
    CREATE INDEX IF NOT EXISTS idx_chunks_vertical ON chunks(vertical);
    CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
  `);
}
