"use client";
import { useAppStore } from "@/lib/store";
import { verticals } from "@/data/verticals";
import { useFidelity } from "@/lib/use-fidelity";
import { useApiJson } from "@/lib/use-api-json";
import type { SourcesResponse } from "@/lib/coa-source-shape";
import type { PackSchemaDetail } from "@/lib/context/pack-schema";
import { formatUtc } from "@/components/vertical-sources";
import { cn } from "@/lib/utils";
import { Info } from "lucide-react";

/*
 * Observability for every vertical, showing only what this console can
 * actually observe: sources from GET /api/sources (live COA or the local
 * seed), seed graph counts, and the governed metrics from GET /api/schema.
 * Latency, cache and accuracy are not instrumented, and say so. The cost card
 * is an illustrative estimate, not metered.
 */
const NOT_INSTRUMENTED = "Not instrumented";

export default function MonitorPage() {
  const { vertical } = useAppStore();
  const data = verticals[vertical];
  const fidelity = useFidelity();
  const q = `vertical=${encodeURIComponent(vertical)}`;
  const sources = useApiJson<SourcesResponse>(`/api/sources?${q}`);
  const schema = useApiJson<PackSchemaDetail>(`/api/schema?${q}`);
  const s = sources.data;
  const seed = s?.seed;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Observability Dashboard</h1>
        <p className="text-sm text-zinc-400 mt-0.5">{data.name} — semantic layer health & metrics</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SourcesCard sources={sources.data} error={sources.error} loading={sources.loading} />
        <StatCard
          title="Graph"
          badge="Local SQLite seed"
          items={[
            { label: "Nodes", value: seed ? seed.nodes.toLocaleString() : "—" },
            { label: "Edges", value: seed ? seed.edges.toLocaleString() : "—" },
          ]}
          note={
            fidelity === "coa"
              ? "The live COA graph is virtual (mapped over registered sources); node and edge counts are not materialized."
              : seed
                ? `Loaded from ${seed.datasetPath}/.`
                : undefined
          }
        />
        <StatCard
          title="Retrieval"
          items={[
            { label: "p50 latency", value: NOT_INSTRUMENTED, muted: true },
            { label: "p99 latency", value: NOT_INSTRUMENTED, muted: true },
            { label: "Cache hit rate", value: NOT_INSTRUMENTED, muted: true },
            { label: "Governed metrics", value: schema.data ? String(schema.data.counts.metrics) : "—" },
          ]}
          note={schema.data && schema.data.metrics.length > 0 ? schema.data.metrics.join(", ") : schema.error ?? undefined}
        />
      </div>

      {/* Accuracy */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
        <h3 className="text-sm font-medium text-zinc-300 mb-3">GraphRAG vs Vector Accuracy</h3>
        <div className="flex items-start gap-2 text-xs text-zinc-500">
          <Info className="w-4 h-4 shrink-0" />
          <span>No accuracy evaluation has been run for this vertical.</span>
        </div>
      </div>

      {/* Cost */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-zinc-300">Estimated Monthly Cost</h3>
          <span className="text-[10px] text-amber-300 bg-amber-950/30 border border-amber-800/30 rounded px-1.5 py-0.5">Illustrative — not metered</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <CostItem label="Neptune Analytics" cost="$149.76" detail="$0.48/hr × 312hr" />
          <CostItem label="Bedrock (embed)" cost="$28.40" detail="$0.002/1K tokens" />
          <CostItem label="OpenSearch Serverless" cost="$345.60" detail="2 OCU × $0.24/hr" />
          <CostItem label="Bedrock (inference)" cost="~$52.00" detail="Varies by usage" />
        </div>
        <div className="mt-4 pt-3 border-t border-white/[0.04] flex justify-between items-center">
          <span className="text-xs text-zinc-500">Total estimated (illustrative)</span>
          <span className="text-lg font-bold text-white">$575.76<span className="text-xs text-zinc-500 font-normal">/month</span></span>
        </div>
        {fidelity && fidelity !== "coa" && (
          <p className="text-xs text-zinc-500 mt-3">$0 AWS locally — the figures show what Live COA would provision.</p>
        )}
      </div>
    </div>
  );
}

function SourcesCard({ sources, error, loading }: { sources: SourcesResponse | null; error: string | null; loading: boolean }) {
  if (loading) return <StatCard title="Sources" items={[]} note="Loading…" />;
  if (error || !sources) return <StatCard title="Sources" items={[]} note={`Sources unavailable: ${error ?? "no response"}`} />;
  if (sources.origin === "coa-not-configured") {
    return <StatCard title="Sources" badge="Live COA" items={[]} note={`Live COA not configured — set ${sources.envVar ?? "COA_NAMESPACE_<VERTICAL>"} to read this vertical's registered sources.`} />;
  }
  if (sources.origin === "coa-live") {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <CardHeader title="Sources" badge="Live COA" />
        {sources.sources.length === 0 && <p className="text-xs text-zinc-500">No sources are registered in this namespace.</p>}
        <div className="space-y-3">
          {sources.sources.map((src) => (
            <div key={src.id || src.name} className="text-xs space-y-1 border-t border-white/[0.04] pt-2 first:border-0 first:pt-0">
              <div className="flex justify-between gap-2">
                <span className="text-zinc-200 font-medium truncate">{src.name || src.sourceType}</span>
                <span className="text-zinc-400 shrink-0">{src.status}</span>
              </div>
              <div className="text-zinc-500">{[src.sourceType, src.sourceSubType].filter(Boolean).join(" · ")}</div>
              {src.sourceType === "DOCUMENTS" ? (
                <div className="text-zinc-500">
                  Files {src.documentsProcessed ?? "—"}/{src.filesTotal ?? "—"} · chunks embedded {src.chunksEmbedded ?? "—"}
                </div>
              ) : (
                <div className="text-zinc-500">
                  Tables approved {src.tablesApproved ?? "—"}/{src.tablesDiscovered ?? "—"} · last scan {formatUtc(src.lastScanAt)}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }
  const seed = sources.seed;
  const latest = seed?.groups.map((g) => g.latestIngested).filter((x): x is string => Boolean(x)).sort().pop();
  return (
    <StatCard
      title="Sources"
      badge="Demo seed"
      items={[
        { label: "Seed sources", value: seed ? String(seed.groups.length) : "—" },
        { label: "Documents", value: seed ? seed.documents.toLocaleString() : "—" },
        { label: "Chunks", value: seed ? seed.chunks.toLocaleString() : "—" },
        { label: "Latest ingest", value: formatUtc(latest) },
      ]}
      note="Loaded into local SQLite from the seed dataset; not a live connection."
    />
  );
}

function CardHeader({ title, badge }: { title: string; badge?: string }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 font-medium">{title}</h3>
      {badge && <span className="text-[9px] text-indigo-400/70 bg-indigo-950/30 border border-indigo-800/20 rounded px-1.5 py-0.5">{badge}</span>}
    </div>
  );
}

function StatCard({ title, badge, items, note }: { title: string; badge?: string; items: { label: string; value: string; muted?: boolean }[]; note?: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <CardHeader title={title} badge={badge} />
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.label} className="flex justify-between items-center text-sm gap-2">
            <span className="text-zinc-500">{item.label}</span>
            <span className={cn("font-medium text-right", item.muted ? "text-zinc-500 text-xs" : "text-zinc-200")}>{item.value}</span>
          </div>
        ))}
      </div>
      {note && <p className="text-[11px] text-zinc-500 mt-3 leading-snug">{note}</p>}
    </div>
  );
}

function CostItem({ label, cost, detail }: { label: string; cost: string; detail: string }) {
  return (
    <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="text-base font-semibold text-zinc-100 mt-1">{cost}</div>
      <div className="text-[10px] text-zinc-600 mt-0.5">{detail}</div>
    </div>
  );
}
