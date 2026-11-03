/**
 * Pure shapes and sanitizers for GET /api/sources. No imports from the context
 * providers or the database, so node:test can load this module directly.
 *
 * sanitizeSource() is an explicit field allowlist over COA's source records:
 * the credential secret ARN, the full JDBC host and DOCUMENTS s3Prefixes are
 * never copied into the response (only the first host label, as rdsInstance).
 */

export type SourcesOrigin = "coa-live" | "coa-not-configured" | "demo-seed";

export interface SourceTable {
  name: string;
  columns?: number;
  columnsApproved?: number;
  reviewStatus?: string;
}

export interface SourceSummary {
  id: string;
  name: string;
  sourceType: string;
  sourceSubType?: string;
  status: string;
  engine?: string;
  port?: number;
  databaseName?: string;
  rdsInstance?: string;
  queryEngine?: string;
  glueCatalog?: string;
  tablesDiscovered?: number;
  tablesApproved?: number;
  createdAt?: string;
  updatedAt?: string;
  lastScanAt?: string;
  /** DOCUMENTS sources only (documentDetails counters; s3Prefixes are never returned). */
  filesTotal?: number;
  documentsProcessed?: number;
  filesErrored?: number;
  chunksEmbedded?: number;
  chunksGraph?: number;
  tables: SourceTable[];
}

/** One seed `source` group from src/data/datasets/<vertical>/documents.json. */
export interface SeedSourceGroup {
  source: string;
  docs: number;
  chunks: number;
  latestIngested?: string;
}

export interface SourceEvent {
  title: string;
  /** Absolute ISO-8601 UTC timestamp. */
  at: string;
  kind: "seed-ingested" | "source-registered" | "source-scanned" | "source-updated";
}

export interface SourcesResponse {
  vertical: string;
  mode: "mock" | "ontology" | "coa";
  origin: SourcesOrigin;
  fetchedAt: string;
  /** The pack name (never the COA namespace id). */
  namespace?: string;
  namespaceConfigured?: boolean;
  /** coa-not-configured only: the env var that would enable Live COA. */
  envVar?: string;
  sources: SourceSummary[];
  /** demo-seed only. */
  seed?: {
    datasetPath: string;
    groups: SeedSourceGroup[];
    documents: number;
    chunks: number;
    nodes: number;
    edges: number;
  };
  /** demo-seed only: how many sources packs/<pack>/sources.yaml declares. */
  packSourcesDeclared?: number;
  events: SourceEvent[];
  error?: string;
}

type Rec = Record<string, unknown>;

export function toIso(epochSeconds: unknown): string | undefined {
  return typeof epochSeconds === "number" && epochSeconds > 0 ? new Date(epochSeconds * 1000).toISOString() : undefined;
}

/** Replace /namespaces/<id> with /namespaces/{ns} so errors never leak the id. */
export function maskNamespacePath(p: string): string {
  return p.replace(/\/namespaces\/[^/?#]+/g, "/namespaces/{ns}");
}

const num = (v: unknown) => (typeof v === "number" ? v : undefined);
const str = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : String(v));

/** Allowlisted summary of one COA source (list item + detail + tables response). */
export function sanitizeSource(item: Rec, detail: Rec, tablesRes: Rec): SourceSummary {
  const db = (detail.databaseDetails ?? {}) as Rec;
  const docs = (detail.documentDetails ?? {}) as Rec;
  const jdbc = (db.jdbcConfiguration ?? {}) as Rec;
  const host = typeof jdbc.host === "string" ? jdbc.host : "";
  const tables = ((tablesRes.items ?? tablesRes.tables ?? []) as Rec[])
    .map((t) => ({
      name: String(t.name ?? ""),
      columns: num(t.columnCount),
      columnsApproved: num(t.columnsApproved),
      reviewStatus: str(t.reviewStatus),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    id: String(item.sourceId ?? item.id ?? detail.sourceId ?? ""),
    name: String(detail.name ?? item.name ?? ""),
    sourceType: String(detail.sourceType ?? item.sourceType ?? ""),
    sourceSubType: str(detail.sourceSubType ?? item.sourceSubType),
    status: String(detail.status ?? item.status ?? "UNKNOWN"),
    engine: str(jdbc.engine),
    port: num(jdbc.port),
    databaseName: str(jdbc.databaseName),
    rdsInstance: host ? host.split(".")[0] : undefined,
    queryEngine: str(db.queryEngine),
    glueCatalog: str(db.athenaDataCatalogName) ?? str(db.glueConnectionName),
    tablesDiscovered: num(db.tablesDiscovered) ?? num(item.tablesDiscovered),
    tablesApproved: num(db.tablesApproved),
    createdAt: toIso(detail.createdAt ?? item.createdAt),
    updatedAt: toIso(detail.updatedAt ?? item.updatedAt),
    lastScanAt: toIso(db.lastScanAt),
    filesTotal: num(docs.filesTotal),
    documentsProcessed: num(docs.documentsProcessed),
    filesErrored: num(docs.filesErrored),
    chunksEmbedded: num(docs.chunksEmbed) ?? num(docs.chunksEmbedded),
    chunksGraph: num(docs.chunksGraph),
    tables,
  };
}

/** Source lifecycle events from live timestamps, newest first. */
export function liveSourceEvents(sources: SourceSummary[], limit = 10): SourceEvent[] {
  const events: SourceEvent[] = [];
  for (const s of sources) {
    const name = s.name || s.sourceType || "Source";
    if (s.createdAt) events.push({ title: `${name} registered`, at: s.createdAt, kind: "source-registered" });
    if (s.lastScanAt) events.push({ title: `${name} scanned`, at: s.lastScanAt, kind: "source-scanned" });
    if (s.updatedAt && s.updatedAt !== s.createdAt) events.push({ title: `${name} updated`, at: s.updatedAt, kind: "source-updated" });
  }
  return events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
