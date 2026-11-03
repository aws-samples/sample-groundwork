import fs from "fs";
import path from "path";
import { Parser as N3Parser, type Quad } from "n3";
import { parse as parseYaml } from "yaml";
import { VERTICAL_TO_PACK, loadPack } from "./pack-loader";
import { verticals } from "../../data/verticals";
import type { OntologySchema } from "./types";

/**
 * Display-oriented view of a pack's ontology.ttl for the console's View Schema
 * modal: classes (label, parent, one-sentence summary, datatype properties by
 * rdfs:domain), object properties as relationships (transitive / inferred
 * tags), and the governed metric names from metrics.osi.yaml.
 *
 * Parsed at runtime with n3 (same pattern as pack-loader.ts parseOntology,
 * which feeds Mode 2 and is left unchanged), so there is no hand-typed schema
 * and nothing to drift from the ontology COA installs.
 */

const OWL = "http://www.w3.org/2002/07/owl#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const DCTERMS = "http://purl.org/dc/terms/";

/** The metric vocabulary class COA adds for imported governed metrics. */
export const METRIC_VOCAB_CLASS = "GovernedMetric";

export interface PackSchemaProperty {
  id: string;
  label: string;
  range?: string;
}

export interface PackSchemaClass {
  id: string;
  label: string;
  subClassOf?: string;
  summary: string;
  properties: PackSchemaProperty[];
}

export interface PackSchemaRelationship {
  id: string;
  label: string;
  domain?: string;
  range?: string;
  transitive: boolean;
  inferred: boolean;
  comment?: string;
}

export interface PackSchemaDetail {
  vertical: string;
  pack: string;
  title: string;
  source: string;
  /** Other UI verticals that use the same pack (e.g. cyber ↔ otsec). */
  sharedWith: string[];
  classes: PackSchemaClass[];
  relationships: PackSchemaRelationship[];
  metrics: string[];
  counts: { classes: number; relationships: number; metrics: number };
}

type PackLevel = Omit<PackSchemaDetail, "vertical" | "sharedWith">;

const _cache = new Map<string, PackLevel>();

function localName(iri: string): string {
  const hash = iri.lastIndexOf("#");
  const slash = iri.lastIndexOf("/");
  return iri.slice(Math.max(hash, slash) + 1);
}

function firstSentence(text: string | undefined): string {
  if (!text) return "";
  const flat = text.replace(/\s+/g, " ").trim();
  const m = flat.match(/^(.+?[.!?])(\s|$)/);
  return (m ? m[1] : flat).trim();
}

function yamlOntologyTitle(dir: string): string | undefined {
  try {
    const doc = parseYaml(fs.readFileSync(path.join(dir, "pack.yaml"), "utf8")) as { ontology_title?: unknown } | null;
    return typeof doc?.ontology_title === "string" && doc.ontology_title.trim() ? doc.ontology_title.trim() : undefined;
  } catch {
    return undefined;
  }
}

