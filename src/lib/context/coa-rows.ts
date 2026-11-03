/**
 * Pure helpers for COA `query` responses that carry result rows: Tier-1
 * governed metrics (grouped SQL → `resultRows`) and Tier-2 NL→SQL answers
 * with no synthesized prose. No provider, db or Next imports, so `node --test`
 * can load this module directly.
 */
import type { Citation } from "./types";

export type Row = Record<string, unknown>;

/** Maximum rows rendered into a markdown answer table. */
export const MAX_TABLE_ROWS = 50;

/** Numeric value of a column (COA returns SUM()/ROUND() results as strings). NaN when not numeric. */
export function num(v: unknown): number {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function snake(k: string): string {
  return k.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/**
 * Keep rows whose columns match every supplied arg. Arg keys may be camelCase
 * or snake_case (`unitId` matches column `unit_id`). Args whose column is not
 * in the row (e.g. a time bound the metric does not group by) do not filter.
 * When the column value is numeric, a leading `<word>-` prefix on the arg is
 * ignored, so `unit-7` matches `7`.
 */
export function filterRows(rows: Row[], args: Record<string, unknown>): Row[] {
  const filters = Object.entries(args).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return rows.filter((r) =>
    filters.every(([k, v]) => {
      const col = k in r ? k : snake(k);
      if (!(col in r)) return true;
      const cell = String(r[col]);
      const want = String(v);
      if (cell === want) return true;
      return Number.isFinite(num(r[col])) && want.replace(/^[A-Za-z]+-/, "") === cell;
    })
  );
}

/**
 * Reduce a governed metric's (already filtered) rows to one number.
 * 0 rows → NaN. 1 row → column `value`, else the column named like the metric,
 * else the single numeric column. More than 1 row → NaN (ambiguous; the
 * caller reports the row count).
 */
export function reduceMetricRows(name: string, rows: Row[]): number {
  if (rows.length !== 1) return NaN;
  const row = rows[0];
  for (const col of ["value", name]) {
    if (col in row && Number.isFinite(num(row[col]))) return num(row[col]);
  }
  const numeric = Object.keys(row).filter((c) => Number.isFinite(num(row[c])));
  return numeric.length === 1 ? num(row[numeric[0]]) : NaN;
}

/** True when COA's trace says the Tier-2 SQL result was cut at the row cap. */
export function isTruncated(trace: unknown): boolean {
  if (!Array.isArray(trace)) return false;
  return trace.some(
    (s: Record<string, unknown> | null | undefined) =>
      s?.step === "t2.sql.execute" && Boolean((s.detail as Record<string, unknown> | undefined)?.truncated)
  );
}

/** Render result rows as a markdown table (first MAX_TABLE_ROWS rows). */
export function formatResultRows(rows: Row[], truncated: boolean): string {
  if (rows.length === 0) return "0 rows from the live source.";
  const cols = Object.keys(rows[0]);
  const cell = (v: unknown) => String(v ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  const shown = rows.slice(0, MAX_TABLE_ROWS);
  const lines = [
    `| ${cols.join(" | ")} |`,
    `| ${cols.map(() => "---").join(" | ")} |`,
    ...shown.map((r) => `| ${cols.map((c) => cell(r[c])).join(" | ")} |`),
  ];
  const notes: string[] = [];
  if (shown.length < rows.length) notes.push(`showing the first ${shown.length}`);
  if (truncated) notes.push("COA truncated the result at the row cap, so there may be more");
  const head = `${rows.length} row${rows.length === 1 ? "" : "s"} from the live source${notes.length ? ` (${notes.join("; ")})` : ""}:`;
  return `${head}\n\n${lines.join("\n")}`;
}

const IDENT = String.raw`[\`"\[]?[A-Za-z_][\w$]*[\`"\]]?`;

/**
 * Distinct table names after FROM / JOIN in a SQL string. Quotes, backticks,
 * brackets and schema prefixes are stripped; subqueries (`FROM (SELECT …)`)
 * and CTE names (`WITH x AS (…)`) are not reported.
 */
export function tablesFromSql(sql: string): string[] {
  const clean = (s: string) => s.split(".").pop()!.replace(/[`"[\]\s]/g, "");
  const ctes = new Set<string>();
  const cteRe = new RegExp(String.raw`(?:\bWITH(?:\s+RECURSIVE)?|,)\s*(${IDENT})\s*(?:\([^()]*\)\s*)?AS\s*\(`, "gi");
  let m: RegExpExecArray | null;
  while ((m = cteRe.exec(sql)) !== null) ctes.add(clean(m[1]).toLowerCase());

  const out: string[] = [];
  const seen = new Set<string>();
  const re = new RegExp(String.raw`\b(?:FROM|JOIN)\s+((?:${IDENT}\s*\.\s*)*${IDENT})`, "gi");
  while ((m = re.exec(sql)) !== null) {
    const name = clean(m[1]);
    const key = name.toLowerCase();
    if (!name || seen.has(key) || ctes.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** One citation per table read; factCount = result rows that drew on it. */
export function tableCitations(tables: string[], rows: number, system = "COA registered source"): Citation[] {
  return tables.map((t) => ({ documentId: `coa-table:${t}`, title: t, system, factCount: rows }));
}
