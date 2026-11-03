"use client";
import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/store";
import { verticals, type AddSourceTypeId, type Vertical } from "@/data/verticals";
import { VerticalSources } from "@/components/vertical-sources";
import type { PackSchemaDetail, LiveClassBreakdown } from "@/lib/context/pack-schema";
import { Database, Globe, X, ArrowRight, Cloud, Server, FileText, Info, Loader2, Table } from "lucide-react";
import { cn } from "@/lib/utils";

interface SourceTypeOption {
  id: AddSourceTypeId;
  label: string;
  desc: string;
  pathLabel: string;
  icon: typeof Database;
  /** Literal Tailwind class (dynamic class names are not generated). */
  iconClass: string;
}

const sourceTypes: SourceTypeOption[] = [
  { id: "s3", label: "Amazon S3", desc: "Documents, PDFs, JSON from S3 buckets", pathLabel: "S3 URI", icon: Database, iconClass: "text-amber-400" },
  { id: "web", label: "Web Crawler", desc: "Crawl and index web pages", pathLabel: "Start URL", icon: Globe, iconClass: "text-blue-400" },
  { id: "api", label: "Custom API", desc: "Push content via REST endpoint", pathLabel: "API Endpoint", icon: Server, iconClass: "text-purple-400" },
  { id: "csv", label: "CSV / Structured", desc: "Import structured data files", pathLabel: "File Path", icon: FileText, iconClass: "text-emerald-400" },
  { id: "confluence", label: "Confluence", desc: "Sync Confluence spaces", pathLabel: "Confluence Space", icon: Cloud, iconClass: "text-cyan-400" },
  { id: "jdbc", label: "Relational DB (JDBC)", desc: "Register a database COA federates as a virtual graph", pathLabel: "JDBC URL", icon: Table, iconClass: "text-orange-400" },
];

export default function SourcesPage() {
  const { vertical } = useAppStore();
  const [showAdd, setShowAdd] = useState(false);
  const [showSchema, setShowSchema] = useState(false);

  return (
    <div className="space-y-6">
      <VerticalSources key={vertical} vertical={vertical} onAdd={() => setShowAdd(true)} onViewSchema={() => setShowSchema(true)} />
      {showSchema && <SchemaModal vertical={vertical} onClose={() => setShowSchema(false)} />}
      {showAdd && <AddSourceWalkthrough vertical={vertical} onClose={() => setShowAdd(false)} />}
    </div>
  );
}

// ---- Add Source walkthrough -----------------------------------------------------

const STEP_LABELS = ["Select Type", "Configure", "Preview", "Complete"];

const JDBC_STEPS = [
  { title: "Register source", detail: "POST /namespaces/{ns}/sources as a JDBC_DATABASE source, with the connection details and a credential secret" },
  { title: "Scan schema", detail: "COA discovers the database's tables and columns" },
  { title: "Review & approve tables", detail: "Choose which tables and columns map onto the pack ontology classes" },
  { title: "Federate via Glue/Athena", detail: "Approved tables are queried in place as a virtual graph; no data is copied" },
];

const DOCUMENT_STEPS = [
  { title: "Register DOCUMENTS source", detail: "POST /namespaces/{ns}/sources as a DOCUMENTS source" },
  { title: "Upload files", detail: "Add the files this source should contribute" },
  { title: "Extract entities", detail: "Entities and relationships are mapped onto the pack ontology classes" },
  { title: "Chunk & embed for vector search", detail: "Text is chunked and embedded into the namespace's vector index" },
];

