/**
 * COA source sanitizer tests. Fixture values are placeholders only.
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeSource, toIso, maskNamespacePath, liveSourceEvents } from "./coa-source-shape";

const HOST = "example-db.abc123.us-east-1.rds.example";
const SECRET = "secret-placeholder";
const PREFIX = "bucket-placeholder/raw/";

const jdbcItem = { sourceId: "src-placeholder-1", name: "Plant DB", sourceType: "JDBC_DATABASE", status: "ACTIVE" };
const jdbcDetail = {
  name: "Plant DB",
  sourceType: "JDBC_DATABASE",
  sourceSubType: "POSTGRESQL",
  status: "ACTIVE",
  credentialSecretArn: SECRET,
  createdAt: 1_700_000_000,
  updatedAt: 1_700_000_600,
  databaseDetails: {
    queryEngine: "ATHENA",
    athenaDataCatalogName: "catalog-placeholder",
    tablesDiscovered: 3,
    tablesApproved: 2,
    lastScanAt: 1_700_000_300,
    credentialSecretArn: SECRET,
    jdbcConfiguration: { engine: "postgres", host: HOST, port: 5432, databaseName: "plant", credentialSecretArn: SECRET },
  },
};
const jdbcTables = {
  items: [
    { name: "work_orders", columnCount: 9, columnsApproved: 9, reviewStatus: "APPROVED" },
    { name: "assets", columnCount: 12, columnsApproved: 10, reviewStatus: "IN_REVIEW" },
  ],
};

test("sanitizeSource never copies the secret, full host or s3 prefixes", () => {
  const s = sanitizeSource(jdbcItem, jdbcDetail, jdbcTables);
  const json = JSON.stringify(s);
  assert.ok(!json.includes(SECRET));
  assert.ok(!json.includes(HOST));
  assert.ok(!json.includes("abc123"));
  assert.ok(!json.includes("credentialSecretArn"));
  assert.equal(s.rdsInstance, "example-db");
  assert.equal(s.engine, "postgres");
  assert.equal(s.port, 5432);
  assert.equal(s.databaseName, "plant");
  assert.equal(s.glueCatalog, "catalog-placeholder");
  assert.equal(s.tablesDiscovered, 3);
  assert.equal(s.tablesApproved, 2);
  assert.deepEqual(s.tables.map((t) => t.name), ["assets", "work_orders"]);
  assert.equal(s.tables[0].columns, 12);
  assert.equal(s.tables[0].reviewStatus, "IN_REVIEW");
});

test("epoch seconds become ISO strings", () => {
  const s = sanitizeSource(jdbcItem, jdbcDetail, jdbcTables);
  assert.equal(s.createdAt, new Date(1_700_000_000 * 1000).toISOString());
  assert.equal(s.updatedAt, new Date(1_700_000_600 * 1000).toISOString());
  assert.equal(s.lastScanAt, new Date(1_700_000_300 * 1000).toISOString());
  assert.equal(toIso(0), undefined);
  assert.equal(toIso("1700000000"), undefined);
});

test("DOCUMENTS counters map and s3Prefixes are dropped", () => {
  const item = { sourceId: "src-placeholder-2", name: "Runbooks", sourceType: "DOCUMENTS", status: "ACTIVE" };
  const detail = {
    name: "Runbooks",
    sourceType: "DOCUMENTS",
    status: "ACTIVE",
    documentDetails: { s3Prefixes: [PREFIX], filesTotal: 40, documentsProcessed: 38, filesErrored: 2, chunksEmbed: 512, chunksGraph: 300 },
  };
  const s = sanitizeSource(item, detail, {});
  const json = JSON.stringify(s);
  assert.ok(!json.includes(PREFIX));
  assert.ok(!json.includes("s3Prefixes"));
  assert.equal(s.filesTotal, 40);
  assert.equal(s.documentsProcessed, 38);
  assert.equal(s.filesErrored, 2);
  assert.equal(s.chunksEmbedded, 512);
  assert.equal(s.chunksGraph, 300);
  assert.deepEqual(s.tables, []);
});

test("maskNamespacePath hides the namespace id", () => {
  const p = maskNamespacePath("/namespaces/ns-placeholder/sources/src-placeholder-1/tables");
  assert.equal(p, "/namespaces/{ns}/sources/src-placeholder-1/tables");
  assert.ok(!p.includes("ns-placeholder"));
});

test("liveSourceEvents are newest first with absolute timestamps", () => {
  const s = sanitizeSource(jdbcItem, jdbcDetail, jdbcTables);
  const ev = liveSourceEvents([s]);
  assert.deepEqual(ev.map((e) => e.kind), ["source-updated", "source-scanned", "source-registered"]);
  assert.ok(ev.every((e) => /^\d{4}-\d{2}-\d{2}T/.test(e.at)));
});
