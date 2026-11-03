"use client";
import { useAppStore } from "@/lib/store";
import { verticals, type Vertical } from "@/data/verticals";
import { useFidelity } from "@/lib/use-fidelity";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, MutableRefObject } from "react";
import type { ForceGraphMethods, ForceGraphProps, NodeObject, LinkObject } from "react-force-graph-2d";
import { Search, RotateCcw } from "lucide-react";
import { AwsLogo } from "@/components/aws-logo";

interface GNode {
  id: string;
  label: string;
  type: string;
  color: string;
  connections: number;
}
interface GLink {
  source: string;
  target: string;
  label?: string;
}
type GraphOrigin = "seed" | "config";
interface LoadedGraph {
  vertical: Vertical;
  origin: GraphOrigin;
  nodes: GNode[];
  links: GLink[];
}
/** Shape of GET /api/graph?action=full (edges carry source_id/target_id; tolerate source/target too). */
interface ApiGraph {
  nodes?: { id: string; label?: string; type?: string }[];
  edges?: { source_id?: string; target_id?: string; source?: string; target?: string; relation?: string }[];
}
type FgNode = NodeObject<GNode>;
type FgLink = LinkObject<GNode, GLink>;
type FgRef = ForceGraphMethods<FgNode, FgLink>;

// next/dynamic drops the component's generics, so re-apply them for our node type.
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false }) as unknown as ComponentType<
  ForceGraphProps<FgNode, FgLink> & { ref?: MutableRefObject<FgRef | undefined> }
>;

// Fallback colours for any entity type missing from verticals[v].graphColors.
const PALETTE = ["#6366f1", "#ef4444", "#10b981", "#f59e0b", "#06b6d4", "#ec4899", "#8b5cf6", "#3b82f6", "#a855f7", "#14b8a6", "#eab308", "#f43f5e"];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function colorFor(vertical: Vertical, type: string): string {
  const cfg = verticals[vertical];
  const mapped = (cfg.graphColors as Record<string, string>)[type];
  if (mapped) return mapped;
  const idx = (cfg.entityTypes as readonly string[]).indexOf(type);
  return PALETTE[(idx >= 0 ? idx : hash(type)) % PALETTE.length];
}

function build(vertical: Vertical, origin: GraphOrigin, rawNodes: { id: string; label: string; type: string }[], rawLinks: GLink[]): LoadedGraph {
  const ids = new Set(rawNodes.map((n) => n.id));
  const links = rawLinks.filter((l) => ids.has(l.source) && ids.has(l.target));
  const degree = new Map<string, number>();
  for (const l of links) {
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
  }
  const nodes = rawNodes.map((n) => ({ ...n, color: colorFor(vertical, n.type), connections: degree.get(n.id) ?? 0 }));
  return { vertical, origin, nodes, links };
}

/** The vertical's config graph slice (verticals.ts), used when the seed graph is unavailable. */
function configSlice(vertical: Vertical): LoadedGraph {
  const cfg = verticals[vertical];
  return build(
    vertical,
    "config",
    cfg.graphNodes.map((n) => ({ id: n.id, label: n.label, type: n.type })),
    cfg.graphLinks.map((l) => ({ source: l.source, target: l.target, label: l.label }))
  );
}

const BADGE: Record<string, string> = {
  mock: "Local SQLite seed",
  ontology: "Local seed + OWL pack",
  coa: "Neptune via COA · virtual graph",
};

