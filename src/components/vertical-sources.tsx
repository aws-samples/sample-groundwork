"use client";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { verticals, type Vertical } from "@/data/verticals";
import type { SourceSummary, SourcesResponse } from "@/lib/coa-source-shape";
import { cn } from "@/lib/utils";
import { AlertCircle, ChevronDown, ChevronRight, Database, FileText, Info, Loader2, Plus, RefreshCw } from "lucide-react";

/*
 * Sources page body for every vertical, fed by GET /api/sources:
 *   coa-live           → the sources registered in the vertical's COA namespace
 *   coa-not-configured → a neutral note naming the COA_NAMESPACE_<V> env var
 *   demo-seed          → the local seed actually loaded into SQLite
 * Nothing here is invented: statuses, dates and counts are whatever the route
 * returns. Times are absolute UTC, never relative. Read-only (GET only).
 */

/** ISO → "2026-01-02 03:04:05 UTC" (absolute, never relative). */
export function formatUtc(iso?: string): string {
  if (!iso) return "—";
  return iso.replace("T", " ").replace(/(\.\d+)?Z$/, " UTC");
}

const primaryBtn =
  "flex items-center gap-1.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-lg shadow-indigo-900/30 transition-all";
const secondaryBtn = "px-4 py-2 border border-white/[0.08] rounded-lg text-sm text-zinc-300 hover:bg-white/[0.04] transition-colors";
const card = "rounded-xl border border-white/[0.06] bg-white/[0.02] p-4";

type LoadedSources = Partial<SourcesResponse> & { sources: SourceSummary[]; events: SourcesResponse["events"] };

function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
}

export function VerticalSources({ vertical, onAdd, onViewSchema }: { vertical: Vertical; onAdd: () => void; onViewSchema: () => void }) {
  const name = verticals[vertical].name;
  const [data, setData] = useState<LoadedSources | null>(null);
  const [loading, setLoading] = useState(true);

  // State is only set in the promise callbacks; the Refresh button sets
  // `loading` itself before calling load(true). The parent keys this
  // component by vertical, so a vertical switch starts from a clean state.
  const load = useCallback(
    (refresh: boolean) => {
      fetch(`/api/sources?vertical=${encodeURIComponent(vertical)}${refresh ? "&refresh=1" : ""}`)
        .then(async (r) => {
          const body = (await r.json().catch(() => ({}))) as Partial<SourcesResponse>;
          setData({
            ...body,
            sources: body.sources ?? [],
            events: body.events ?? [],
            error: r.ok ? body.error : (body.error ?? `Request failed (${r.status})`),
          });
        })
        .catch((e: unknown) => setData({ sources: [], events: [], error: (e as Error).message }))
        .finally(() => setLoading(false));
    },
    [vertical]
  );

  useEffect(() => {
    load(false);
  }, [load]);

  const seedLabel = data?.mode === "ontology" ? "Local ontology" : "Demo data";
  const subtitle = !data
    ? `${name} — loading sources…`
    : data.error
      ? `${name} — source status unavailable`
      : data.origin === "coa-live"
        ? `${name} — ${plural(data.sources.length, "registered source")} (Live COA)`
        : data.origin === "coa-not-configured"
          ? `${name} — Live COA not configured`
          : `${name} — ${plural(data.seed?.groups.length ?? 0, "seed source")} (${seedLabel})`;

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Source Connector</h1>
          <p className="text-sm text-zinc-400 mt-0.5">{subtitle}</p>
        </div>
        <button onClick={onAdd} className={primaryBtn}>
          <Plus className="w-4 h-4" /> Add Source
        </button>
      </div>

      {!data && (
        <div className={cn(card, "flex items-center gap-2 text-sm text-zinc-400")}>
          <Loader2 className="w-4 h-4 animate-spin" /> Loading sources…
        </div>
      )}

      {data?.error && (
        <div className="rounded-xl border border-red-800/30 bg-red-950/20 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-red-300">
            <AlertCircle className="w-4 h-4" /> Could not load source status
          </div>
          <p className="text-xs text-red-300/80 mt-1.5 font-mono break-words">{data.error}</p>
          <p className="text-xs text-zinc-500 mt-2">No fallback list is shown. This page only displays what the sources API reports.</p>
        </div>
      )}

      {data && !data.error && data.origin === "coa-live" && (
        <div className="grid gap-3">
          {data.sources.length === 0 && (
            <div className={cn(card, "text-sm text-zinc-400")}>No sources are registered in this vertical&apos;s COA namespace yet.</div>
          )}
          {data.sources.map((s) => (
            <LiveSourceCard key={s.id || s.name} s={s} />
          ))}
          <p className="text-[11px] text-zinc-600">Fetched live from COA at {formatUtc(data.fetchedAt)} (read-only; cached up to 60 s).</p>
        </div>
      )}

      {data && !data.error && data.origin === "coa-not-configured" && (
        <div className={cn(card, "flex items-start gap-3")}>
          <Info className="w-4 h-4 text-zinc-400 mt-0.5 shrink-0" />
          <p className="text-sm text-zinc-300">
            Live COA isn&apos;t configured for {name}. Set <span className="font-mono text-zinc-200">{data.envVar}</span> to the namespace id to show its registered sources.
          </p>
        </div>
      )}

      {data && !data.error && data.origin === "demo-seed" && data.seed && (
        <div className="grid gap-3">
          <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.08] text-xs text-zinc-300">
            Demo seed — loaded into local SQLite from {data.seed.datasetPath}/; not a live connection.
          </div>
          {data.seed.groups.map((g) => (
            <div key={g.source} className={card}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-white/[0.05] border border-white/[0.06] text-emerald-400">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-medium text-sm text-zinc-100">{g.source}</div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      {plural(g.docs, "document")} • {plural(g.chunks, "chunk")}
                    </div>
                  </div>
                </div>
                <div className="text-[11px] text-zinc-500 text-right">Latest ingested {formatUtc(g.latestIngested)}</div>
              </div>
            </div>
          ))}
          <div className="text-[11px] text-zinc-500 space-y-0.5">
            <p>
              Seed totals: {plural(data.seed.documents, "document")}, {plural(data.seed.chunks, "chunk")}; seed graph {plural(data.seed.nodes, "node")} /{" "}
              {plural(data.seed.edges, "edge")}.
            </p>
            <p className="font-mono">
              packs/{data.namespace}/sources.yaml:{" "}
              {data.packSourcesDeclared === undefined
                ? "not present"
                : `registration template only (${plural(data.packSourcesDeclared, "source")} declared)`}
            </p>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => {
            setLoading(true);
            load(true);
          }}
          disabled={loading}
          className={cn(secondaryBtn, "flex items-center gap-1.5 disabled:opacity-50")}
        >
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} /> Refresh status
        </button>
        <button onClick={onViewSchema} className={secondaryBtn}>
          View Schema
        </button>
      </div>
    </>
  );
}

