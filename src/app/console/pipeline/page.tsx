"use client";
import { useState } from "react";
import { useAppStore } from "@/lib/store";
import { verticals } from "@/data/verticals";
import { useFidelity } from "@/lib/use-fidelity";
import { cn } from "@/lib/utils";
import { Info, Sparkles } from "lucide-react";

type VerticalConfig = (typeof verticals)[keyof typeof verticals];

/**
 * Extraction preview built from the vertical's own seed entities: the first 4
 * config graph nodes and up to 4 links among them (widened to the first 6
 * nodes when fewer than 2 links qualify).
 */
function buildPreview(data: VerticalConfig) {
  const pick = (n: number) => {
    const nodes = data.graphNodes.slice(0, n);
    const ids = new Set(nodes.map((x) => x.id));
    const links = data.graphLinks.filter((l) => ids.has(l.source) && ids.has(l.target)).slice(0, 4);
    return { nodes, links };
  };
  let { nodes, links } = pick(4);
  if (links.length < 2) ({ nodes, links } = pick(6));
  const labelOf = new Map(nodes.map((x) => [x.id, x.label]));
  return {
    entities: nodes.map((x) => ({ name: x.label, type: x.type })),
    relations: links.map((l) => ({ s: labelOf.get(l.source) ?? l.source, r: l.label, t: labelOf.get(l.target) ?? l.target })),
  };
}

export default function PipelinePage() {
  const { vertical } = useAppStore();
  const data = verticals[vertical];
  const fidelity = useFidelity();
  const [chunking, setChunking] = useState("semantic");
  const [embedding, setEmbedding] = useState("titan-1024");
  const [graphModel, setGraphModel] = useState("sonnet");
  const [showPreview, setShowPreview] = useState(false);

  const previewData = buildPreview(data);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Pipeline Configurator</h1>
        <p className="text-sm text-zinc-400 mt-0.5">{data.name} — ingestion pipeline settings</p>
      </div>
      {fidelity && (
        <div className="flex items-start gap-2 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 text-xs text-zinc-400">
          <Info className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
          <span>
            {fidelity === "coa"
              ? "Live COA: structured sources are mapped through the pack ontology as a virtual graph (nothing to re-sync); DOCUMENTS sources are chunked and embedded by COA for vector search."
              : `Preview only: this console does not run ingestion. The Demo graph is the local seed (src/data/datasets/${vertical}/).`}
          </span>
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <PipelineCard title="Chunking Strategy">
          {[["fixed", "Fixed", "512 tokens, 64 overlap"], ["semantic", "Semantic", "95th pctile breakpoint"], ["hierarchical", "Hierarchical", "Parent: 1024, Child: 256"], ["custom", "Custom Lambda", "Upload handler.zip"]].map(([v, l, d]) => (
            <label key={v} className={cn("flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-all border", chunking === v ? "border-indigo-500/40 bg-indigo-950/20" : "border-transparent hover:bg-white/[0.02]")}>
              <input type="radio" name="chunking" value={v} checked={chunking === v} onChange={() => setChunking(v)} className="accent-indigo-500" />
              <div><div className={cn("text-sm", chunking === v ? "text-white" : "text-zinc-400")}>{l}</div><div className="text-[11px] text-zinc-600">{d}</div></div>
            </label>
          ))}
        </PipelineCard>
        <PipelineCard title="Embedding Model">
          {[["titan-256", "Titan V2 — 256d", "Cost-optimized"], ["titan-1024", "Titan V2 — 1024d", "Recommended"], ["cohere", "Cohere Embed v3", "Multilingual"], ["binary", "Binary Embeddings", "32x compression"]].map(([v, l, d]) => (
            <label key={v} className={cn("flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-all border", embedding === v ? "border-indigo-500/40 bg-indigo-950/20" : "border-transparent hover:bg-white/[0.02]")}>
              <input type="radio" name="embedding" value={v} checked={embedding === v} onChange={() => setEmbedding(v)} className="accent-indigo-500" />
              <div><div className={cn("text-sm", embedding === v ? "text-white" : "text-zinc-400")}>{l}</div><div className="text-[11px] text-zinc-600">{d}</div></div>
            </label>
          ))}
        </PipelineCard>
        <PipelineCard title="Graph Construction">
          {[["sonnet", "Claude Sonnet 4.5", "Richer entities"], ["haiku", "Claude Haiku 4.5", "Faster, cheaper"]].map(([v, l, d]) => (
            <label key={v} className={cn("flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-all border", graphModel === v ? "border-indigo-500/40 bg-indigo-950/20" : "border-transparent hover:bg-white/[0.02]")}>
              <input type="radio" name="graph" value={v} checked={graphModel === v} onChange={() => setGraphModel(v)} className="accent-indigo-500" />
              <div><div className={cn("text-sm", graphModel === v ? "text-white" : "text-zinc-400")}>{l}</div><div className="text-[11px] text-zinc-600">{d}</div></div>
            </label>
          ))}
          <div className="pt-3 space-y-2 mt-2 border-t border-white/[0.06]">
            <button onClick={() => setShowPreview(true)} className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-lg text-sm font-medium shadow-lg shadow-indigo-900/20 transition-all">
              <Sparkles className="w-3.5 h-3.5" /> Preview Extraction
            </button>
            <button disabled title="Preview only: these settings are not applied. Ingestion runs in COA, not in this console." className="w-full px-3 py-2 border border-white/[0.08] text-zinc-500 rounded-lg text-sm cursor-not-allowed opacity-60">Apply & Re-sync</button>
          </div>
        </PipelineCard>
      </div>
      {showPreview && (
        <div className="rounded-xl border border-emerald-800/30 bg-emerald-950/10 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-medium text-emerald-300">Extraction preview (from the vertical&apos;s seed entities)</span>
          </div>
          <pre className="text-xs text-zinc-300 bg-black/30 p-4 rounded-lg overflow-x-auto border border-white/[0.04]">{JSON.stringify(previewData, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

function PipelineCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 font-medium mb-3">{title}</h3>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
