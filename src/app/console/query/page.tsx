"use client";
import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/store";
import { verticals } from "@/data/verticals";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Play, Zap, Database, ChevronDown, FileText, AlertTriangle } from "lucide-react";
import { AwsLogo } from "@/components/aws-logo";
import { Markdown } from "@/components/markdown";
import { HowItWorks } from "@/components/how-it-works";
import { AnswerFlow } from "@/components/answer-flow";

interface Citation { documentId: string; title: string; factCount: number; system?: string }
interface QueryResult {
  mode: string;
  answer?: string;
  sources?: number;
  latency: number;
  hops?: number;
  model?: string;
  backend?: string;
  note?: string;
  fallback?: boolean;
  citations?: Citation[];
  subgraph?: { nodeCount: number; edgeCount: number };
  entryNodes?: string[];
  /** Unit label for `sources` (e.g. "rows" for live SQL-backed answers). */
  sourcesUnit?: string;
  /** Plain-language description of how the answer was resolved. */
  pathDescription?: string;
}

interface ModelOption { id: string; label: string; provider: string; badge: string; color: string }

export default function QueryPage() {
  const { vertical } = useAppStore();
  const data = verticals[vertical];
  const [selectedQuery, setSelectedQuery] = useState(0);
  const [questionText, setQuestionText] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [showModels, setShowModels] = useState(false);
  const [running, setRunning] = useState(false);
  const [vectorRes, setVectorRes] = useState<QueryResult | null>(null);
  const [graphRes, setGraphRes] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vectorErr, setVectorErr] = useState(false);
  const [graphErr, setGraphErr] = useState(false);
  const [fidelity, setFidelity] = useState<string>("");
  const [coaVerticals, setCoaVerticals] = useState<string[]>([]);

  // Example questions are mode-aware. The vertical's presets are the story for
  // the local modes, whose seed graph they were written against. A Live COA
  // namespace can hold a different corpus, so a vertical may declare
  // `coaQueries` that its COA corpus can actually answer.
  const usingCoaQueries = fidelity === "coa" && Boolean(data.coaQueries?.length);
  const exampleQueries = usingCoaQueries && data.coaQueries ? data.coaQueries : data.queries;

  // Live COA is available only for verticals whose COA_NAMESPACE_<V> is set
  // (reported by GET /api/mode). Elsewhere a coa query would fail, so guard it
  // with a note instead of a raw error.
  const coaUnavailable = fidelity === "coa" && !coaVerticals.includes(vertical);
  const configuredNames = coaVerticals
    .filter((v): v is keyof typeof verticals => v in verticals)
    .map((v) => verticals[v].name);

  // Graph-panel counts. Live SQL-backed answers (sourcesUnit set, e.g. "rows")
  // report their own row count; everything else keeps the citations/docs logic.
  const graphCount = graphRes?.sourcesUnit
    ? (graphRes.sources ?? 0)
    : graphRes?.citations?.length ?? graphRes?.sources ?? (graphRes?.subgraph?.nodeCount ?? 0);
  const graphUnit = graphRes?.sourcesUnit ?? "docs";
  // When every citation comes from one system (e.g. tables of one registered
  // source), label them as tables in that system rather than "N systems".
  const graphCitations = graphRes?.citations;
  const oneSystem =
    Boolean(graphRes?.sourcesUnit) &&
    Boolean(graphCitations?.length) &&
    new Set(graphCitations!.map((c) => c.system)).size === 1 &&
    Boolean(graphCitations![0].system);

  // The question to run: the user's free text if they typed any, else the
  // selected preset. Presets are quick-starts; the text box lets you (or a
  // client) ask anything against the same live provider.
  const presetQuestion = exampleQueries[selectedQuery]?.question ?? "";
  const question = questionText.trim() || presetQuestion;
  const activeModel = models.find((m) => m.id === selectedModel);

  // Load the model registry (Gap 3). Falls back gracefully if the endpoint is absent.
  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((d) => {
        setModels(d.models ?? []);
        setSelectedModel(d.default ?? d.models?.[0]?.id ?? "");
      })
      .catch(() => setModels([]));
  }, []);

  // Track the active fidelity so example questions can match the mode's data.
  useEffect(() => {
    fetch("/api/mode")
      .then((r) => r.json())
      .then((d) => {
        setFidelity(d.fidelity ?? "");
        setCoaVerticals(Array.isArray(d.coaVerticals) ? d.coaVerticals : []);
      })
      .catch(() => {
        setFidelity("");
        setCoaVerticals([]);
      });
  }, []);

  const runQuery = async () => {
    if (coaUnavailable) return; // guarded — no COA namespace for this vertical
    setRunning(true);
    setError(null);
    setVectorErr(false);
    setGraphErr(false);
    setVectorRes(null);
    setGraphRes(null);
    try {
      const body = (mode: string) => ({
        vertical,
        query: question,
        mode,
        model: selectedModel,
      });
      const [v, g] = await Promise.all([
        fetch("/api/query", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body("vector")) }).then((r) => r.json()),
        fetch("/api/query", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body("graph")) }).then((r) => r.json()),
      ]);
      if (v.error || g.error) setError(v.error || g.error);
      setVectorErr(Boolean(v.error));
      setGraphErr(Boolean(g.error));
      setVectorRes(v);
      setGraphRes(g);
    } catch (e: unknown) {
      setError((e as Error).message);
      setVectorErr(true);
      setGraphErr(true);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Query Playground</h1>
        <p className="text-sm text-zinc-400 mt-0.5">{data.name} — live retrieval comparison (vector vs graph)</p>
      </div>

      {/* Mode-aware explainer: what's stored, how an answer is formed, why it's
          trustworthy. After a query, the source cards light/dim by real usage. */}
      <HowItWorks
        vertical={vertical}
        fidelity={fidelity}
        vectorUsed={vectorRes ? Boolean(vectorRes.answer) && (vectorRes.sources ?? 0) > 0 : null}
        graphUsed={graphRes ? Boolean(graphRes.answer) : null}
      />

      {/* Query selector */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 md:p-5 space-y-4">
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500 mr-1">Example questions:</span>
          {exampleQueries.map((query, i) => (
            <button key={i} title={query.question}
              onClick={() => { setSelectedQuery(i); setQuestionText(query.question); setVectorRes(null); setGraphRes(null); }}
              className={cn("px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all",
                (questionText.trim() ? questionText.trim() === query.question : selectedQuery === i) ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-900/20" : "bg-white/[0.04] text-zinc-500 hover:text-zinc-300 border border-white/[0.06]")}>
              Example {i + 1}
            </button>
          ))}
          {usingCoaQueries && (
            <span className="text-[10px] text-zinc-600 ml-1">· tuned for the Live COA corpus</span>
          )}
        </div>
        {/* Editable question box — ask anything, or click an example above to fill it. */}
        <div className="rounded-lg border border-white/[0.08] bg-black/30 focus-within:border-indigo-500/40 transition-colors">
          <textarea
            value={question}
            onChange={(e) => { setQuestionText(e.target.value); }}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !running) runQuery(); }}
            rows={2}
            placeholder={`Ask a question — e.g. ${data.queries[0]?.question ?? ""}`}
            className="w-full bg-transparent px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 resize-y outline-none leading-relaxed"
          />
          <div className="flex items-center justify-between px-4 py-1.5 border-t border-white/[0.05]">
            <span className="text-[10px] text-zinc-600">Type your own question, or pick an example. {activeModel ? "" : ""}</span>
            <span className="text-[10px] text-zinc-600">⌘/Ctrl + Enter to run</span>
          </div>
        </div>
        {/* Model selector (Gap 3) */}
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <div className="relative">
            <button onClick={() => setShowModels(!showModels)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.05] text-sm transition-colors min-w-[220px] justify-between">
              <div className="flex items-center gap-2">
                <span className="text-zinc-300">{activeModel?.label ?? "Loading models…"}</span>
                {activeModel && <span className="text-[10px] text-zinc-500">{activeModel.provider}</span>}
              </div>
              <ChevronDown className={cn("w-3.5 h-3.5 text-zinc-500 transition-transform", showModels && "rotate-180")} />
            </button>
            {showModels && models.length > 0 && (
              <div className="absolute top-full left-0 mt-1 w-72 rounded-xl border border-white/[0.08] bg-[#111118] shadow-2xl z-10 py-1 overflow-hidden">
                <div className="px-3 py-1.5 border-b border-white/[0.06] flex items-center gap-2">
                  <AwsLogo className="h-3" />
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500">Generation Model — via Amazon Bedrock</p>
                </div>
                {models.map((m) => (
                  <button key={m.id} onClick={() => { setSelectedModel(m.id); setShowModels(false); }}
                    className={cn("w-full flex items-center justify-between px-3 py-2 text-left hover:bg-white/[0.04] transition-colors",
                      selectedModel === m.id && "bg-indigo-950/30")}>
                    <div>
                      <span className={cn("text-sm", selectedModel === m.id ? "text-white" : "text-zinc-300")}>{m.label}</span>
                      <span className="text-[10px] text-zinc-600 ml-2">{m.provider}</span>
                    </div>
                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded", m.color, "bg-white/[0.03]")}>{m.badge}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={runQuery} disabled={running || !question.trim() || coaUnavailable}
            className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-40 text-white rounded-lg text-sm font-medium shadow-lg shadow-indigo-900/30 transition-all">
            {running ? <><Zap className="w-4 h-4 animate-pulse" /> Running...</> : <><Play className="w-4 h-4" /> Run Query</>}
          </button>
        </div>
        {coaUnavailable && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-950/10 px-3 py-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-200/90 leading-snug">
              <span className="font-medium">Live COA isn&apos;t configured for {data.name}.</span>{" "}
              Configured verticals: <span className="font-medium">{configuredNames.length ? configuredNames.join(", ") : "none"}</span>.
              Set <code className="text-amber-100">COA_NAMESPACE_{vertical.toUpperCase()}</code> to this vertical&apos;s COA namespace, switch to a configured vertical (top-right), or use{" "}
              <span className="font-medium">Demo</span> / <span className="font-medium">Local Ontology</span> mode for this vertical.
            </p>
          </div>
        )}
        {error && !coaUnavailable && <p className="text-xs text-red-400">Error: {error}</p>}
      </div>

      {/* Live pipeline: flowing indicators while running; check/X per path after.
          A path "contributed" if it produced an answer — graph reports its work
          via subgraph/answer, not always a `sources` count, so we key off the
          answer text (+ any source/subgraph signal) rather than sources alone. */}
      {(running || vectorRes || graphRes) && (
        <AnswerFlow
          running={running}
          vector={{
            hasResult: Boolean(vectorRes),
            count: vectorRes?.sources ?? 0,
            unit: "chunks",
            contributed: Boolean(vectorRes?.answer) && (vectorRes?.sources ?? 0) > 0,
            errored: vectorErr,
            backend: vectorRes?.model || vectorRes?.backend,
          }}
          graph={{
            hasResult: Boolean(graphRes),
            count: graphCount,
            unit: graphUnit,
            contributed: Boolean(graphRes?.answer) && !graphErr,
            errored: graphErr,
            backend: graphRes?.backend,
          }}
        />
      )}

      {/* Results */}
      {(vectorRes || graphRes) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Vector result */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] bg-white/[0.01]">
              <div className="flex items-center gap-2"><Database className="w-3.5 h-3.5 text-zinc-400" /><span className="text-sm font-medium text-zinc-300">Vector RAG</span></div>
              <Badge className="bg-white/[0.05] text-zinc-400 border border-white/[0.08] text-[10px]">{vectorRes?.backend ?? "vector"}</Badge>
            </div>
            <div className="p-4 space-y-3">
              <div className="bg-black/20 rounded-lg p-4 text-zinc-400 leading-relaxed border border-white/[0.04] max-h-[520px] overflow-y-auto">
                {vectorRes?.answer ? (
                  <Markdown content={vectorRes.answer} accent="zinc" />
                ) : vectorErr ? (
                  // Red only for a real /api/query error.
                  <span className="text-sm text-red-400/80">✕ No vector chunks matched — this path did not contribute to the answer.</span>
                ) : vectorRes ? (
                  // Empty or timed-out search is a normal outcome — say so neutrally.
                  <span className="text-sm text-zinc-500">
                    {vectorRes.note ?? "No matching document chunks for this question — the answer comes from GraphRAG."}
                  </span>
                ) : (
                  <span className="text-sm text-zinc-600">—</span>
                )}
              </div>
              <p className="text-[11px] text-zinc-500 leading-snug">
                Found the most <span className="text-zinc-300">similar text chunks</span> by embedding your question and
                ranking by cosine similarity. Fast, but single-source — it can miss facts that only emerge by connecting documents.
              </p>
              <div className="flex gap-4 text-xs text-zinc-600">
                <span>Sources: <span className="text-zinc-400">{vectorRes?.sources ?? 0} chunks</span></span>
                <span>Latency: <span className="text-zinc-400">{vectorRes?.latency ?? 0}ms</span></span>
                {vectorRes?.model && <span>Embed: <span className="text-zinc-400">{vectorRes.model}</span></span>}
              </div>

              {/* Source documents — the retrieved chunks' origin docs, by filename. */}
              {vectorRes?.citations && vectorRes.citations.length > 0 && (
                <div className="pt-2 border-t border-white/[0.06]">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">Source documents ({vectorRes.citations.length})</p>
                  <div className="space-y-1">
                    {vectorRes.citations.map((c, i) => {
                      const isUrl = /^https?:\/\//.test(c.documentId);
                      return (
                        <div key={`${c.documentId}-${i}`} className="flex items-center gap-2 text-xs">
                          <FileText className="w-3 h-3 text-zinc-500 shrink-0" />
                          {isUrl ? (
                            <a href={c.documentId} target="_blank" rel="noopener noreferrer" className="text-zinc-300 hover:text-indigo-300 truncate underline decoration-white/20 underline-offset-2">{c.title}</a>
                          ) : (
                            <span className="text-zinc-300 truncate">{c.title}</span>
                          )}
                          <span className="text-[10px] text-zinc-600 shrink-0">{c.factCount}% match</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* GraphRAG result */}
          <div className="rounded-xl border border-indigo-500/20 bg-gradient-to-br from-indigo-950/20 to-purple-950/10 overflow-hidden shadow-lg shadow-indigo-900/5">
            <div className="flex items-center justify-between px-4 py-3 border-b border-indigo-500/10 bg-indigo-950/20">
              <div className="flex items-center gap-2"><Zap className="w-3.5 h-3.5 text-indigo-400" /><span className="text-sm font-medium text-indigo-200">GraphRAG</span></div>
              <Badge className="bg-indigo-950/50 text-indigo-300 border border-indigo-700/30 text-[10px]">{graphRes?.backend ?? "graph"}</Badge>
            </div>
            <div className="p-4 space-y-3">
              {/* When COA's graph synthesis times out we fall back to vector over
                  the same corpus. Label it clearly so it never looks like a
                  silent duplicate of the Vector panel. */}
              {graphRes?.fallback && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-950/10 px-3 py-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-200/90 leading-snug">
                    <span className="font-medium">Graph synthesis is taking longer than usual.</span>{" "}
                    Showing retrieved evidence from the same corpus meanwhile — click <span className="font-medium">Run Query</span> again for the full graph-synthesized answer.
                  </p>
                </div>
              )}
              <div className="bg-black/20 rounded-lg p-4 text-zinc-200 leading-relaxed border border-indigo-500/10 max-h-[520px] overflow-y-auto">
                {graphRes?.answer ? <Markdown content={graphRes.answer} accent="indigo" /> : <span className="text-sm text-zinc-400">{graphRes?.note ?? "—"}</span>}
              </div>
              {/* Reasoning-path chip — graph-native annotation (the analogue of
                  Vector's match %): how far the traversal reached. */}
              {graphRes?.answer && (graphRes?.subgraph || typeof graphRes?.hops === "number" || (graphRes?.citations?.length ?? 0) > 0) && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500 mr-0.5">Reasoning path:</span>
                  {typeof graphRes?.hops === "number" && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">{graphRes.hops} hops</span>
                  )}
                  {graphRes?.subgraph && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">{graphRes.subgraph.nodeCount} entities</span>
                  )}
                  {graphRes?.subgraph && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">{graphRes.subgraph.edgeCount} relationships</span>
                  )}
                  {(graphRes?.citations?.length ?? 0) > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">{graphRes!.citations!.length} {oneSystem ? "tables" : "systems"}</span>
                  )}
                </div>
              )}
              {graphRes?.pathDescription ? (
                <p className="text-[11px] text-indigo-300/70 leading-snug">{graphRes.pathDescription}</p>
              ) : (
                <p className="text-[11px] text-indigo-300/70 leading-snug">
                  Walked the knowledge graph from the entities in your question
                  {graphRes?.subgraph ? <> — reaching <span className="text-indigo-200">{graphRes.subgraph.nodeCount} connected entities</span> over <span className="text-indigo-200">{graphRes.subgraph.edgeCount} relationships</span></> : null}
                  {typeof graphRes?.hops === "number" ? <> in <span className="text-indigo-200">{graphRes.hops} hops</span></> : null}. This stitches facts across documents that a text search would miss.
                </p>
              )}
              <div className="flex flex-wrap gap-3 text-xs text-zinc-600">
                <span>Sources: <span className="text-indigo-300">{graphRes?.sourcesUnit ? (graphRes.sources ?? 0) : graphRes?.citations?.length ?? graphRes?.sources ?? 0} {graphUnit}</span></span>
                {graphRes?.subgraph && <span>Subgraph: <span className="text-indigo-300">{graphRes.subgraph.nodeCount}n / {graphRes.subgraph.edgeCount}e</span></span>}
                {typeof graphRes?.hops === "number" && <span>Hops: <span className="text-indigo-300">{graphRes.hops}</span></span>}
                <span>Latency: <span className="text-indigo-300">{graphRes?.latency ?? 0}ms</span></span>
                {activeModel && <span>Model: <span className="text-indigo-300">{activeModel.label}</span></span>}
              </div>

              {/* Sources stitched across systems — the visible proof that a graph
                  answer correlates evidence from separate systems of record
                  (SAP Ariba, LIMS, Salesforce, …), not one document. */}
              {graphRes?.citations && graphRes.citations.length > 0 && (
                <div className="pt-2 border-t border-indigo-500/10">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">
                    {oneSystem
                      ? `Evidence from ${graphRes.citations.length} table${graphRes.citations.length > 1 ? "s" : ""} in ${graphRes.citations[0].system}`
                      : `Evidence stitched across ${graphRes.citations.length} source system${graphRes.citations.length > 1 ? "s" : ""}`}
                  </p>
                  <div className="space-y-1">
                    {graphRes.citations.map((c, i) => (
                      <div key={c.documentId} className="flex items-center gap-2 text-xs">
                        <span className="text-[10px] text-indigo-400/60 tabular-nums shrink-0">{i + 1}.</span>
                        <FileText className="w-3 h-3 text-indigo-400/70 shrink-0" />
                        <span className="text-zinc-300 truncate">{c.title}</span>
                        {c.system && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 shrink-0">{c.system}</span>
                        )}
                        <span className="text-[10px] text-zinc-600 shrink-0">
                          {graphRes.sourcesUnit === "rows"
                            ? `${c.factCount} row${c.factCount === 1 ? "" : "s"}`
                            : `${c.factCount} fact${c.factCount > 1 ? "s" : ""}`}
                        </span>
                      </div>
                    ))}
                  </div>
                  {/* Row-backed answers cite real source tables, so no synthetic-source disclaimer. */}
                  {graphRes.sourcesUnit !== "rows" && (
                    <p className="text-[10px] text-zinc-600 mt-1.5 leading-snug">
                      In production these resolve to your live systems of record; here they map to the demo&apos;s synthetic sources.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
