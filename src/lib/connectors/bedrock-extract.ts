/**
 * Bedrock Entity Extraction
 * 
 * Uses Amazon Bedrock (Claude) to extract entities and relationships from documents.
 * Falls back to a local regex-based extractor when Bedrock is unavailable.
 */

import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { upsertNode, insertEdge, insertDocument, insertChunk } from "@/lib/db/queries";
import { embed, embeddingsBackend } from "@/lib/embeddings";

const EXTRACTION_PROMPT_OTSEC = `You are an OT/ICS security knowledge graph extraction engine. Given a document, extract entities and relationships.

ENTITY TYPES:
- ThreatGroup: Named adversary groups targeting industrial systems
- Vulnerability: CVE IDs with severity and affected products
- ICSTechnique: Attack techniques from ICS ATT&CK (T0xxx format)
- Malware: Named malicious software targeting ICS/SCADA
- OTAsset: Industrial control system components (PLCs, RTUs, HMIs, SCADA servers, etc.)
- PurdueZone: Network zone levels (0-5) in the Purdue model
- Compliance: Regulatory standards (NERC CIP, IEC 62443, etc.)

RELATIONSHIP TYPES:
- USES_TECHNIQUE: ThreatGroup → ICSTechnique
- EXPLOITS: ThreatGroup → Vulnerability
- AFFECTS_ASSET: Vulnerability → OTAsset
- DEPLOYS_MALWARE: ThreatGroup → Malware
- RESIDES_IN: OTAsset → PurdueZone
- CAN_REACH: OTAsset → OTAsset (network connectivity)
- SUBJECT_TO: OTAsset → Compliance
- IMPLEMENTS: Malware → ICSTechnique
- TARGETS: ThreatGroup → OTAsset

Return ONLY valid JSON in this exact format:
{
  "entities": [
    {"id": "lowercase-kebab-id", "label": "Human Readable Name", "type": "EntityType", "properties": {"key": "value"}}
  ],
  "relationships": [
    {"source": "source-id", "target": "target-id", "relation": "RELATION_TYPE", "properties": {"key": "value"}}
  ]
}

Rules:
- Use lowercase kebab-case for IDs (e.g., "apt29", "cve-2024-3400", "t0855")
- Keep descriptions under 200 chars in properties
- Only extract what is explicitly stated in the text
- If a CVE is mentioned, include CVSS if available
- If a technique ID (T0xxx) is mentioned, use it as the ID`;

const EXTRACTION_PROMPT_ENERGY = `You are an energy/utility knowledge graph extraction engine. Given a document, extract entities and relationships related to power grid operations, outages, and maintenance.

ENTITY TYPES:
- Outage: Power outage events with affected areas
- Asset: Grid equipment (transformers, poles, reclosers, substations)
- Crew: Repair crews with status and equipment
- Obstacle: Issues blocking crew access (vegetation, debris, road closures)
- Feeder: Distribution feeders serving customers
- Customer: Customer zones or accounts affected
- RootCause: Root cause of outages (weather, equipment failure, overload)

RELATIONSHIP TYPES:
- CAUSED_BY: Outage → RootCause
- ASSIGNED_TO: Outage → Crew
- BLOCKING_ACCESS: Obstacle → Crew
- DELAYS_ETA: Obstacle → Outage
- FEEDS: Feeder → Substation
- SERVES: Feeder → Customer
- AFFECTS_CUSTOMER: Outage → Customer
- CONNECTED_TO: Asset → Asset
- EVIDENCED_BY: Evidence → Asset

Return ONLY valid JSON in this exact format:
{
  "entities": [
    {"id": "lowercase-kebab-id", "label": "Human Readable Name", "type": "EntityType", "properties": {"key": "value"}}
  ],
  "relationships": [
    {"source": "source-id", "target": "target-id", "relation": "RELATION_TYPE", "properties": {"key": "value"}}
  ]
}`;

