/**
 * NVD (National Vulnerability Database) Connector
 * 
 * Fetches real CVE data from NIST NVD API v2.0
 * Rate limit: 5 requests/30s without API key, 50/30s with key
 * Docs: https://nvd.nist.gov/developers/vulnerabilities
 */

import { upsertNode, insertDocument } from "@/lib/db/queries";

const NVD_BASE = "https://services.nvd.nist.gov/rest/json/cves/2.0";

export interface NvdSyncOptions {
  vertical: string;
  keywords?: string[];    // Search terms (e.g., ["Rockwell", "Siemens", "PAN-OS"])
  cvssMinScore?: number;  // Only fetch CVEs with CVSS >= this
  maxResults?: number;    // Limit results (default 20)
  apiKey?: string;        // Optional NVD API key for higher rate limits
}

export interface NvdSyncResult {
  cves_fetched: number;
  nodes_created: number;
  edges_created: number;
  errors: string[];
}

export async function syncNvd(options: NvdSyncOptions): Promise<NvdSyncResult> {
  const { vertical, keywords = ["Siemens", "Rockwell", "PAN-OS", "Fortinet"], cvssMinScore = 7.0, maxResults = 20, apiKey } = options;
  const result: NvdSyncResult = { cves_fetched: 0, nodes_created: 0, edges_created: 0, errors: [] };

  for (const keyword of keywords) {
    try {
      const url = new URL(NVD_BASE);
      url.searchParams.set("keywordSearch", keyword);
      url.searchParams.set("resultsPerPage", String(Math.min(maxResults, 50)));
      if (cvssMinScore) {
        url.searchParams.set("cvssV3Severity", cvssMinScore >= 9 ? "CRITICAL" : cvssMinScore >= 7 ? "HIGH" : "MEDIUM");
      }

      const headers: Record<string, string> = { "Accept": "application/json" };
      if (apiKey) headers["apiKey"] = apiKey;

      const response = await fetch(url.toString(), { headers });
      if (!response.ok) {
        result.errors.push(`NVD API error for "${keyword}": ${response.status} ${response.statusText}`);
        continue;
      }

      const data = await response.json();
      const vulnerabilities = data.vulnerabilities || [];

      for (const vuln of vulnerabilities) {
        const cve = vuln.cve;
        if (!cve) continue;

        const cveId = cve.id; // e.g., "CVE-2024-3400"
        const description = cve.descriptions?.find((d: { lang: string; value: string }) => d.lang === "en")?.value || "";
        const cvssData = cve.metrics?.cvssMetricV31?.[0]?.cvssData || cve.metrics?.cvssMetricV30?.[0]?.cvssData;
        const cvssScore = cvssData?.baseScore || 0;
        const cweList = cve.weaknesses?.flatMap((w: { description?: Array<{ value: string }> }) => w.description?.map((d) => d.value)) || [];
        const published = cve.published || "";
        const references = cve.references?.map((r: { url: string }) => r.url).slice(0, 5) || [];

        // Determine affected products from CPE
        const affectedProducts: string[] = [];
        const configurations = cve.configurations || [];
        for (const config of configurations) {
          for (const node of config.nodes || []) {
            for (const cpe of node.cpeMatch || []) {
              if (cpe.vulnerable) {
                const parts = cpe.criteria?.split(":") || [];
                if (parts.length >= 5) {
                  affectedProducts.push(`${parts[3]}:${parts[4]}`);
                }
              }
            }
          }
        }

        // Only keep CVEs above min score
        if (cvssScore < cvssMinScore) continue;

        // Create node
        upsertNode(vertical, cveId.toLowerCase().replace(/[^a-z0-9-]/g, "-"), cveId, "Vulnerability", {
          cvss: cvssScore,
          description: description.slice(0, 500),
          affected_products: affectedProducts.slice(0, 10),
          cwe: cweList.slice(0, 3),
          published,
          references: references.slice(0, 3),
          exploited_in_wild: false, // Will be enriched by CISA KEV
          source: "NVD",
          ics_relevant: keyword.toLowerCase() !== "general",
        });
        result.nodes_created++;
        result.cves_fetched++;
      }

      // Rate limit: wait 6 seconds between requests (5 req/30s)
      if (!apiKey) {
        await new Promise((r) => setTimeout(r, 6000));
      } else {
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch (err) {
      result.errors.push(`Error fetching "${keyword}": ${(err as Error).message}`);
    }
  }

  // Create a document record for this sync
  if (result.cves_fetched > 0) {
    insertDocument(vertical, `nvd-sync-${Date.now()}`, "NVD CVE Feed", `NVD Sync: ${result.cves_fetched} CVEs (${keywords.join(", ")})`, "vulnerability_feed", result.cves_fetched, []);
  }

  return result;
}
