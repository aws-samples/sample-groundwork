/**
 * CISA Known Exploited Vulnerabilities (KEV) Connector
 * 
 * Fetches the official CISA KEV catalog — CVEs confirmed exploited in the wild.
 * Source: https://www.cisa.gov/known-exploited-vulnerabilities-catalog
 * No auth required, no rate limits.
 */

import { upsertNode, insertDocument, getNodeById } from "@/lib/db/queries";

const CISA_KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";

export interface CisaKevSyncResult {
  total_kevs: number;
  matched_existing: number;
  new_nodes_created: number;
  errors: string[];
}

export async function syncCisaKev(vertical: string): Promise<CisaKevSyncResult> {
  const result: CisaKevSyncResult = { total_kevs: 0, matched_existing: 0, new_nodes_created: 0, errors: [] };

  try {
    const response = await fetch(CISA_KEV_URL);
    if (!response.ok) {
      result.errors.push(`CISA KEV fetch failed: ${response.status}`);
      return result;
    }

    const data = await response.json();
    const vulnerabilities = data.vulnerabilities || [];
    result.total_kevs = vulnerabilities.length;

    // Filter to ICS-relevant vendors for OT security vertical
    const icsVendors = [
      "siemens", "rockwell", "schneider", "abb", "honeywell", "ge", "emerson",
      "yokogawa", "omron", "mitsubishi", "phoenix", "moxa", "cisco", "fortinet",
      "palo alto", "f5", "ivanti", "microsoft", "vmware", "citrix", "progress",
      "apache", "atlassian",
    ];

    for (const vuln of vulnerabilities) {
      const cveId = vuln.cveID;
      const vendor = (vuln.vendorProject || "").toLowerCase();
      const product = vuln.product || "";
      const description = vuln.shortDescription || "";
      const dateAdded = vuln.dateAdded || "";
      const dueDate = vuln.requiredAction ? vuln.dueDate : undefined;
      const knownRansomware = vuln.knownRansomwareCampaignUse === "Known";

      // Check if vendor is ICS-relevant
      const isIcsRelevant = icsVendors.some((v) => vendor.includes(v));
      if (!isIcsRelevant && vertical === "otsec") continue;

      const nodeId = cveId.toLowerCase().replace(/[^a-z0-9-]/g, "-");

      // Check if this CVE already exists in our graph
      const existing = getNodeById(vertical, nodeId);

      if (existing) {
        // Enrich existing node with KEV data
        const updatedProps = {
          ...existing.properties,
          exploited_in_wild: true,
          cisa_kev: true,
          kev_date_added: dateAdded,
          kev_due_date: dueDate,
          known_ransomware: knownRansomware,
        };
        upsertNode(vertical, nodeId, existing.label, existing.type, updatedProps);
        result.matched_existing++;
      } else {
        // Create new node
        upsertNode(vertical, nodeId, cveId, "Vulnerability", {
          description: description.slice(0, 500),
          vendor: vuln.vendorProject,
          product,
          exploited_in_wild: true,
          cisa_kev: true,
          kev_date_added: dateAdded,
          kev_due_date: dueDate,
          known_ransomware: knownRansomware,
          source: "CISA KEV",
          ics_relevant: isIcsRelevant,
        });
        result.new_nodes_created++;
      }
    }

    // Document record
    insertDocument(vertical, `cisa-kev-sync-${Date.now()}`, "CISA KEV Catalog",
      `CISA KEV Sync: ${result.total_kevs} total, ${result.matched_existing} enriched, ${result.new_nodes_created} new`,
      "advisory", result.matched_existing + result.new_nodes_created, []);

  } catch (err) {
    result.errors.push(`CISA KEV sync error: ${(err as Error).message}`);
  }

  return result;
}
