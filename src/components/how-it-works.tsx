"use client";
/**
 * HowItWorks — a mode-aware explainer for the Query Playground.
 *
 * Makes the page self-documenting: what data is stored, how a question becomes
 * an answer, the distinct role of Vector vs Graph retrieval, and why the answer
 * is grounded (no hallucination). The content adapts to the active fidelity so a
 * viewer always sees the pipeline that actually produced the answer they're
 * looking at.
 */
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { verticals, type Vertical } from "@/data/verticals";
import {
  ChevronDown,
  FileText,
  Database,
  Share2,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Play,
  Check,
  X,
} from "lucide-react";

type Fidelity = "mock" | "ontology" | "coa" | string;

/** Whether a stored source is actually used to form answers in THIS mode. */
type StoreStatus =
  | "active" // real backend, actively queried
  | "simulated" // faked for the demo (no real backend)
  | "empty"; // real backend but no data until you ingest

interface StoreItem {
  label: string;
  detail: string;
  /** Hover explanation — how this store is used to form answers in THIS mode. */
  tip: string;
  /** Which retrieval path this store feeds. */
  kind: "graph" | "vector";
  status: StoreStatus;
}

interface ModeCopy {
  name: string;
  tagline: string;
  stored: StoreItem[];
  vector: string;
  graph: string;
  grounding: string;
}

/** Mode copy for one vertical; store details come from the vertical's entity types. */
function modeCopy(vertical: Vertical): Record<string, ModeCopy> {
  const types = verticals[vertical].entityTypes.slice(0, 5).join(", ");
  return {
    mock: {
      name: "Mode 1 · Demo data",
      tagline: "Curated seed graph in local SQLite — boots in seconds, no AWS.",
      stored: [
        { label: "Graph", kind: "graph", status: "active", detail: `Curated nodes + edges (${types}) in SQLite`, tip: "USED: GraphRAG walks these curated SQLite edges (BFS up to 4 hops) to build the connected-facts answer." },
        { label: "Documents", kind: "vector", status: "simulated", detail: "Seed documents metadata; vector chunks simulated", tip: "SIMULATED: demo mode fakes the vector/OpenSearch step so it runs with no AWS. Returns a canned similar-chunks response." },
      ],
      vector: "Returns a few similar text chunks (simulated OpenSearch) — shallow, single-source.",
      graph: "Walks the seed graph from the entities in your question (BFS, up to 4 hops) to find *connected* facts.",
      grounding: "Every fact comes from the seed graph — the model only rewords what the traversal returned.",
    },
    ontology: {
      name: "Mode 2 · Local Ontology",
      tagline: "Real OWL reasoning + real local vector retrieval — still no AWS.",
      stored: [
        { label: "Graph", kind: "graph", status: "active", detail: `Same SQLite graph (${types}), now typed by the vertical's pack OWL ontology (classes, relations, governed metrics)`, tip: "USED: GraphRAG reasons over the OWL-typed graph using the pack's typed relationships — no AWS needed." },
        { label: "Vectors", kind: "vector", status: "empty", detail: "Real local embeddings (256-dim hashing) with cosine kNN — empty until you ingest documents", tip: "REAL BUT EMPTY: Vector RAG runs real cosine kNN, but there are no chunks until you ingest documents — so it returns nothing here." },
      ],
      vector: "Real cosine kNN over locally-embedded chunks. Honestly returns nothing until documents are ingested.",
      graph: "Ontology-typed traversal: follows the pack's typed relationships across the graph.",
      grounding: "Answer is synthesized only from ontology-typed graph facts; the model articulates, it doesn't invent.",
    },
    coa: {
      name: "Mode 3 · Live COA",
      tagline: "Real Context Ontology Accelerator in your AWS account — Neptune + OpenSearch.",
      stored: [
        { label: "Graph", kind: "graph", status: "active", detail: "Amazon Neptune — entities and relationships mapped over this vertical's registered COA sources", tip: "USED: GraphRAG runs COA's tiered resolution (governed metric → SPARQL) over the real Neptune graph in your AWS account." },
        { label: "Vectors", kind: "vector", status: "active", detail: "Amazon OpenSearch Serverless — Bedrock embeddings of documents ingested into the namespace's DOCUMENTS sources", tip: "USED: Bedrock embeds your question, then OpenSearch Serverless returns the most similar real document chunks." },
      ],
      vector: "Bedrock embeds your question → OpenSearch kNN returns the most similar document chunks.",
      graph: "COA tiered resolution: governed metric → SPARQL over the Neptune graph → agentic synthesis.",
      grounding: "Grounded strictly in retrieved graph + chunks from your account. If it's not in the data, it says so.",
    },
  };
}

