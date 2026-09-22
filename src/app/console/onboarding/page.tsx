"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Plug, CheckCircle2, Copy } from "lucide-react";
import schema from "@/data/datasets/schema.json";

const verticalExamples = [
  { id: "energy", label: "Energy & Utilities", description: "Outage intelligence, grid operations", color: "emerald" },
  { id: "cyber", label: "Cybersecurity", description: "Threat intelligence, attack chains", color: "red" },
  { id: "supply_chain", label: "Supply Chain", description: "Disruption tracking, logistics", color: "blue" },
  { id: "healthcare", label: "Healthcare", description: "Patient journeys, drug interactions", color: "purple" },
  { id: "financial", label: "Financial Services", description: "Fraud detection, compliance", color: "amber" },
];

export default function OnboardingPage() {
  const [selectedVertical, setSelectedVertical] = useState("energy");
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  const entityTypes = (schema.vertical_definition.example_entity_types as any)[selectedVertical === "cyber" ? "cybersecurity" : selectedVertical === "energy" ? "energy_outage" : selectedVertical] || [];
  const relationTypes = (schema.vertical_definition.example_relation_types as any)[selectedVertical === "cyber" ? "cybersecurity" : selectedVertical === "energy" ? "energy_outage" : selectedVertical] || [];

  const copyToClipboard = (text: string, section: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(section);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const nodeExample = JSON.stringify({
    id: "unique-id-001",
    label: "Human-readable name",
    type: entityTypes[0] || "EntityType",
    properties: { key1: "value1", key2: 42 }
  }, null, 2);

  const edgeExample = JSON.stringify({
    source: "node-id-A",
    target: "node-id-B",
    relation: relationTypes[0] || "RELATION_TYPE",
    properties: { confidence: 95, evidence: "source document" }
  }, null, 2);

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold text-white">Onboard a New Vertical</h1>
        <p className="text-sm text-zinc-400 mt-1">Provide data in the format below to launch a new knowledge graph vertical in minutes.</p>
      </div>

      {/* Step 1: Choose vertical */}
      <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center text-[11px] font-bold text-white">1</div>
          <h2 className="text-sm font-medium text-white">Choose Your Industry Vertical</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {verticalExamples.map((v) => (
            <button key={v.id} onClick={() => setSelectedVertical(v.id)}
              className={cn("p-3 rounded-lg border text-left transition-all",
                selectedVertical === v.id ? "border-indigo-500/50 bg-indigo-950/20" : "border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.02]")}>
              <div className="text-sm font-medium text-zinc-200">{v.label}</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">{v.description}</div>
            </button>
          ))}
        </div>
      </section>

      {/* Step 2: Entity Schema */}
      <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center text-[11px] font-bold text-white">2</div>
            <h2 className="text-sm font-medium text-white">Provide Nodes (entities)</h2>
          </div>
          <button onClick={() => copyToClipboard(nodeExample, "node")} className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300">
            {copiedSection === "node" ? <CheckCircle2 className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copiedSection === "node" ? "Copied!" : "Copy"}
          </button>
        </div>
        <div className="mb-3">
          <span className="text-xs text-zinc-500">Entity types for <span className="text-indigo-400">{selectedVertical}</span>:</span>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {entityTypes.map((t: string) => (
              <span key={t} className="px-2 py-0.5 rounded bg-indigo-950/30 border border-indigo-800/20 text-[11px] text-indigo-300 font-mono">{t}</span>
            ))}
          </div>
        </div>
        <pre className="text-xs text-zinc-300 bg-black/30 p-4 rounded-lg overflow-x-auto border border-white/[0.04] font-mono">{nodeExample}</pre>
        <p className="text-[11px] text-zinc-500 mt-2">File: <code className="text-zinc-400">nodes.json</code> — Array of node objects. One file per vertical.</p>
      </section>

      {/* Step 3: Edge Schema */}
      <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center text-[11px] font-bold text-white">3</div>
            <h2 className="text-sm font-medium text-white">Provide Edges (relationships)</h2>
          </div>
          <button onClick={() => copyToClipboard(edgeExample, "edge")} className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300">
            {copiedSection === "edge" ? <CheckCircle2 className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copiedSection === "edge" ? "Copied!" : "Copy"}
          </button>
        </div>
        <div className="mb-3">
          <span className="text-xs text-zinc-500">Relationship types for <span className="text-indigo-400">{selectedVertical}</span>:</span>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {relationTypes.map((t: string) => (
              <span key={t} className="px-2 py-0.5 rounded bg-purple-950/30 border border-purple-800/20 text-[11px] text-purple-300 font-mono">{t}</span>
            ))}
          </div>
        </div>
        <pre className="text-xs text-zinc-300 bg-black/30 p-4 rounded-lg overflow-x-auto border border-white/[0.04] font-mono">{edgeExample}</pre>
        <p className="text-[11px] text-zinc-500 mt-2">File: <code className="text-zinc-400">edges.json</code> — Array of edge objects referencing node IDs.</p>
      </section>

      {/* Step 4: Connectors */}
      <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center text-[11px] font-bold text-white">4</div>
          <h2 className="text-sm font-medium text-white">Configure Data Connectors</h2>
        </div>
        <div className="grid gap-2">
          {schema.connector_types.map((c) => (
            <div key={c.type} className="flex items-center gap-3 p-3 rounded-lg border border-white/[0.06] bg-black/20">
              <Plug className="w-4 h-4 text-zinc-400 flex-shrink-0" />
              <div className="flex-1">
                <div className="text-sm text-zinc-200">{c.type}</div>
                <div className="text-[11px] text-zinc-500">{c.description}</div>
              </div>
              <div className="text-[10px] text-zinc-600 font-mono hidden md:block max-w-[200px] truncate">
                {Object.keys(c.config).join(", ")}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Summary */}
      <section className="rounded-xl border border-emerald-800/20 bg-emerald-950/10 p-5">
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          <h2 className="text-sm font-medium text-emerald-300">Ready to Demo</h2>
        </div>
        <p className="text-xs text-zinc-400 leading-relaxed">
          Once you provide <code className="text-zinc-300">nodes.json</code>, <code className="text-zinc-300">edges.json</code>, and configure at least one connector,
          GroundWork will automatically: ingest documents → chunk → embed (Titan V2) → extract entities (Claude) → build knowledge graph (Neptune) → enable GraphRAG queries.
          Total setup time: ~15 minutes for a new vertical.
        </p>
      </section>
    </div>
  );
}
