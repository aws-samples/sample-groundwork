# Running GroundWork

## Prerequisites

- Node.js 20+
- npm 10+
- (Optional) AWS CLI configured for S3/Bedrock integrations

## Quick Start

```bash
# Install dependencies
npm install

# Seed the database with synthetic data
npm run db:seed

# Start the dev server
npm run dev
```

Open **http://localhost:3000**

---

## UI Pages

| URL | Description |
|-----|-------------|
| http://localhost:3000/login | Login (any email/password works) |
| http://localhost:3000/console/graph | Knowledge graph visualization |
| http://localhost:3000/console/query | Vector RAG vs GraphRAG comparison |
| http://localhost:3000/console/pipeline | Pipeline config + extraction preview |
| http://localhost:3000/console/sources | Connected data sources |
| http://localhost:3000/console/monitor | System health metrics |
| http://localhost:3000/console/onboarding | New vertical onboarding guide |
| http://localhost:3000/portal | Customer outage portal (Energy) |

Toggle between **Cyber / Energy / OT Sec** verticals using the buttons in the top-right header.

---

## Syncing Real Data (no AWS credentials needed)

These pull from public APIs — run in a separate terminal while the dev server is running:

```bash
# Pull real ICS techniques, groups, malware from MITRE (~1 second)
curl -s -X POST http://localhost:3000/api/sync \
  -H "Content-Type: application/json" \
  -d '{"vertical":"otsec","connector":"mitre-ics"}'

# Pull real known exploited vulns from CISA (~2 seconds)
curl -s -X POST http://localhost:3000/api/sync \
  -H "Content-Type: application/json" \
  -d '{"vertical":"otsec","connector":"cisa-kev"}'

# Pull real CVEs from NIST NVD (~6 seconds per keyword)
curl -s -X POST http://localhost:3000/api/sync \
  -H "Content-Type: application/json" \
  -d '{"vertical":"otsec","connector":"nvd","options":{"keywords":["Siemens SIMATIC","Rockwell ControlLogix"],"maxResults":5}}'

# Sync all connectors at once (MITRE + CISA + NVD)
curl -s -X POST http://localhost:3000/api/sync \
  -H "Content-Type: application/json" \
  -d '{"vertical":"otsec","connector":"all"}'
```

---

## Entity Extraction (AI Pipeline)

Extract entities from any text. Uses Bedrock Claude if AWS credentials are configured, otherwise falls back to local regex extraction.

```bash
# Preview mode (shows what would be extracted, doesn't store)
curl -s -X POST http://localhost:3000/api/extract \
  -H "Content-Type: application/json" \
  -d '{
    "vertical": "otsec",
    "mode": "preview",
    "text": "VOLTZITE exploited CVE-2024-3400 to access OT networks. They used T0886 for lateral movement. PIPEDREAM malware targets ControlLogix PLCs via T0855."
  }'

# Extract and store (adds to the live graph)
curl -s -X POST http://localhost:3000/api/extract \
  -H "Content-Type: application/json" \
  -d '{
    "vertical": "otsec",
    "mode": "text",
    "title": "My Threat Report",
    "text": "ELECTRUM deployed Industroyer2 targeting IEC-104 endpoints. CVE-2023-46747 was the initial access vector. KAMACITE provided VPN access via T0866."
  }'
```

---

## Graph Queries

```bash
# Get graph statistics
curl -s "http://localhost:3000/api/graph?vertical=otsec&action=stats"

# Traverse from a node (blast radius analysis)
curl -s "http://localhost:3000/api/graph?vertical=otsec&action=traverse&nodeId=voltzite&hops=3"

# Get all nodes of a specific type
curl -s "http://localhost:3000/api/graph?vertical=otsec&action=nodes&type=ThreatGroup"

# GraphRAG query
curl -s -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{"vertical":"otsec","query":"blast radius if VPN compromised","mode":"graph"}'

# Vector search query (for comparison)
curl -s -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{"vertical":"otsec","query":"blast radius if VPN compromised","mode":"vector"}'
```

---

## Adding Custom Data

```bash
# Add nodes and edges manually
curl -s -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "vertical": "otsec",
    "nodes": [
      {"id": "my-plc-01", "label": "My Custom PLC", "type": "OTAsset", "properties": {"vendor": "Schneider", "model": "M580", "zone": "Level 1"}}
    ],
    "edges": [
      {"source": "my-plc-01", "target": "zone-l1", "relation": "RESIDES_IN", "properties": {}}
    ]
  }'
```

---

## S3 Ingestion (requires AWS credentials)

```bash
# Set up credentials
mwinit
# or ensure ~/.aws/credentials is configured

# Ingest documents from S3
curl -s -X POST http://localhost:3000/api/extract \
  -H "Content-Type: application/json" \
  -d '{"vertical":"otsec","mode":"s3","bucket":"your-bucket-name","prefix":"threat-intel/"}'
```

---

## Enabling Bedrock AI Extraction

Create `.env.local` in the project root:

```
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=anthropic.claude-3-5-sonnet-20241022-v2:0
```

With these set, the extraction pipeline will use Claude to extract entities AND relationships (much richer than regex fallback).

---

## Resetting the Database

```bash
# Delete the database file and re-seed
rm groundwork.db
npm run db:seed
```

---

## Project Structure (key files)

```
groundwork/
├── groundwork.db           # SQLite database (auto-created by seed)
├── scripts/seed.ts           # Database seeder (npm run db:seed)
├── src/
│   ├── app/api/
│   │   ├── graph/route.ts    # GET: stats, traverse, nodes
│   │   ├── query/route.ts    # POST: vector vs graph queries
│   │   ├── documents/route.ts # GET: list documents
│   │   ├── ingest/route.ts   # POST: add nodes/edges/documents
│   │   ├── sync/route.ts     # POST/GET: trigger data connectors
│   │   └── extract/route.ts  # POST: AI extraction pipeline
│   ├── lib/
│   │   ├── db/               # SQLite schema + query functions
│   │   └── connectors/       # NVD, MITRE, CISA, S3, Bedrock
│   └── data/datasets/        # Synthetic JSON data (seed source)
└── docs/                     # Architecture, plans, this file
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `npm run db:seed` fails | Delete `groundwork.db` and retry |
| NVD API returns 403 | Rate limited — wait 30 seconds or add NVD_API_KEY to .env.local |
| Extraction returns 0 entities | Text too short or no known patterns — try with CVE IDs or group names |
| S3 connector fails | Run `mwinit` first, ensure bucket exists and region matches |
| Build fails on `better-sqlite3` | Run `npm approve-scripts --all` then `npm install` |