function loadPackLevel(vertical: string, pack: string): PackLevel {
  const cached = _cache.get(pack);
  if (cached) return cached;

  const dir = path.join(process.cwd(), "packs", pack);
  const rel = ["packs", pack, "ontology.ttl"].join("/");
  const quads: Quad[] = new N3Parser().parse(fs.readFileSync(path.join(dir, "ontology.ttl"), "utf8"));

  const ontologyIris = new Set<string>();
  const classIris: string[] = [];
  const objectProps: string[] = [];
  const datatypeProps: string[] = [];
  const transitive = new Set<string>();
  const labels = new Map<string, string>();
  const titles = new Map<string, string>();
  const comments = new Map<string, string>();
  const parents = new Map<string, string>();
  const domain = new Map<string, string>();
  const range = new Map<string, string>();
  const setOnce = (m: Map<string, string>, k: string, v: string) => {
    if (!m.has(k)) m.set(k, v);
  };

  for (const q of quads) {
    const s = q.subject.value;
    const p = q.predicate.value;
    const o = q.object.value;
    if (p === `${RDF}type`) {
      if (o === `${OWL}Ontology`) ontologyIris.add(s);
      else if (o === `${OWL}Class` && !classIris.includes(s)) classIris.push(s);
      else if (o === `${OWL}ObjectProperty` && !objectProps.includes(s)) objectProps.push(s);
      else if (o === `${OWL}DatatypeProperty` && !datatypeProps.includes(s)) datatypeProps.push(s);
      else if (o === `${OWL}TransitiveProperty`) transitive.add(s);
    } else if (p === `${RDFS}label`) setOnce(labels, s, o);
    else if (p === `${DCTERMS}title`) setOnce(titles, s, o);
    else if (p === `${RDFS}comment`) setOnce(comments, s, o);
    else if (p === `${RDFS}subClassOf` && q.object.termType === "NamedNode") setOnce(parents, s, localName(o));
    else if (p === `${RDFS}domain`) setOnce(domain, s, localName(o));
    else if (p === `${RDFS}range`) setOnce(range, s, localName(o));
  }

  const ontologyIri = Array.from(ontologyIris)[0];
  const title =
    (ontologyIri && (titles.get(ontologyIri) || labels.get(ontologyIri))) || yamlOntologyTitle(dir) || `${pack} ontology`;

  const classes: PackSchemaClass[] = classIris
    .filter((iri) => !ontologyIris.has(iri) && localName(iri) !== "")
    .map((iri) => {
      const id = localName(iri);
      return {
        id,
        label: labels.get(iri) ?? id,
        subClassOf: parents.get(iri),
        summary: firstSentence(comments.get(iri)),
        properties: datatypeProps
          .filter((pIri) => domain.get(pIri) === id)
          .map((pIri) => ({ id: localName(pIri), label: labels.get(pIri) ?? localName(pIri), range: range.get(pIri) })),
      };
    });

  const relationships: PackSchemaRelationship[] = objectProps.map((iri) => {
    const comment = comments.get(iri);
    return {
      id: localName(iri),
      label: labels.get(iri) ?? localName(iri),
      domain: domain.get(iri),
      range: range.get(iri),
      transitive: transitive.has(iri),
      inferred: /^(Inferred|Derived|Holds between)/i.test(comment?.trim() ?? ""),
      comment: comment ? comment.replace(/\s+/g, " ").trim() : undefined,
    };
  });

  const metrics = loadPack(vertical).metrics.map((m) => m.name);
  const level: PackLevel = {
    pack,
    title,
    source: rel,
    classes,
    relationships,
    metrics,
    counts: { classes: classes.length, relationships: relationships.length, metrics: metrics.length },
  };
  _cache.set(pack, level);
  return level;
}

/** The pack ontology view for one UI vertical (cached per pack). */
export function loadPackSchemaDetail(vertical: string): PackSchemaDetail {
  const pack = VERTICAL_TO_PACK[vertical] ?? vertical;
  const level = loadPackLevel(vertical, pack);
  const sharedWith = Object.keys(verticals).filter((v) => v !== vertical && (VERTICAL_TO_PACK[v] ?? v) === pack);
  return { vertical, ...level, sharedWith };
}

export interface LiveClassBreakdown {
  rawClassRows: number;
  uniqueClasses: number;
  packClassesPresent: number;
  packClassesTotal: number;
  packClassesMissing: string[];
  metricClasses: number;
  metricsPresent: string[];
  otherClasses: string[];
}

/**
 * Explain what COA's describe_schema returned against the pack: classes are
 * de-duplicated by id (COA can repeat identical rows), then split into pack
 * ontology classes, governed-metric classes (GovernedMetric and its
 * subclasses, one per imported metric) and anything else.
 */
export function classifyLiveClasses(
  detail: { classes: Pick<PackSchemaClass, "id">[] },
  liveSchema: Pick<OntologySchema, "classes">
): LiveClassBreakdown {
  const unique = new Map<string, OntologySchema["classes"][number]>();
  for (const c of liveSchema.classes) if (!unique.has(c.id)) unique.set(c.id, c);
  const ids = [...unique.keys()];
  const packIds = detail.classes.map((c) => c.id);
  const isMetric = (id: string) => id === METRIC_VOCAB_CLASS || unique.get(id)?.subClassOf === METRIC_VOCAB_CLASS;
  const metricIds = ids.filter(isMetric);
  return {
    rawClassRows: liveSchema.classes.length,
    uniqueClasses: ids.length,
    packClassesPresent: packIds.filter((id) => unique.has(id)).length,
    packClassesTotal: packIds.length,
    packClassesMissing: packIds.filter((id) => !unique.has(id)),
    metricClasses: metricIds.length,
    metricsPresent: metricIds.filter((id) => id !== METRIC_VOCAB_CLASS).map((id) => id.split(":metric:").pop() ?? id),
    otherClasses: ids.filter((id) => !packIds.includes(id) && !isMetric(id)),
  };
}
