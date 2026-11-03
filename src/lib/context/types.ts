/**
 * Shared types for the ContextProvider abstraction.
 *
 * These are the wire shapes the UI and API routes depend on. They must stay
 * stable across all three providers (mock / ontology / coa) — the UI never
 * learns which fidelity is active except via `ContextProvider.fidelity`.
 *
 * See docs/RUNNING.md for the contract this file formalizes.
 */

export type Vertical = "cyber" | "energy" | "otsec" | "prodquality";
export type QueryMode = "vector" | "graph";
export type Fidelity = "mock" | "ontology" | "coa";

export interface Node {
  id: string;
  vertical: string;
  label: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface Edge {
  id: number | string;
  vertical: string;
  source_id: string;
  target_id: string;
  relation: string;
  properties: Record<string, unknown>;
}

export interface GraphStats {
  totalNodes: number;
  totalEdges: number;
  totalDocuments: number;
  nodesByType: Record<string, number>;
  edgesByRelation: Record<string, number>;
  totalChunks: number;
}

export interface Subgraph {
  nodes: Node[];
  edges: Edge[];
  nodeCount: number;
  edgeCount: number;
}

export interface Citation {
  documentId: string;
  title: string;
  /** How many facts (nodes/edges) in the answer trace back to this document. */
  factCount: number;
  /**
   * The system of record this evidence originates in (e.g. "SAP Ariba",
   * "LIMS", "Salesforce"). Set for graph answers to show cross-system
   * provenance; a real deployment resolves this from the registered source.
   */
  system?: string;
}

export interface QueryResult {
  mode: QueryMode;
  query: string;
  /** Present for graph mode: the traversed subgraph the UI renders. */
  subgraph?: Subgraph;
  /** Entry nodes chosen for graph traversal. */
  entryNodes?: string[];
  /** Natural-language answer (synthesized in ontology/coa modes). */
  answer?: string;
  sources?: number;
  /**
   * Unit label for `sources` (e.g. "rows" for a live SQL-backed answer). When
   * set, the UI shows `sources` + this label instead of counting citations as
   * "docs". Unset = today's behaviour.
   */
  sourcesUnit?: string;
  /**
   * One sentence describing how the graph answer was resolved (which live
   * tables / ontology relations it walked). Replaces the UI's generic
   * "walked the knowledge graph…" line when present.
   */
  pathDescription?: string;
  latency: number;
  hops?: number;
  model?: string;
  /** Backend identifier, e.g. "SQLite (dev)", "Neptune via COA". */
  backend?: string;
  note?: string;
  /**
   * True when a graph-mode answer had to fall back to the vector path (COA
   * Tier-3 synthesis timed out). The UI uses this to label the panel clearly
   * so a fallback never looks like a silent duplicate of the vector result.
   */
  fallback?: boolean;
  /**
   * Provenance — the distinct source documents this answer was stitched from.
   * The visible proof of "evidence correlated across separate documents."
   */
  citations?: Citation[];
}

export interface MetricDef {
  name: string;
  description: string;
  /** Argument names the metric expects, e.g. ["assetId"]. */
  args?: string[];
  unit?: string;
}

export interface MetricResult {
  name: string;
  value: number;
  /** How the value was produced — for the honesty badge / tooltips. */
  method: string;
  args: Record<string, unknown>;
  latency: number;
}

export interface OntologyClass {
  id: string;
  label: string;
  comment?: string;
  subClassOf?: string;
  altLabels?: string[];
}

export interface OntologyProperty {
  id: string;
  label: string;
  domain?: string;
  range?: string;
  transitive?: boolean;
  comment?: string;
}

export interface OntologySchema {
  vertical: string;
  /** Source of the schema — "hardcoded", "ontology.ttl", or "COA describe_schema". */
  source: string;
  classes: OntologyClass[];
  properties: OntologyProperty[];
}

export interface Document {
  id: string;
  vertical: string;
  source: string;
  title: string;
  doc_type: string;
  ingested_at: string;
  chunks_count: number;
  entities_extracted: string[];
  content?: string | null;
  metadata?: Record<string, unknown>;
}