function AddSourceWalkthrough({ vertical, onClose }: { vertical: Vertical; onClose: () => void }) {
  const { addSource } = verticals[vertical];
  const [step, setStep] = useState(0); // 0=type, 1=configure, 2=preview, 3=complete
  const [selectedType, setSelectedType] = useState<AddSourceTypeId | null>(null);
  const [config, setConfig] = useState({ name: "", path: "" });
  const selected = sourceTypes.find((t) => t.id === selectedType);
  const previewSteps = selectedType === "jdbc" ? JDBC_STEPS : DOCUMENT_STEPS;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-lg mx-4 rounded-2xl border border-white/[0.08] bg-[#111118] shadow-2xl shadow-black/50" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-white/[0.06]">
          <div>
            <h2 className="text-lg font-semibold text-white">Add Data Source</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Step {step + 1} of 4 — {STEP_LABELS[step]}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-white/[0.06] text-zinc-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 min-h-[320px]">
          {step === 0 && (
            <div className="space-y-2">
              <p className="text-sm text-zinc-400 mb-4">Choose the type of data source to walk through:</p>
              {sourceTypes.map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      setSelectedType(t.id);
                      setConfig(addSource.defaults[t.id]);
                    }}
                    className={cn(
                      "w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all",
                      selectedType === t.id ? "border-indigo-500/50 bg-indigo-950/30" : "border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.02]"
                    )}
                  >
                    <div className="p-2 rounded-lg bg-white/[0.05]">
                      <Icon className={cn("w-4 h-4", t.iconClass)} />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-zinc-200">{t.label}</div>
                      <div className="text-xs text-zinc-500">{t.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {step === 1 && selected && (
            <div className="space-y-4">
              <p className="text-sm text-zinc-400">
                Configure your <span className="text-white font-medium">{selected.label}</span> source:
              </p>
              <div>
                <label htmlFor="add-source-name" className="block text-xs text-zinc-500 mb-1.5">Display Name</label>
                <input
                  id="add-source-name"
                  value={config.name}
                  onChange={(e) => setConfig({ ...config, name: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-zinc-200 focus:outline-none focus:border-indigo-500/50"
                />
              </div>
              <div>
                <label htmlFor="add-source-path" className="block text-xs text-zinc-500 mb-1.5">{selected.pathLabel}</label>
                <input
                  id="add-source-path"
                  value={config.path}
                  onChange={(e) => setConfig({ ...config, path: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-zinc-200 font-mono text-xs focus:outline-none focus:border-indigo-500/50"
                />
              </div>
              <div className="p-3 rounded-lg bg-indigo-950/20 border border-indigo-800/20">
                <p className="text-xs text-indigo-300/80">{addSource.configureHint}</p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <span className="inline-block px-2 py-0.5 rounded-md border border-white/[0.1] bg-white/[0.04] text-[11px] text-zinc-300">
                Walkthrough preview — nothing is contacted
              </span>
              <p className="text-sm text-zinc-300">
                What registering <span className="font-medium text-white">{config.name || selected?.label}</span> in COA would do:
              </p>
              <ol className="space-y-2">
                {previewSteps.map((s, i) => (
                  <li key={s.title} className="flex gap-3 p-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02]">
                    <span className="text-xs font-mono text-zinc-500 mt-0.5">{i + 1}.</span>
                    <div>
                      <div className="text-sm text-zinc-200">{s.title}</div>
                      <div className="text-xs text-zinc-500 mt-0.5">{s.detail}</div>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="text-[11px] text-zinc-500">This console only reads COA. Register sources with the COA API or console.</p>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col items-center justify-center h-[280px] space-y-4 text-center">
              <Info className="w-12 h-12 text-zinc-400" />
              <p className="text-lg font-semibold text-white">Walkthrough complete</p>
              <p className="text-sm text-zinc-400 max-w-sm">
                Walkthrough only — no source was registered. Live sources are registered in COA, then appear on this page in Live COA mode.
              </p>
            </div>
          )}
        </div>

        <div className="px-6 pb-5 flex justify-between">
          {step > 0 && step < 3 ? (
            <button onClick={() => setStep(step - 1)} className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
              Back
            </button>
          ) : (
            <div />
          )}
          {step < 2 && (
            <button
              onClick={() => setStep(step + 1)}
              disabled={!selectedType}
              className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-30 text-white rounded-lg text-sm font-medium transition-all"
            >
              Next <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
          {step === 2 && (
            <button
              onClick={() => setStep(3)}
              className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-lg text-sm font-medium transition-all"
            >
              Finish walkthrough <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
          {step === 3 && (
            <button onClick={onClose} className="px-4 py-2 border border-white/[0.08] rounded-lg text-sm text-zinc-300 hover:bg-white/[0.04] transition-colors">
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- View Schema (pack ontology) ----------------------------------------------------

type SchemaResponse = PackSchemaDetail & {
  mode?: string;
  liveCheck?: ({ ok: true; source: string } & LiveClassBreakdown) | { ok: false; error: string };
  error?: string;
};

function LiveCheckLine({ check }: { check: NonNullable<SchemaResponse["liveCheck"]> }) {
  if (!check.ok) {
    return <div className="p-2.5 rounded-lg border border-white/[0.08] bg-white/[0.03] text-xs text-zinc-400">Live check unavailable: {check.error}</div>;
  }
  return (
    <div className="p-2.5 rounded-lg border border-white/[0.08] bg-white/[0.03] text-xs text-zinc-300 space-y-1">
      <p>
        Live check (COA describe_schema): {check.rawClassRows} class rows → {check.uniqueClasses} unique classes: {check.packClassesPresent}/
        {check.packClassesTotal} pack classes present, {check.metricClasses} governed-metric classes, {check.otherClasses.length} other
      </p>
      {check.packClassesMissing.length > 0 && <p className="text-zinc-400">Missing in COA: {check.packClassesMissing.join(", ")}</p>}
    </div>
  );
}

function SchemaModal({ vertical, onClose }: { vertical: Vertical; onClose: () => void }) {
  const [schema, setSchema] = useState<SchemaResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/schema?vertical=${encodeURIComponent(vertical)}`)
      .then(async (r) => {
        const body = (await r.json().catch(() => ({}))) as SchemaResponse;
        if (!r.ok) throw new Error(body.error ?? `Request failed (${r.status})`);
        if (!cancelled) setSchema(body);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [vertical]);

  const sharedNames = (schema?.sharedWith ?? [])
    .filter((v): v is Vertical => Object.prototype.hasOwnProperty.call(verticals, v))
    .map((v) => verticals[v].name);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-2xl mx-4 rounded-2xl border border-white/[0.08] bg-[#111118] shadow-2xl max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-white/[0.06] sticky top-0 bg-[#111118] z-10">
          <div>
            <h2 className="text-lg font-semibold text-white">{schema?.title ?? "Ontology schema"}</h2>
            {schema && <p className="text-xs text-zinc-500 mt-0.5">From {schema.source} — the ontology COA installs for this vertical</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-white/[0.06] text-zinc-400">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6 space-y-5">
          {!schema && !error && (
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading schema…
            </div>
          )}
          {error && <p className="text-sm text-red-400">Could not load the ontology: {error}</p>}
          {schema && (
            <>
              {sharedNames.length > 0 && (
                <div className="p-2.5 rounded-lg border border-white/[0.08] bg-white/[0.03] text-xs text-zinc-300">
                  Shared pack: also used by {sharedNames.join(", ")}
                </div>
              )}
              {schema.liveCheck && <LiveCheckLine check={schema.liveCheck} />}
              <div>
                <h3 className="text-xs uppercase tracking-wider text-zinc-500 font-medium mb-3">Classes ({schema.classes.length})</h3>
                <div className="space-y-2">
                  {schema.classes.map((c) => (
                    <div key={c.id} className="p-3 rounded-lg border border-white/[0.06] bg-white/[0.02]">
                      <div className="text-sm font-medium text-indigo-300">
                        {c.label} <span className="text-xs font-normal text-zinc-500 font-mono">({c.id})</span>
                        {c.subClassOf && <span className="text-xs font-normal text-zinc-500"> · subclass of {c.subClassOf}</span>}
                      </div>
                      {c.summary && <div className="text-xs text-zinc-400 mt-1">{c.summary}</div>}
                      {c.properties.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {c.properties.map((p) => (
                            <span key={p.id} className="px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06] text-[10px] text-zinc-400 font-mono">
                              {p.id}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="text-xs uppercase tracking-wider text-zinc-500 font-medium mb-3">Relationships ({schema.relationships.length})</h3>
                <div className="space-y-1.5">
                  {schema.relationships.map((r) => (
                    <div key={r.id} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-purple-300">{r.label}</span>
                      <span className="font-mono text-zinc-400">
                        {r.domain ?? "?"} → {r.range ?? "?"}
                      </span>
                      {r.transitive && <span className="px-1.5 py-0.5 rounded bg-cyan-950/30 border border-cyan-800/20 text-[10px] text-cyan-300">transitive</span>}
                      {r.inferred && <span className="px-1.5 py-0.5 rounded bg-amber-950/30 border border-amber-800/20 text-[10px] text-amber-300">inferred</span>}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="text-xs uppercase tracking-wider text-zinc-500 font-medium mb-3">Governed metrics ({schema.metrics.length})</h3>
                <div className="flex flex-wrap gap-2">
                  {schema.metrics.map((m) => (
                    <span key={m} className="px-2.5 py-1 rounded-md bg-purple-950/30 border border-purple-800/20 text-xs text-purple-300 font-mono">
                      {m}
                    </span>
                  ))}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-indigo-950/20 border border-indigo-800/20">
                <p className="text-xs text-indigo-300/80">
                  Classes and relationships come from the pack ontology; COA maps registered sources onto it. Nothing here is extracted by an LLM.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