// Phases: 0 question · 1 flow→retrieve · 2 retrieve · 3 flow→synthesize ·
//         4 synthesize · 5 DONE (everything settled with checks)
const DONE = 5;

export function HowItWorks({
  vertical,
  fidelity,
  vectorUsed = null,
  graphUsed = null,
}: {
  vertical: Vertical;
  fidelity: Fidelity;
  /** After a real query: did the Vector path contribute? null = not run yet. */
  vectorUsed?: boolean | null;
  /** After a real query: did the Graph path contribute? null = not run yet. */
  graphUsed?: boolean | null;
}) {
  const [open, setOpen] = useState(false);
  const allCopy = modeCopy(vertical);
  const copy = allCopy[fidelity] ?? allCopy.mock;
  const example = verticals[vertical].queries[0]?.question;

  // Did ANY path contribute? null = no query yet (neutral flow), true = grounded,
  // false = neither path returned data (flow shows honest "no grounding").
  const anyUsed: boolean | null =
    vectorUsed === null && graphUsed === null ? null : Boolean(vectorUsed) || Boolean(graphUsed);

  // Mode caveat for the Vector path (shown before a query runs): in this mode is
  // the vector store simulated, or real-but-empty? Graph is "active" in all modes.
  const vectorStore = copy.stored.find((s) => s.kind === "vector");
  const vectorCaveat =
    vectorStore?.status === "simulated"
      ? "simulated in this mode"
      : vectorStore?.status === "empty"
      ? "empty until you ingest"
      : null;

  // Sequenced pipeline animation. Auto-plays once when first expanded; replayable.
  const [phase, setPhase] = useState(DONE); // start settled so re-open shows final state
  const [playing, setPlaying] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  const play = () => {
    clearTimers();
    setPlaying(true);
    setPhase(0);
    // Advance through phases 1..5(DONE). The final tick settles everything.
    const stepMs = 650;
    for (let i = 1; i <= DONE; i++) {
      timers.current.push(setTimeout(() => {
        setPhase(i);
        if (i === DONE) setPlaying(false);
      }, stepMs * i));
    }
  };

  // Auto-play the first time the panel opens.
  const autoPlayed = useRef(false);
  useEffect(() => {
    if (open && !autoPlayed.current) { autoPlayed.current = true; play(); }
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
          <span className="text-sm font-medium text-zinc-200">How answers are formed</span>
          <span className="text-[10px] text-zinc-500 hidden sm:inline">· {copy.name}</span>
        </div>
        <ChevronDown className={cn("w-4 h-4 text-zinc-500 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-white/[0.06] pt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-zinc-400">{copy.tagline}</p>
            <button
              onClick={play}
              disabled={playing}
              className="flex items-center gap-1.5 shrink-0 px-2.5 py-1 rounded-md border border-white/[0.1] bg-white/[0.03] hover:bg-white/[0.06] disabled:opacity-50 text-[11px] text-zinc-300 transition-colors"
            >
              <Play className="w-3 h-3" /> {playing ? "Playing…" : "Replay animation"}
            </button>
          </div>

          {/* The pipeline, left to right — animates through the phases. The
              Retrieve + Synthesize steps reflect REAL usage once a query runs:
              nothing retrieved → they show a muted "no grounding" state instead
              of a green check, so the flow matches the source cards below. */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1.2fr_auto_1fr] gap-2 md:gap-0 items-stretch">
            <FlowStep
              index={0} phase={phase}
              icon={<FileText className="w-4 h-4" />}
              title="1 · Your question"
              body="Free text, or pick an example. The same question runs both retrieval paths."
            />
            <FlowArrow active={phase >= 1} />
            <FlowStep
              index={2} phase={phase} accent
              icon={<Database className="w-4 h-4" />}
              title="2 · Retrieve"
              body={
                anyUsed === false
                  ? "Neither path found matching data for this question."
                  : "Two ways in parallel: Vector finds similar text; Graph finds connected facts."
              }
              grounded={anyUsed}
            />
            <FlowArrow active={phase >= 3} />
            <FlowStep
              index={4} phase={phase}
              icon={<Sparkles className="w-4 h-4" />}
              title="3 · Synthesize"
              body={
                anyUsed === false
                  ? "No grounding retrieved — the model reports it can't answer rather than guessing."
                  : "A model (via Bedrock) writes the answer using ONLY what was retrieved."
              }
              grounded={anyUsed}
            />
          </div>

          {/* What's stored — reveals as the pipeline reaches "retrieve" (phase >= 2). */}
          <div className={cn("transition-opacity duration-500", phase >= 2 ? "opacity-100" : "opacity-40")}>
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">What&apos;s stored in this mode</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {copy.stored.map((s) => (
                <StoredCard key={s.label} item={s} />
              ))}
            </div>
          </div>

          {/* Vector vs Graph — before a query, they hint at mode usage (e.g. a
              simulated/empty vector path shows a caveat); after a query they
              reflect ACTUAL contribution. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <SourceCard
              icon={<Database className="w-3.5 h-3.5" />}
              title="Vector RAG"
              body={copy.vector}
              phase={phase}
              used={vectorUsed}
              caveat={vectorCaveat}
            />
            <SourceCard
              icon={<Share2 className="w-3.5 h-3.5" />}
              title="GraphRAG"
              body={copy.graph}
              phase={phase}
              used={graphUsed}
              accent
            />
          </div>

          {/* Mode comparison — why the same question answers differently across
              the three fidelities. The active mode is highlighted. */}
          <div>
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">Three fidelities · why answers differ</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <ModeCompareCard active={fidelity === "mock"} title="Mode 1 · Demo" backend="Local SQLite (seed)" note="Curated graph; vector is simulated. Instant, no AWS. Great to see the shape of an answer." />
              <ModeCompareCard active={fidelity === "ontology"} title="Mode 2 · Local Ontology" backend="SQLite + OWL · local embeddings" note="Real ontology reasoning + real local vectors. Still no AWS. Honest empty-vector until you ingest." />
              <ModeCompareCard active={fidelity === "coa"} title="Mode 3 · Live COA" backend="Neptune + OpenSearch (your AWS)" note="Real Context Ontology Accelerator over real ingested data. This is production fidelity." accent />
            </div>
            <p className="text-[10px] text-zinc-600 mt-1.5 leading-snug">
              Same question, same UI — only the <span className="text-zinc-400">fidelity of the data and backends</span> changes. That&apos;s why Mode 1/2 answer from the local seed story{example ? <> (for example &ldquo;{example}&rdquo;)</> : null}, while Mode 3 answers from the sources registered in your COA namespace.
            </p>
          </div>

          {/* Grounding / no-hallucination */}
          <div className="flex items-start gap-2 rounded-lg border border-emerald-500/15 bg-emerald-950/10 px-3 py-2.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <span className="text-xs font-medium text-emerald-200">Why you can trust the answer</span>
              <p className="text-[11px] text-zinc-400 mt-0.5 leading-snug">{copy.grounding}</p>
            </div>
          </div>

          <p className="text-[10px] text-zinc-600 leading-snug">
            Tip: ask anything in the box, or use an example. There&apos;s no limit — each run does one Vector and one Graph
            retrieval so you can compare. Switch modes with the badge (top-left) to see the same question answered at a
            different fidelity.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * A pipeline step that reacts to the animation phase:
 *  - active  (phase === index): highlighted + pulsing — "happening now"
 *  - done    (phase >  index): settled highlight with a check
 *  - pending (phase <  index): dimmed, waiting
 */
function FlowStep({
  index,
  phase,
  icon,
  title,
  body,
  accent,
  grounded = null,
}: {
  index: number;
  phase: number;
  icon: React.ReactNode;
  title: string;
  body: string;
  accent?: boolean;
  /** For Retrieve/Synthesize: false = no data retrieved → muted "no grounding". */
  grounded?: boolean | null;
}) {
  const active = phase === index;
  const doneRaw = phase > index;
  // When a query ran and retrieved nothing, the "done" state is a muted amber
  // "no grounding" rather than a confident green/indigo check.
  const noGrounding = doneRaw && grounded === false;
  const done = doneRaw && !noGrounding;
  return (
    <div
      className={cn(
        "relative rounded-lg border px-3 py-2.5 transition-all duration-300 h-full",
        active && (accent ? "border-indigo-400/70 bg-indigo-950/30 shadow-lg shadow-indigo-900/20 scale-[1.02]" : "border-zinc-400/60 bg-white/[0.06] shadow-lg scale-[1.02]"),
        done && (accent ? "border-indigo-500/30 bg-indigo-950/15" : "border-emerald-500/25 bg-emerald-950/[0.08]"),
        noGrounding && "border-amber-500/30 bg-amber-950/[0.08]",
        !active && !doneRaw && "border-white/[0.06] bg-black/20 opacity-50"
      )}
    >
      <div className={cn("flex items-center gap-1.5 mb-1",
        active ? (accent ? "text-indigo-200" : "text-white")
        : noGrounding ? "text-amber-200/90"
        : done ? (accent ? "text-indigo-300" : "text-emerald-200/90")
        : "text-zinc-400")}>
        <span className={cn(active && "animate-pulse")}>{icon}</span>
        <span className="text-xs font-medium">{title}</span>
        {done && <Check className={cn("w-3.5 h-3.5 ml-auto", accent ? "text-indigo-400" : "text-emerald-400")} />}
        {noGrounding && <span className="ml-auto text-[10px] text-amber-300/80">no grounding</span>}
        {active && <span className="ml-auto h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin opacity-70" />}
      </div>
      <p className="text-[11px] text-zinc-500 leading-snug">{body}</p>
    </div>
  );
}

/**
 * A retrieval-source card (Vector / Graph). These sit directly under the
 * "Retrieve" step and share its visual language:
 *  - used  === true  → LIT (indigo, like the Retrieve step) + "used to answer"
 *  - used  === false → DIMMED grey + a quiet "not used" (normal, not an error)
 *  - used  === null  → neutral (no query yet); reveals during the animation
 */
function SourceCard({
  icon,
  title,
  body,
  phase,
  used,
  accent,
  caveat = null,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  phase: number;
  used: boolean | null;
  accent?: boolean;
  /** Mode caveat shown before a query runs, e.g. "simulated in this mode". */
  caveat?: string | null;
}) {
  const revealed = phase >= 2; // appears once retrieval starts in the animation
  const decided = used !== null;
  // Before a query: if this path is simulated/empty in the mode, treat it as
  // visually "not fully active" so it's clear it won't ground a real answer.
  const modeMuted = !decided && caveat !== null;
  const tip = decided
    ? `${body} ${used ? "→ This path contributed to the current answer." : "→ Returned nothing for this question, so it was not used."}`
    : caveat
    ? `${body} → ${caveat}.`
    : body;

  return (
    <div
      title={tip}
      className={cn(
        "rounded-lg border px-3 py-2.5 transition-all duration-500 cursor-help",
        !revealed && "opacity-40",
        // Used → lit in the same indigo as the Retrieve step above.
        decided && used && "border-indigo-400/50 bg-indigo-950/25 shadow-md shadow-indigo-900/10",
        // Not used → simply dimmed grey (not-used is normal, not an error/red).
        decided && !used && "border-white/[0.06] bg-black/20 opacity-45",
        // Before a query: mode-muted (simulated/empty) → dimmed; active → normal.
        !decided && modeMuted && "border-white/[0.06] bg-black/20 opacity-55",
        !decided && !modeMuted && (accent ? "border-indigo-500/20 bg-indigo-950/20" : "border-white/[0.06] bg-black/20")
      )}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className={cn(decided && used ? "text-indigo-300" : decided && !used ? "text-zinc-500" : accent ? "text-indigo-300" : "text-zinc-400")}>{icon}</span>
        <span className={cn("text-xs font-medium", decided && !used ? "text-zinc-400" : accent ? "text-indigo-200" : "text-zinc-300")}>{title}</span>
        {decided && used && (
          <span className="ml-auto flex items-center gap-1 text-indigo-300 text-[10px] font-medium"><Check className="w-3.5 h-3.5" /> used to answer</span>
        )}
        {decided && !used && (
          <span className="ml-auto flex items-center gap-1 text-zinc-500 text-[10px]"><X className="w-3 h-3" /> not used</span>
        )}
        {!decided && caveat && (
          <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 whitespace-nowrap">{caveat}</span>
        )}
      </div>
      <p className={cn("text-[11px] leading-snug", decided && !used ? "text-zinc-600" : accent ? "text-zinc-400" : "text-zinc-500")}>{body}</p>
    </div>
  );
}

/**
 * A "What's stored" card that shows whether the store is actually used in this
 * mode. active → lit + "used"; simulated → amber "simulated"; empty → grey
 * "empty · needs ingest". Dimmed when not truly contributing.
 */
function StoredCard({ item }: { item: StoreItem }) {
  const { label, detail, tip, kind, status } = item;
  const active = status === "active";
  const Icon = kind === "graph" ? Share2 : Database;

  const badge =
    status === "active"
      ? { text: "used", cls: "bg-indigo-500/20 text-indigo-300" }
      : status === "simulated"
      ? { text: "simulated", cls: "bg-amber-500/15 text-amber-300" }
      : { text: "empty · needs ingest", cls: "bg-zinc-500/15 text-zinc-400" };

  return (
    <div
      title={tip}
      className={cn(
        "rounded-lg border px-3 py-2 cursor-help transition-all",
        active
          ? "border-indigo-400/40 bg-indigo-950/20"
          : "border-white/[0.06] bg-black/20 opacity-55"
      )}
    >
      <div className="flex items-center gap-1.5">
        <Icon className={cn("w-3.5 h-3.5", active ? "text-indigo-300" : "text-zinc-500")} />
        <span className={cn("text-xs font-medium", active ? "text-zinc-100" : "text-zinc-300")}>{label}</span>
        <span className={cn("ml-auto text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap", badge.cls)}>{badge.text}</span>
      </div>
      <p className="text-[11px] text-zinc-500 mt-0.5 leading-snug">{detail}</p>
    </div>
  );
}

/** One of the three fidelity cards; the active mode is highlighted + labelled. */
function ModeCompareCard({
  active,
  title,
  backend,
  note,
  accent,
}: {
  active: boolean;
  title: string;
  backend: string;
  note: string;
  accent?: boolean;
}) {
  return (
    <div
      title={note}
      className={cn(
        "rounded-lg border px-3 py-2 cursor-help transition-all",
        active
          ? (accent ? "border-indigo-400/60 bg-indigo-950/30 shadow-md shadow-indigo-900/10" : "border-zinc-300/40 bg-white/[0.06]")
          : "border-white/[0.06] bg-black/20 opacity-60"
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span className={cn("text-xs font-medium", active ? (accent ? "text-indigo-100" : "text-white") : "text-zinc-300")}>{title}</span>
        {active && <span className={cn("text-[9px] px-1.5 py-0.5 rounded", accent ? "bg-indigo-500/20 text-indigo-300" : "bg-white/10 text-zinc-300")}>active</span>}
      </div>
      <p className="text-[10px] text-zinc-500 mt-1">{backend}</p>
      <p className="text-[10px] text-zinc-600 mt-1 leading-snug">{note}</p>
    </div>
  );
}

/** Connector between steps: shows flowing dots while its phase is active/passed. */
function FlowArrow({ active }: { active: boolean }) {
  return (
    <div className="hidden md:flex items-center justify-center relative w-8 mx-0.5 text-zinc-600">
      <div className={cn("relative h-px w-full transition-colors duration-300", active ? "bg-indigo-400/50" : "bg-white/[0.12]")}>
        {active && <span className="absolute top-1/2 -translate-y-1/2 left-0 h-1.5 w-1.5 rounded-full bg-indigo-400 animate-flow-dot" />}
      </div>
      <ArrowRight className={cn("w-4 h-4 absolute -right-1 transition-colors duration-300", active ? "text-indigo-400" : "text-zinc-600")} />
    </div>
  );
}
