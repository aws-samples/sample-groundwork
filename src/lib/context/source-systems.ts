/**
 * Source-system attribution for graph answers.
 *
 * In the demo, every fact lives in a synthetic Markdown document. In a real
 * deployment those same facts would originate in enterprise systems of record —
 * an ERP, a LIMS, a CRM, a threat-intel feed, an SBOM. This module maps each
 * demo document to the system it *represents*, so the GraphRAG panel can cite
 * "PO #NS-4411 (SAP Ariba)" instead of "05-purchase-order-ledger.md" — which is
 * how the multi-system story reads in production.
 *
 * The mapping is keyed by the document's base filename (the stable identifier
 * COA returns in supportingContent). Titles are human-friendly labels.
 */

export interface SourceSystem {
  /** Human-friendly document title. */
  title: string;
  /** The enterprise system this document represents in a real deployment. */
  system: string;
}

// Product Quality (drill) — the supply-chain / quality systems a manufacturer runs.
const PRODQUALITY: Record<string, SourceSystem> = {
  "01-reviews-voltcore-drill": { title: "VoltCore 20V — customer reviews", system: "Salesforce (Reviews)" },
  "02-returns-rma-winter": { title: "Winter returns & RMA analysis", system: "ServiceMax (Returns/RMA)" },
  "03-cold-test-lab-report": { title: "Cold-temperature cell test report", system: "LIMS (Quality Lab)" },
  "04-bill-of-materials": { title: "VoltCore 20V — bill of materials", system: "SAP PLM (BOM)" },
  "05-purchase-order-ledger": { title: "Cell procurement — purchase orders", system: "SAP Ariba (Procurement)" },
  "06-engineering-change-notice": { title: "ECN-NS-77 — electrolyte reformulation", system: "PTC Windchill (Change/PLM)" },
  "07-capa-and-scorecards": { title: "CAPA #NS-01 & supplier scorecards", system: "ETQ Reliance (Quality/CAPA)" },
  "08-store-sales-by-region": { title: "Store sales & returns by region", system: "Retail POS / Data Lake" },
};

// OT Security — the intel and asset systems a security team correlates across.
// The live COA corpus stores these under path prefixes (feeds/mitre-attack-ics/
// groups|techniques/…, nvd/…, sbom/…), so OT-Sec resolution keys on the PATH,
// not the bare filename (which is just an ATT&CK/CVE id).
const OTSEC_PATH: Array<{ match: RegExp; title: (stem: string) => string; system: string }> = [
  { match: /mitre-attack-ics\/groups/i, title: (s) => `MITRE ATT&CK — group ${s}`, system: "MITRE ATT&CK (ICS)" },
  { match: /mitre-attack-ics\/techniques/i, title: (s) => `MITRE ATT&CK — technique ${s}`, system: "MITRE ATT&CK (ICS)" },
  { match: /mitre-attack-ics\/software/i, title: (s) => `MITRE ATT&CK — software ${s}`, system: "MITRE ATT&CK (ICS)" },
  { match: /mitre-attack-ics/i, title: (s) => `MITRE ATT&CK — ${s}`, system: "MITRE ATT&CK (ICS)" },
  { match: /nvd|cve-/i, title: (s) => `CVE record ${s}`, system: "NVD (Vulnerability DB)" },
  // Live relational source (COA JDBC_DATABASE). When an answer draws on the
  // federated Postgres OT-inventory tables, COA's supportingContent references
  // the table (e.g. "public.asset_vulnerabilities") rather than a document path.
  // Attribute those facts to the database system of record so the GraphRAG panel
  // cites "OT Asset Inventory (PostgreSQL)" — the multi-source story now spans a
  // live database alongside the document feeds.
  { match: /\b(public\.)?ot_assets\b/i, title: () => "OT asset inventory", system: "OT Asset Inventory (PostgreSQL)" },
  { match: /\b(public\.)?asset_vulnerabilities\b/i, title: () => "Asset ↔ vulnerability mapping", system: "OT Asset Inventory (PostgreSQL)" },
  { match: /\b(public\.)?vulnerabilities\b/i, title: () => "Vulnerability register", system: "OT Asset Inventory (PostgreSQL)" },
  { match: /\b(public\.)?asset_connectivity\b/i, title: () => "Network reachability edges", system: "OT Asset Inventory (PostgreSQL)" },
  { match: /\b(public\.)?compliance_controls\b/i, title: () => "Compliance control evidence", system: "OT Asset Inventory (PostgreSQL)" },
  { match: /sbom|asset|inventory/i, title: (s) => `Asset / SBOM entry ${s}`, system: "Asset Inventory (SBOM)" },
  { match: /advisor|threat/i, title: (s) => `Threat advisory ${s}`, system: "Threat Intel Feed" },
];

/**
 * Resolve a friendly title + originating system for a COA source document.
 * `raw` may be a full path, an "NN-name.md (…)" blob, or a bare filename. We
 * match Product Quality on the filename stem, and OT Security on the path prefix
 * (its facts are keyed by ATT&CK/CVE ids under feed folders). Unknown docs get a
 * sensible default so nothing renders blank.
 */
export function resolveSourceSystem(raw: string, vertical: string): SourceSystem {
  const stem = baseStem(raw);

  if (vertical === "otsec") {
    for (const rule of OTSEC_PATH) {
      if (rule.match.test(raw)) return { title: rule.title(stem), system: rule.system };
    }
    return { title: prettify(stem), system: "Security Source" };
  }

  const table = vertical === "prodquality" ? PRODQUALITY : {};
  if (table[stem]) return table[stem];
  for (const key of Object.keys(table)) {
    if (stem.includes(key) || key.includes(stem)) return table[key];
  }
  return { title: prettify(stem), system: "Enterprise System" };
}

/** Reduce any path/blob to the document's base filename stem (no dir, no ext). */
function baseStem(raw: string): string {
  // Pull the first token that looks like a filename, e.g. "06-engineering-change-notice.md".
  const fileMatch = /([A-Za-z0-9._-]+\.(?:md|txt|pdf|csv|json|docx))/.exec(raw);
  let name = fileMatch ? fileMatch[1] : raw;
  const slash = name.lastIndexOf("/");
  if (slash >= 0) name = name.slice(slash + 1);
  return name.replace(/\.[a-z0-9]+$/i, "").trim();
}

/** Turn "06-engineering-change-notice" into "Engineering change notice". */
function prettify(stem: string): string {
  const words = stem.replace(/^\d+[-_]/, "").replace(/[-_]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : stem;
}
