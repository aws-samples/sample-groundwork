/**
 * COA row helper tests (Tier-1 metric rows, Tier-2 result tables). No network.
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterRows,
  formatResultRows,
  isTruncated,
  MAX_TABLE_ROWS,
  num,
  reduceMetricRows,
  tableCitations,
  tablesFromSql,
} from "./coa-rows";

const rows = [
  { asset_id: "7", zone_name: "north", value: "12.5" },
  { asset_id: "8", zone_name: "south", value: "3" },
  { asset_id: "9", zone_name: "north", value: "40" },
];

test("filterRows matches camelCase args against snake_case columns", () => {
  assert.deepEqual(filterRows(rows, { zoneName: "north" }).map((r) => r.asset_id), ["7", "9"]);
  assert.deepEqual(filterRows(rows, { asset_id: 8 }).map((r) => r.asset_id), ["8"]);
});

test("filterRows ignores args whose column is absent", () => {
  assert.equal(filterRows(rows, { since: "2024-01-01" }).length, 3);
  assert.equal(filterRows(rows, { since: "2024-01-01", assetId: "9" }).length, 1);
});

test("filterRows strips a <word>- prefix only for numeric columns", () => {
  assert.deepEqual(filterRows(rows, { assetId: "asset-7" }).map((r) => r.asset_id), ["7"]);
  // zone_name is not numeric, so the prefix is not stripped.
  assert.equal(filterRows(rows, { zoneName: "zone-north" }).length, 0);
});

test("num parses numeric strings and rejects the rest", () => {
  assert.equal(num("12.5"), 12.5);
  assert.ok(Number.isNaN(num("abc")));
  assert.ok(Number.isNaN(num(null)));
  assert.ok(Number.isNaN(num("")));
});

test("reduceMetricRows: 0 rows is NaN", () => {
  assert.ok(Number.isNaN(reduceMetricRows("m", [])));
});

test("reduceMetricRows: 1 row reads column 'value' first", () => {
  assert.equal(reduceMetricRows("m", [{ m: "5", value: "9" }]), 9);
});

test("reduceMetricRows: 1 row falls back to the column named like the metric", () => {
  assert.equal(reduceMetricRows("open_alerts", [{ zone_id: "3", open_alerts: "11" }]), 11);
});

test("reduceMetricRows: 1 row falls back to the single numeric column", () => {
  assert.equal(reduceMetricRows("m", [{ zone: "north", pct: "42.1" }]), 42.1);
  assert.ok(Number.isNaN(reduceMetricRows("m", [{ a: "1", b: "2" }])));
});

test("reduceMetricRows: more than 1 row is NaN", () => {
  assert.ok(Number.isNaN(reduceMetricRows("m", rows)));
});

test("formatResultRows renders header, rows and truncation note", () => {
  const md = formatResultRows([{ a: 1, b: "x|y" }, { a: 2, b: null }], false);
  const lines = md.split("\n");
  assert.equal(lines[0], "2 rows from the live source:");
  assert.equal(lines[2], "| a | b |");
  assert.equal(lines[3], "| --- | --- |");
  assert.equal(lines[4], "| 1 | x\\|y |");
  assert.equal(lines[5], "| 2 |  |");
  assert.match(formatResultRows([{ a: 1 }], true), /^1 row from the live source \(COA truncated/);
});

test("formatResultRows caps the table at MAX_TABLE_ROWS", () => {
  const many = Array.from({ length: MAX_TABLE_ROWS + 5 }, (_, i) => ({ i }));
  const md = formatResultRows(many, false);
  assert.match(md, new RegExp(`^${MAX_TABLE_ROWS + 5} rows .*showing the first ${MAX_TABLE_ROWS}`));
  assert.equal(md.split("\n").filter((l) => l.startsWith("| ")).length, MAX_TABLE_ROWS + 2);
});

test("isTruncated reads the t2.sql.execute trace step", () => {
  assert.equal(isTruncated([{ step: "t2.sql.execute", detail: { truncated: true } }]), true);
  assert.equal(isTruncated([{ step: "t2.sql.execute", detail: { truncated: false } }]), false);
  assert.equal(isTruncated(undefined), false);
});

test("tablesFromSql strips quotes and schema prefixes across JOINs", () => {
  const sql =
    'SELECT a.name, c.port FROM "public"."ot_assets" a JOIN asset_connectivity c ON a.id = c.asset_id JOIN "public".ot_assets b ON b.id = c.peer_id';
  assert.deepEqual(tablesFromSql(sql), ["ot_assets", "asset_connectivity"]);
});

test("tablesFromSql handles backticks and brackets", () => {
  assert.deepEqual(tablesFromSql("SELECT * FROM `plant`.`work_orders` w LEFT JOIN [dbo].[parts] p ON 1=1"), [
    "work_orders",
    "parts",
  ]);
});

test("tablesFromSql excludes CTE names and subqueries", () => {
  const sql =
    "WITH recent AS (SELECT * FROM inspections WHERE ts > now()), agg (k, n) AS (SELECT k, count(*) FROM recent GROUP BY k) " +
    "SELECT * FROM agg JOIN (SELECT id FROM suppliers) s ON s.id = agg.k";
  assert.deepEqual(tablesFromSql(sql), ["inspections", "suppliers"]);
});

test("tableCitations builds one citation per table", () => {
  assert.deepEqual(tableCitations(["t1"], 4), [
    { documentId: "coa-table:t1", title: "t1", system: "COA registered source", factCount: 4 },
  ]);
  assert.equal(tableCitations(["t1"], 1, "<system>")[0].system, "<system>");
});