export default function GraphPage() {
  const { vertical } = useAppStore();
  const data = verticals[vertical];
  const fidelity = useFidelity();
  const fgRef = useRef<FgRef | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const fittedFor = useRef<LoadedGraph | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [searchTerm, setSearchTerm] = useState("");
  const [loaded, setLoaded] = useState<LoadedGraph | null>(null);

  // Seed graph from local SQLite in every mode (`source=seed`): the Live COA
  // graph is virtual and is not drawn here. An unseeded DB errors or returns no
  // nodes; both fall back to the config slice.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/graph?vertical=${encodeURIComponent(vertical)}&action=full&source=seed`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: ApiGraph) => {
        const nodes = (body.nodes ?? []).map((n) => ({ id: String(n.id), label: n.label ?? "", type: n.type ?? "Entity" }));
        const links = (body.edges ?? []).map((e) => ({
          source: String(e.source_id ?? e.source ?? ""),
          target: String(e.target_id ?? e.target ?? ""),
          label: e.relation,
        }));
        if (!cancelled) setLoaded(nodes.length > 0 ? build(vertical, "seed", nodes, links) : configSlice(vertical));
      })
      .catch(() => {
        if (!cancelled) setLoaded(configSlice(vertical));
      });
    return () => {
      cancelled = true;
    };
  }, [vertical]);

  // Size the canvas to its container (not the window) so the graph is centred.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width: Math.floor(width), height: Math.floor(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const graph = loaded?.vertical === vertical ? loaded : null;
  const graphData = useMemo(() => ({ nodes: graph?.nodes ?? [], links: graph?.links ?? [] }), [graph]);

  // Entity type counts
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    graphData.nodes.forEach((n) => { counts[n.type] = (counts[n.type] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [graphData]);

  const highlightNodes = useMemo(() => {
    if (!searchTerm.trim()) return new Set<string>();
    const term = searchTerm.toLowerCase();
    return new Set(graphData.nodes.filter((n) => n.label.toLowerCase().includes(term) || n.type.toLowerCase().includes(term)).map((n) => n.id));
  }, [searchTerm, graphData]);

  const paintNode = useCallback((node: FgNode, ctx: CanvasRenderingContext2D) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const size = Math.max(3, Math.min(12, 3 + node.connections * 0.8));
    const highlighted = highlightNodes.size > 0 && highlightNodes.has(node.id);
    const dimmed = highlightNodes.size > 0 && !highlightNodes.has(node.id);

    ctx.beginPath();
    ctx.arc(x, y, size, 0, 2 * Math.PI);
    ctx.fillStyle = dimmed ? "rgba(63,63,70,0.3)" : node.color;
    ctx.fill();

    if (highlighted) {
      ctx.beginPath();
      ctx.arc(x, y, size + 3, 0, 2 * Math.PI);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Only show labels for high-connectivity nodes or highlighted
    if (node.label && (node.connections > 3 || highlighted)) {
      ctx.font = `${Math.max(3.5, Math.min(5, 3 + node.connections * 0.2))}px Inter, sans-serif`;
      ctx.fillStyle = dimmed ? "rgba(161,161,170,0.2)" : "#e4e4e7";
      ctx.textAlign = "center";
      ctx.fillText(node.label, x, y + size + 5);
    }
  }, [highlightNodes]);

  const paintPointer = useCallback((node: FgNode, color: string, ctx: CanvasRenderingContext2D) => {
    ctx.beginPath();
    ctx.arc(node.x ?? 0, node.y ?? 0, 8, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
  }, []);

  // Fit once per data load, after the layout settles.
  const onEngineStop = useCallback(() => {
    if (graph && fittedFor.current !== graph) {
      fittedFor.current = graph;
      fgRef.current?.zoomToFit(400, 40);
    }
  }, [graph]);

  const originLabel = graph?.origin === "config" ? "config slice" : "demo seed graph (local SQLite)";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Knowledge Graph</h1>
          <p className="text-sm text-zinc-400 mt-0.5">
            {graph ? `${data.name} — ${graphData.nodes.length} entities, ${graphData.links.length} relationships — ${originLabel}` : `${data.name} — loading graph…`}
          </p>
          {fidelity === "coa" && (
            <p className="text-xs text-zinc-500 mt-1">The live COA graph is virtual (mapped over registered sources) and is not drawn here; this view shows the local demo seed.</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => fgRef.current?.zoomToFit(400, 40)} aria-label="Fit graph to view" className="p-2 rounded-lg border border-white/[0.08] hover:bg-white/[0.04] text-zinc-400 transition-colors">
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
        <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search entities..."
          className="w-full pl-9 pr-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50" />
      </div>

      {/* Graph container */}
      <div className="relative rounded-xl border border-white/[0.06] bg-[#0c0c12] overflow-hidden">
        {/* Legend overlay */}
        <div className="absolute bottom-4 left-4 z-10 bg-[#0c0c12]/90 backdrop-blur-sm rounded-lg border border-white/[0.08] p-3 space-y-1.5">
          {typeCounts.map(([type, count]) => (
            <div key={type} className="flex items-center gap-2 text-xs">
              <div data-legend-dot className="w-3 h-3 rounded-full" style={{ backgroundColor: colorFor(vertical, type) }} />
              <span className="text-zinc-300 w-24">{type}</span>
              <span className="text-zinc-500">{count}</span>
            </div>
          ))}
        </div>

        {/* Backend badge, by mode */}
        {fidelity && (
          <div className="absolute top-3 right-3 z-10 flex items-center gap-2 px-3 py-2 rounded-lg bg-[#232f3e] border border-white/[0.1]">
            {fidelity === "coa" && <AwsLogo className="h-3.5" />}
            <span className="text-[10px] text-zinc-300">{BADGE[fidelity] ?? BADGE.mock}</span>
          </div>
        )}

        <div ref={containerRef} data-graph-container className="h-[550px] md:h-[620px]">
          {graph && size.width > 0 && size.height > 0 && (
            <ForceGraph2D
              ref={fgRef}
              width={size.width}
              height={size.height}
              graphData={graphData}
              nodeCanvasObject={paintNode}
              nodePointerAreaPaint={paintPointer}
              linkColor={() => "rgba(161,161,170,0.35)"}
              linkWidth={1}
              linkDirectionalParticles={0}
              d3AlphaDecay={0.02}
              d3VelocityDecay={0.3}
              warmupTicks={50}
              cooldownTime={3000}
              onEngineStop={onEngineStop}
              backgroundColor="#0c0c12"
            />
          )}
        </div>
      </div>
    </div>
  );
}