export interface ExtractionResult {
  entities: Array<{ id: string; label: string; type: string; properties: Record<string, unknown> }>;
  relationships: Array<{ source: string; target: string; relation: string; properties: Record<string, unknown> }>;
  model_used: string;
  tokens_used?: number;
}

export interface PipelineResult {
  document_id: string;
  chunks_processed: number;
  entities_extracted: number;
  relationships_extracted: number;
  model_used: string;
  errors: string[];
}

/**
 * Extract entities from text using Bedrock Claude
 */
export async function extractWithBedrock(text: string, vertical: string): Promise<ExtractionResult> {
  const region = process.env.AWS_REGION || "us-east-1";
  const modelId = process.env.BEDROCK_MODEL_ID || "anthropic.claude-3-5-sonnet-20241022-v2:0";

  const prompt = vertical === "energy" ? EXTRACTION_PROMPT_ENERGY : EXTRACTION_PROMPT_OTSEC;

  try {
    const client = new BedrockRuntimeClient({ region });
    const response = await client.send(new InvokeModelCommand({
      modelId,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 4096,
        messages: [
          { role: "user", content: `${prompt}\n\nDOCUMENT:\n${text.slice(0, 8000)}` }
        ],
      }),
    }));

    const result = JSON.parse(new TextDecoder().decode(response.body));
    const content = result.content?.[0]?.text || "";
    
    // Parse the JSON from Claude's response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { entities: [], relationships: [], model_used: modelId };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      entities: parsed.entities || [],
      relationships: parsed.relationships || [],
      model_used: modelId,
      tokens_used: result.usage?.output_tokens,
    };
  } catch (error) {
    // If Bedrock fails (no credentials, wrong region, etc.), fall back to local extraction
    console.warn(`Bedrock extraction failed (${(error as Error).message}), using local fallback`);
    return extractLocal(text, vertical);
  }
}

/**
 * Local fallback extractor (regex-based, no LLM needed)
 * Useful when Bedrock credentials aren't available
 */
export function extractLocal(text: string, vertical: string): ExtractionResult {
  const entities: ExtractionResult["entities"] = [];
  const relationships: ExtractionResult["relationships"] = [];

  if (vertical === "otsec" || vertical === "cyber") {
    // Extract CVEs
    const cveMatches = text.match(/CVE-\d{4}-\d{4,}/g) || [];
    for (const cve of [...new Set(cveMatches)]) {
      const id = cve.toLowerCase().replace(/[^a-z0-9-]/g, "-");
      entities.push({ id, label: cve, type: "Vulnerability", properties: { source: "local_extraction" } });
    }

    // Extract ICS technique IDs
    const techMatches = text.match(/T0\d{3}(?:\.\d{3})?/g) || [];
    for (const tech of [...new Set(techMatches)]) {
      const id = tech.toLowerCase().replace(/\./g, "-");
      entities.push({ id, label: tech, type: "ICSTechnique", properties: { source: "local_extraction" } });
    }

    // Extract known threat group names
    const groupNames = ["VOLTZITE", "ELECTRUM", "CHERNOVITE", "KAMACITE", "BENTONITE", "GRAPHITE", "ERYTHRITE", "KOSTOVITE", "PETROVITE", "WASSONITE", "APT29", "APT33", "APT41", "Lazarus", "Sandworm"];
    for (const group of groupNames) {
      if (text.includes(group)) {
        const id = group.toLowerCase().replace(/[^a-z0-9]/g, "-");
        entities.push({ id, label: group, type: "ThreatGroup", properties: { source: "local_extraction" } });
      }
    }

    // Extract known malware names
    const malwareNames = ["PIPEDREAM", "INCONTROLLER", "Industroyer", "CrashOverride", "Triton", "TRISIS", "Stuxnet", "BlackEnergy", "CosmicEnergy", "FuxNet"];
    for (const mal of malwareNames) {
      if (text.toLowerCase().includes(mal.toLowerCase())) {
        const id = mal.toLowerCase().replace(/[^a-z0-9]/g, "-");
        entities.push({ id, label: mal, type: "Malware", properties: { source: "local_extraction" } });
      }
    }
  }

  if (vertical === "energy") {
    // Extract outage IDs
    const outageMatches = text.match(/O[E|A]-\d{4}/g) || [];
    for (const outage of [...new Set(outageMatches)]) {
      const id = outage.toLowerCase().replace(/[^a-z0-9-]/g, "-");
      entities.push({ id, label: `Outage ${outage}`, type: "Outage", properties: { source: "local_extraction" } });
    }

    // Extract work order IDs
    const woMatches = text.match(/WO-\d{4,}/g) || [];
    for (const wo of [...new Set(woMatches)]) {
      const id = wo.toLowerCase();
      entities.push({ id, label: wo, type: "Asset", properties: { asset_type: "Work Order", source: "local_extraction" } });
    }
  }

  return { entities, relationships, model_used: "local-regex-fallback" };
}

