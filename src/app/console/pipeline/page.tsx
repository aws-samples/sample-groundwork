"use client";
import { useState } from "react";
import { useAppStore } from "@/lib/store";
import { verticals } from "@/data/verticals";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";

export default function PipelinePage() {
  const { vertical } = useAppStore();
  const data = verticals[vertical];
  const [chunking, setChunking] = useState("semantic");
  const [embedding, setEmbedding] = useState("titan-1024");
  const [graphModel, setGraphModel] = useState("sonnet");
  const [showPreview, setShowPreview] = useState(false);

  const previewData = vertical === "cyber"
    ? { entities: [{ name: "APT29", type: "ThreatActor" }, { name: "CVE-2020-10148", type: "CVE" }, { name: "T1195.002", type: "Technique" }, { name: "SUNBURST", type: "Malware" }], relations: [{ s: "APT29", r: "DEPLOYS_MALWARE", t: "SUNBURST" }, { s: "APT29", r: "EXPLOITS", t: "CVE-2020-10148" }, { s: "APT29", r: "USES_TECHNIQUE", t: "T1195.002" }] }
    : vertical === "energy"
    ? { entities: [{ name: "Outage OE-4471", type: "Outage" }, { name: "TX-447", type: "Asset" }, { name: "Thermal Overload", type: "RootCause" }, { name: "Crew Alpha-7", type: "Crew" }], relations: [{ s: "Outage OE-4471", r: "CAUSED_BY", t: "Thermal Overload" }, { s: "Thermal Overload", r: "AFFECTS", t: "TX-447" }, { s: "Outage OE-4471", r: "ASSIGNED_TO", t: "Crew Alpha-7" }] }
    : { entities: [{ name: "VOLTZITE", type: "ThreatGroup" }, { name: "CVE-2024-3400", type: "Vulnerability" }, { name: "VPN Gateway (PAN-OS)", type: "OTAsset" }, { name: "T0866: Exploit Remote Svc", type: "ICSTechnique" }], relations: [{ s: "VOLTZITE", r: "EXPLOITS", t: "CVE-2024-3400" }, { s: "CVE-2024-3400", r: "AFFECTS_ASSET", t: "VPN Gateway (PAN-OS)" }, { s: "VOLTZITE", r: "USES_TECHNIQUE", t: "T0866: Exploit Remote Svc" }] };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Pipeline Configurator</h1>
        <p className="text-sm text-zinc-400 mt-0.5">{data.name} — ingestion pipeline settings</p>
      </div>
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
            <button className="w-full px-3 py-2 border border-white/[0.08] text-zinc-300 hover:bg-white/[0.04] rounded-lg text-sm transition-colors">Apply & Re-sync</button>
          </div>
        </PipelineCard>
      </div>
      {showPreview && (
        <div className="rounded-xl border border-emerald-800/30 bg-emerald-950/10 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-medium text-emerald-300">Extraction Preview (1 chunk sample)</span>
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
