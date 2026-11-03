/**
 * MITRE ATT&CK for ICS Connector
 * 
 * Fetches real ICS techniques, groups, and malware from MITRE's public STIX bundle.
 * Source: https://github.com/mitre/cti (Apache 2.0 license)
 */

import { upsertNode, insertEdge, insertDocument } from "@/lib/db/queries";

const MITRE_ICS_URL = "https://raw.githubusercontent.com/mitre/cti/master/ics-attack/ics-attack.json";

export interface MitreSyncResult {
  techniques_fetched: number;
  groups_fetched: number;
  malware_fetched: number;
  relationships_created: number;
  errors: string[];
}

/** The subset of STIX 2.x object fields this connector reads. */
interface StixObject {
  type: string;
  id: string;
  name: string;
  revoked?: boolean;
  description?: string;
  external_references?: Array<{ source_name: string; external_id?: string }>;
  kill_chain_phases?: Array<{ phase_name: string }>;
  aliases?: string[];
  first_seen?: string;
  last_seen?: string;
  x_mitre_deprecated?: boolean;
  x_mitre_platforms?: string[];
  x_mitre_data_sources?: string[];
  x_mitre_detection?: string;
  x_mitre_aliases?: string[];
  source_ref: string;
  target_ref: string;
  relationship_type?: string;
}

export async function syncMitreIcs(vertical: string): Promise<MitreSyncResult> {
  const result: MitreSyncResult = { techniques_fetched: 0, groups_fetched: 0, malware_fetched: 0, relationships_created: 0, errors: [] };

  try {
    const response = await fetch(MITRE_ICS_URL);
    if (!response.ok) {
      result.errors.push(`MITRE fetch failed: ${response.status}`);
      return result;
    }

    const bundle = await response.json();
    const objects: StixObject[] = bundle.objects || [];

    // Map STIX IDs to our node IDs for relationship linking
    const stixIdToNodeId = new Map<string, string>();

    // Process attack-patterns (techniques)
    const techniques = objects.filter((o) => o.type === "attack-pattern" && !o.revoked && !o.x_mitre_deprecated);
    for (const tech of techniques) {
      const externalId = tech.external_references?.find((r) => r.source_name === "mitre-attack")?.external_id || "";
      if (!externalId) continue;

      const nodeId = externalId.toLowerCase().replace(/\./g, "-");
      const tactics = tech.kill_chain_phases?.map((p) => p.phase_name) || [];

      upsertNode(vertical, nodeId, externalId, "ICSTechnique", {
        name: tech.name,
        description: (tech.description || "").slice(0, 500),
        tactic: tactics.join(", "),
        platforms: tech.x_mitre_platforms || [],
        data_sources: (tech.x_mitre_data_sources || []).slice(0, 5),
        detection: (tech.x_mitre_detection || "").slice(0, 300),
        source: "MITRE ATT&CK for ICS",
      });
      stixIdToNodeId.set(tech.id, nodeId);
      result.techniques_fetched++;
    }

    // Process intrusion-sets (groups)
    const groups = objects.filter((o) => o.type === "intrusion-set" && !o.revoked);
    for (const group of groups) {
      const externalId = group.external_references?.find((r) => r.source_name === "mitre-attack")?.external_id || "";
      const nodeId = group.name.toLowerCase().replace(/[^a-z0-9]/g, "-");
      const aliases = group.aliases || [];

      upsertNode(vertical, nodeId, group.name, "ThreatGroup", {
        mitre_id: externalId,
        aliases,
        description: (group.description || "").slice(0, 500),
        first_seen: group.first_seen || "",
        last_seen: group.last_seen || "",
        source: "MITRE ATT&CK for ICS",
      });
      stixIdToNodeId.set(group.id, nodeId);
      result.groups_fetched++;
    }

    // Process malware
    const malwareList = objects.filter((o) => o.type === "malware" && !o.revoked);
    for (const mal of malwareList) {
      const nodeId = mal.name.toLowerCase().replace(/[^a-z0-9]/g, "-");
      const aliases = mal.x_mitre_aliases || [];

      upsertNode(vertical, nodeId, mal.name, "Malware", {
        aliases,
        description: (mal.description || "").slice(0, 500),
        platforms: mal.x_mitre_platforms || [],
        source: "MITRE ATT&CK for ICS",
      });
      stixIdToNodeId.set(mal.id, nodeId);
      result.malware_fetched++;
    }

    // Process relationships
    const relationships = objects.filter((o) => o.type === "relationship" && !o.revoked);
    for (const rel of relationships) {
      const sourceNodeId = stixIdToNodeId.get(rel.source_ref);
      const targetNodeId = stixIdToNodeId.get(rel.target_ref);

      if (!sourceNodeId || !targetNodeId) continue;

      let relationType = "RELATED_TO";
      if (rel.relationship_type === "uses") relationType = "USES_TECHNIQUE";
      else if (rel.relationship_type === "mitigates") relationType = "MITIGATED_BY";
      else if (rel.relationship_type === "subtechnique-of") relationType = "SUBTECHNIQUE_OF";
      else if (rel.relationship_type === "attributed-to") relationType = "ATTRIBUTED_TO";

      insertEdge(vertical, sourceNodeId, targetNodeId, relationType, {
        source: "MITRE ATT&CK for ICS",
        description: (rel.description || "").slice(0, 200),
      });
      result.relationships_created++;
    }

    // Document record
    insertDocument(vertical, `mitre-ics-sync-${Date.now()}`, "MITRE ATT&CK for ICS",
      `MITRE ICS Sync: ${result.techniques_fetched} techniques, ${result.groups_fetched} groups, ${result.malware_fetched} malware`,
      "framework", result.techniques_fetched + result.groups_fetched + result.malware_fetched, []);

  } catch (err) {
    result.errors.push(`MITRE sync error: ${(err as Error).message}`);
  }

  return result;
}