/**
 * Chunk text into manageable pieces for extraction
 */
function chunkText(text: string, maxChunkSize: number = 4000, overlap: number = 200): string[] {
  if (text.length <= maxChunkSize) return [text]; // Short docs are a single chunk
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + maxChunkSize, text.length);
    chunks.push(text.slice(start, end));
    start = end - overlap;
    if (start >= text.length) break;
  }
  return chunks;
}

/**
 * Full pipeline: chunk → extract → store
 */
export async function runExtractionPipeline(
  documentId: string,
  title: string,
  source: string,
  text: string,
  vertical: string,
): Promise<PipelineResult> {
  const result: PipelineResult = {
    document_id: documentId,
    chunks_processed: 0,
    entities_extracted: 0,
    relationships_extracted: 0,
    model_used: "",
    errors: [],
  };

  try {
    // Chunk the document
    const chunks = chunkText(text);
    result.chunks_processed = chunks.length;

    const allEntities: ExtractionResult["entities"] = [];
    const allRelationships: ExtractionResult["relationships"] = [];

    // Extract from each chunk, and persist the chunk + its embedding so the
    // vector-retrieval path (Gap 2) has real content to search over.
    const backend = embeddingsBackend();
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      try {
        const extraction = await extractWithBedrock(chunk, vertical);
        result.model_used = extraction.model_used;
        allEntities.push(...extraction.entities);
        allRelationships.push(...extraction.relationships);
      } catch (err) {
        result.errors.push(`Chunk extraction error: ${(err as Error).message}`);
      }
      // Store the chunk with an embedding regardless of extraction outcome —
      // vector search should see the text even when entity extraction is sparse.
      try {
        const vector = await embed(chunk);
        insertChunk(vertical, `${documentId}::${i}`, documentId, i, chunk, vector, backend, { title, source });
      } catch (err) {
        result.errors.push(`Chunk embed error: ${(err as Error).message}`);
      }
    }

    // Deduplicate entities by ID
    const entityMap = new Map<string, (typeof allEntities)[0]>();
    for (const entity of allEntities) {
      if (!entityMap.has(entity.id)) {
        entityMap.set(entity.id, entity);
      }
    }

    // Store entities in database. Stamp each with provenance (which document it
    // came from) so graph answers can cite the sources they were stitched from.
    const entityIds: string[] = [];
    for (const entity of entityMap.values()) {
      upsertNode(vertical, entity.id, entity.label, entity.type, {
        ...entity.properties,
        source_document_id: documentId,
        source_document_title: title,
      });
      entityIds.push(entity.id);
      result.entities_extracted++;
    }

    // Store relationships (also provenance-stamped).
    for (const rel of allRelationships) {
      // Only store if both source and target exist
      if (entityMap.has(rel.source) || entityMap.has(rel.target)) {
        insertEdge(vertical, rel.source, rel.target, rel.relation, {
          ...rel.properties,
          source_document_id: documentId,
          source_document_title: title,
        });
        result.relationships_extracted++;
      }
    }

    // Store document record
    insertDocument(vertical, documentId, source, title, "extracted", chunks.length, entityIds);

  } catch (err) {
    result.errors.push(`Pipeline error: ${(err as Error).message}`);
  }

  return result;
}