function StatusChip({ status }: { status: string }) {
  const s = status.toUpperCase();
  const tone =
    s === "APPROVED" || s === "COMPLETED"
      ? "bg-emerald-950/50 text-emerald-400 border-emerald-800/30"
      : s === "ERROR" || s === "FAILED"
        ? "bg-red-950/50 text-red-400 border-red-800/30"
        : "bg-white/[0.04] text-zinc-300 border-white/[0.08]";
  return <Badge className={cn("border text-xs", tone)}>{status}</Badge>;
}

function LiveSourceCard({ s }: { s: SourceSummary }) {
  const [open, setOpen] = useState(false);
  const isDocs = s.sourceType === "DOCUMENTS";
  const total = s.tablesDiscovered ?? s.tables.length;
  const n = (v?: number) => (v === undefined ? undefined : v.toLocaleString());
  const facts: [string, string | undefined][] = isDocs
    ? [
        ["Files", s.filesTotal !== undefined ? `${n(s.documentsProcessed) ?? "?"}/${n(s.filesTotal)} processed` : undefined],
        ["Files errored", n(s.filesErrored)],
        ["Chunks embedded", n(s.chunksEmbedded)],
        ["Chunks to graph", n(s.chunksGraph)],
      ]
    : [
        ["Engine", s.engine],
        ["Port", s.port !== undefined ? String(s.port) : undefined],
        ["Database", s.databaseName],
        ["Instance", s.rdsInstance],
        ["Query engine", s.queryEngine],
        ["Catalog", s.glueCatalog],
        ["Tables", s.tablesApproved !== undefined ? `${s.tablesApproved}/${total} tables approved` : `${total} discovered`],
      ];

  return (
    <div className={card}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-white/[0.05] border border-white/[0.06] text-orange-400">
            {isDocs ? <FileText className="w-4 h-4" /> : <Database className="w-4 h-4" />}
          </div>
          <div>
            <div className="font-medium text-sm text-zinc-100 font-mono">{s.name || s.id}</div>
            <div className="text-xs text-zinc-500 mt-0.5">{[s.sourceType, s.sourceSubType].filter(Boolean).join(" · ")}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="bg-white/[0.04] text-zinc-400 border border-white/[0.08] text-[10px]">Live COA</Badge>
          <StatusChip status={s.status} />
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2 mt-4">
        {facts
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => (
            <div key={k}>
              <div className="text-[10px] uppercase tracking-wider text-zinc-600">{k}</div>
              <div className="text-xs text-zinc-300 font-mono break-all">{v}</div>
            </div>
          ))}
      </div>
      <div className="text-[11px] text-zinc-500 mt-3">
        Created {formatUtc(s.createdAt)} · Updated {formatUtc(s.updatedAt)}
        {isDocs ? "" : ` · Last scan ${formatUtc(s.lastScanAt)}`}
      </div>
      {s.tables.length > 0 && (
        <div className="mt-3 border-t border-white/[0.04] pt-3">
          <button onClick={() => setOpen(!open)} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200">
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            {open ? "Hide" : "Show"} {plural(s.tables.length, "table")}
          </button>
          {open && (
            <div className="mt-2 grid gap-1">
              {s.tables.map((t) => (
                <div key={t.name} className="flex items-center justify-between text-xs px-2 py-1 rounded bg-white/[0.02]">
                  <span className="font-mono text-zinc-300">{t.name}</span>
                  <span className="text-zinc-500">
                    {t.columns ?? "?"} columns{t.columnsApproved !== undefined ? ` (${t.columnsApproved} approved)` : ""} · {t.reviewStatus ?? "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
