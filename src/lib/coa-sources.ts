import fs from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";
import { getMode, type ContextMode } from "@/lib/context";
import { getCoaToken } from "@/lib/context/coa-token";
import { coaNamespace } from "@/lib/context/coa-namespace";
import { VERTICAL_TO_PACK } from "@/lib/context/pack-loader";
import { verticals } from "@/data/verticals";
import {
  sanitizeSource,
  maskNamespacePath,
  liveSourceEvents,
  type SeedSourceGroup,
  type SourceEvent,
  type SourcesResponse,
} from "@/lib/coa-source-shape";

export type { SourcesResponse, SourceSummary, SourceTable, SourceEvent, SeedSourceGroup } from "@/lib/coa-source-shape";

/**
 * Server-only: a vertical's data sources, honestly labelled per mode.
 *
 *   coa + COA_NAMESPACE_<V> set → live, read-only COA Serve REST (GET only):
 *       /namespaces/{ns}/sources, /sources/{id}, /sources/{id}/tables
 *       (tables skipped for DOCUMENTS). Output is sanitized by an allowlist
 *       (coa-source-shape.ts) and never carries the namespace id.
 *   coa, namespace not set → { origin: "coa-not-configured", envVar }, no call.
 *   mock / ontology → the local seed actually loaded into SQLite:
 *       src/data/datasets/<v>/{documents,nodes,edges}.json, plus the pack
 *       sources.yaml declared-source count.
 */

/** Thrown for COA failures; the route maps it to HTTP 502. */
export class CoaSourcesError extends Error {}

const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 15_000;
const SEED_EVENT_LIMIT = 10;
const _cache = new Map<string, { at: number; value: SourcesResponse }>();

export async function getVerticalSources(vertical: string, { refresh = false }: { refresh?: boolean } = {}): Promise<SourcesResponse> {
  if (!Object.prototype.hasOwnProperty.call(verticals, vertical)) {
    throw new Error(`Unsupported vertical '${vertical}'`);
  }
  const mode = getMode();
  if (mode === "coa") {
    const ns = coaNamespace(vertical);
    if (!ns.configured) {
      return {
        vertical,
        mode,
        origin: "coa-not-configured",
        fetchedAt: new Date().toISOString(),
        namespace: packOf(vertical),
        namespaceConfigured: false,
        envVar: `COA_NAMESPACE_${vertical.toUpperCase()}`,
        sources: [],
        events: [],
      };
    }
    return getLiveSources(vertical, ns.id, refresh);
  }
  return getSeedSources(vertical, mode);
}

/**
 * Best-effort set of live COA sourceType values for a vertical (e.g.
 * "DOCUMENTS", "JDBC_DATABASE"). Uses the same 60 s cache. Returns null when
 * the vertical is not live-configured or COA could not be reached.
 */
export async function listSourceTypes(vertical: string): Promise<Set<string> | null> {
  try {
    const res = await getVerticalSources(vertical);
    if (res.origin !== "coa-live") return null;
    return new Set(res.sources.map((s) => s.sourceType).filter(Boolean));
  } catch {
    return null;
  }
}

function packOf(vertical: string): string {
  return VERTICAL_TO_PACK[vertical] ?? vertical;
}

// ---- Live COA ---------------------------------------------------------------

async function coaGet(baseUrl: string, token: string, p: string): Promise<Record<string, unknown>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(`${baseUrl}${p}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!resp.ok) {
      const hint = resp.status === 401 || resp.status === 403 ? " (COA token expired or credentials invalid)" : "";
      throw new CoaSourcesError(`COA GET ${maskNamespacePath(p)} failed: ${resp.status} ${resp.statusText}${hint}`);
    }
    return (await resp.json()) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof CoaSourcesError) throw err;
    if ((err as Error).name === "AbortError") throw new CoaSourcesError(`COA request timed out after ${FETCH_TIMEOUT_MS / 1000}s`);
    throw new CoaSourcesError(`COA request failed: ${maskNamespacePath((err as Error).message.split("\n")[0].slice(0, 160))}`);
  } finally {
    clearTimeout(timer);
  }
}

async function getLiveSources(vertical: string, namespaceId: string, refresh: boolean): Promise<SourcesResponse> {
  const baseUrl = (process.env.COA_BASE_URL ?? "").replace(/\/+$/, "");
  if (!baseUrl) throw new CoaSourcesError("Live COA is not configured (COA_BASE_URL missing).");

  const cached = _cache.get(vertical);
  if (!refresh && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  let token: string | null | undefined;
  try {
    token = (await getCoaToken()) ?? process.env.COA_TOKEN;
  } catch (err) {
    throw new CoaSourcesError(`Could not obtain a COA token; credentials invalid? (${(err as Error).message.split("\n")[0].slice(0, 160)})`);
  }
  if (!token) throw new CoaSourcesError("No COA token available (COA token expired or credentials not configured).");

  const ns = `/namespaces/${encodeURIComponent(namespaceId)}`;
  const list = await coaGet(baseUrl, token, `${ns}/sources`);
  const items = (list.items ?? list.sources ?? []) as Array<Record<string, unknown>>;
  const sources = await Promise.all(
    items.map(async (item) => {
      const id = encodeURIComponent(String(item.sourceId ?? item.id ?? ""));
      // Document sources have no tables; skip that GET for them.
      const isDocuments = String(item.sourceType ?? "") === "DOCUMENTS";
      const [detail, tablesRes] = await Promise.all([
        coaGet(baseUrl, token, `${ns}/sources/${id}`),
        isDocuments ? Promise.resolve({} as Record<string, unknown>) : coaGet(baseUrl, token, `${ns}/sources/${id}/tables`),
      ]);
      return sanitizeSource(item, detail, tablesRes);
    })
  );

  const value: SourcesResponse = {
    vertical,
    mode: "coa",
    origin: "coa-live",
    fetchedAt: new Date().toISOString(),
    namespace: packOf(vertical),
    namespaceConfigured: true,
    sources,
    events: liveSourceEvents(sources),
  };
  _cache.set(vertical, { at: Date.now(), value });
  return value;
}

// ---- Demo seed (Demo data / Local ontology) ---------------------------------

interface SeedDoc {
  source?: unknown;
  title?: unknown;
  ingested?: unknown;
  chunks?: unknown;
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Count entries in a seed file shaped as an array or { <key>: [] }. */
function countEntries(data: unknown, key: string): number {
  if (Array.isArray(data)) return data.length;
  const inner = (data as Record<string, unknown> | null)?.[key];
  return Array.isArray(inner) ? inner.length : 0;
}

function packSourcesDeclared(pack: string): number | undefined {
  try {
    const doc = parseYaml(fs.readFileSync(path.join(process.cwd(), "packs", pack, "sources.yaml"), "utf8")) as { sources?: unknown } | null;
    return Array.isArray(doc?.sources) ? doc.sources.length : 0;
  } catch {
    return undefined;
  }
}

function isoOrUndefined(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

function getSeedSources(vertical: string, mode: ContextMode): SourcesResponse {
  const datasetPath = ["src", "data", "datasets", vertical].join("/");
  const dir = path.join(process.cwd(), "src", "data", "datasets", vertical);
  const docsRaw = readJson(path.join(dir, "documents.json"));
  const docs = (Array.isArray(docsRaw) ? docsRaw : ((docsRaw as { documents?: unknown[] }).documents ?? [])) as SeedDoc[];

  const groups = new Map<string, SeedSourceGroup>();
  const events: SourceEvent[] = [];
  let chunks = 0;
  for (const d of docs) {
    const source = typeof d.source === "string" && d.source ? d.source : "Unlabelled";
    const c = typeof d.chunks === "number" ? d.chunks : 0;
    const at = isoOrUndefined(d.ingested);
    const g = groups.get(source) ?? { source, docs: 0, chunks: 0 };
    g.docs += 1;
    g.chunks += c;
    if (at && (!g.latestIngested || at > g.latestIngested)) g.latestIngested = at;
    groups.set(source, g);
    chunks += c;
    if (at) events.push({ title: `${typeof d.title === "string" ? d.title : source} ingested`, at, kind: "seed-ingested" });
  }

  const pack = packOf(vertical);
  return {
    vertical,
    mode,
    origin: "demo-seed",
    fetchedAt: new Date().toISOString(),
    namespace: pack,
    sources: [],
    seed: {
      datasetPath,
      groups: [...groups.values()].sort((a, b) => b.docs - a.docs || a.source.localeCompare(b.source)),
      documents: docs.length,
      chunks,
      nodes: countEntries(readJson(path.join(dir, "nodes.json")), "nodes"),
      edges: countEntries(readJson(path.join(dir, "edges.json")), "edges"),
    },
    packSourcesDeclared: packSourcesDeclared(pack),
    events: events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, SEED_EVENT_LIMIT),
  };
}
