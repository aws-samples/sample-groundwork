# Live JDBC database scenario — OT Security

**What this adds:** a live relational database (PostgreSQL) as a first-class
context source for the OT Security vertical, on top of the document feeds that
were already there. GroundWork fronts it through COA's native
`JDBC_DATABASE` source — COA discovers the schema, provisions a managed Glue
federated catalog, and answers questions over the tables with governed metrics
and graph reasoning. Nothing in GroundWork re-implements a database engine;
it wires COA's existing capability to a real database and attributes the answers
in the UI.

> **Sample scenario — not production wiring.** The database, credentials, and
> security-group rules below are a demo built in one AWS account. Harden network
> reachability, secrets, and least-privilege for your own environment.

---

## The picture

```
GroundWork (Mode 3)  ──query──►  COA control/serve plane  ──►  Glue federation ──►  RDS PostgreSQL
        │                                    │                         (managed connection, ENI in VPC)
        │                                    └── ontology (OWL) + governed metrics (OSI) bound to the tables
        └── source-systems.ts attributes answers to "OT Asset Inventory (PostgreSQL)"
```

Five tables model an OT estate (the shapes are documented in
`packs/ot-security/sources.yaml`):

| Table | What it holds |
|---|---|
| `ot_assets` | PLCs, HMIs, historians, network devices — vendor, model, firmware, Purdue level, safety-critical flag |
| `vulnerabilities` | CVE records with CVSS, CISA-KEV (exploited-in-wild), patch availability |
| `asset_vulnerabilities` | which vulnerabilities affect which assets, patch status |
| `asset_connectivity` | directed network reachability edges (the attack-path graph) |
| `compliance_controls` | NERC CIP / IEC 62443 controls and per-asset evidence status |

Six governed metrics in `packs/ot-security/metrics.osi.yaml` run over these:
`blast_radius_score`, `safety_critical_exposure`, `compliance_gap_count`,
`patch_overdue_days`, `kev_exposure_count`, `unpatched_critical_vulns`.

---

## Build it (what the scenario provisions)

All in one AWS account/region, private (the DB never gets a public endpoint).

### 1. RDS PostgreSQL, private, in the COA VPC
- Instance: `db.t4g.micro`, 20 GB gp3, single-AZ, `PubliclyAccessible=false`.
- Placed in **COA's VPC private subnets** so the federation ENI and COA's
  serve/direct-JDBC path can reach it without leaving the VPC.
- A security group that allows `5432` from COA's source/federation and serve
  security groups (so discovery + federation + query can connect), plus a
  self-reference for the seed path.
- Credentials in Secrets Manager as `{"username": "...", "password": "..."}` —
  this is the ARN COA's `jdbcConfiguration.credentialSecretArn` expects.

Because the DB is private, seed it from **inside the VPC** (a short-lived Lambda
in the same private subnets, or a bastion) — you can't reach it from a laptop.
The seed schema + synthetic rows are what map onto the ontology.

The ready-to-load dataset ships with the pack:
[`packs/ot-security/seed/ot_inventory.sql`](../packs/ot-security/seed/ot_inventory.sql).
It creates the five tables and inserts a coherent synthetic OT estate whose
values exercise every governed metric (verified against the live source:
`kev_exposure_count`=6, `compliance_gap_count`=8, `patch_overdue_days`≈1242).
Load it with `psql "... dbname=ot_inventory ..." -f ot_inventory.sql` from a host
inside the VPC, or run its statements from a small seed Lambda in the private
subnets.

### 2. Register it with COA as a `JDBC_DATABASE` source
`POST /namespaces/{otsec-ns}/sources` with:

```json
{
  "sourceType": "DATABASE",
  "databaseSource": {
    "name": "ot-inventory-db",
    "metadataEnrichmentEnabled": true,
    "jdbcConfiguration": {
      "engine": "POSTGRESQL",
      "host": "<rds-endpoint>",
      "port": 5432,
      "databaseName": "ot_inventory",
      "credentialSecretArn": "<secret-arn>",
      "schemaFilter": "public",
      "tableFilter": "ot_assets,vulnerabilities,asset_vulnerabilities,asset_connectivity,compliance_controls"
    }
  }
}
```

> **Gotcha (fixed in this repo's tooling):** COA's `FilterPattern` is a
> **string**, not a YAML list — comma/pipe-separated (`"a,b,c"`). The pack's
> `sources.yaml` shows them as lists for readability; pass strings to the API.

COA returns `202 REGISTERED` and runs an async scan: it discovers the schema,
then provisions a **managed Glue federated catalog** (a Glue connection with
`MANAGED_CONNECTION=true` + Lake Formation federation — no connector Lambda, no
CloudFormation in your account). The source moves `SCANNING → PENDING_REVIEW`.

### 3. Approve the discovered tables
`POST /namespaces/{ns}/sources/{sourceId}/approve` (empty body → `202`,
`APPROVING → APPROVED`). This is the steward gate; on approval COA finalizes
federation. Verify with `GET .../sources/{sourceId}`:
`queryEngine: JDBC`, `tablesApproved: 5`, and a `glueConnectionName` /
`athenaDataCatalogName`. The Glue connection reaching `READY` confirms the ENI
connected to the private RDS.

### 4. Install the pack into the namespace (ontology + metrics)
The `otsec` namespace needs the ontology and the governed metrics bound to the
source. Either run `coa-pack install` for the `ot-security` pack, or do the two
API steps directly:

1. **Ontology** — upload `ontology.ttl` (`request_ontology_upload_url` → PUT →
   `ingest-from-s3`, poll to `completed`). Confirms with `describe_schema`
   returning the OT classes.
2. **Metrics** — `POST /namespaces/{ns}/import-osi` with the OSI content.
   - The metric's `data_source_id` must be the **registered source's id**, not
     the pack placeholder `ds-ot-inventory`. `coa-pack` substitutes this; if you
     import by hand, set it to the real `sourceId`.
   - COA reads per-metric vendor data from `custom_extensions: [{vendor_name:
     "COA", data: {...}}]`. The pack authors it as a readable `x_coa:` block and
     `coa-pack`'s loader now translates it at emit time (see
     `tools/coa-pack/src/coa_pack/pack.py`). A successful import returns
     `metricsCreated: 6, errors: []`.

### 5. It shows up in the UI
Answers that draw on these tables are attributed to **"OT Asset Inventory
(PostgreSQL)"** in the GraphRAG citation panel (see
`src/lib/context/source-systems.ts`) — so the multi-source story now visibly
spans a live database alongside the MITRE/NVD/KEV document feeds.

---

## Demo questions

Once the pack is installed and the source is `APPROVED`, ask (Mode 3):

- "How many OT assets are affected by actively exploited (CISA KEV) vulnerabilities?"
- "How many NERC CIP / IEC 62443 compliance controls are failing?"
- "If an attacker compromises our VPN gateway, how many OT assets are reachable,
  and does the path reach any safety-critical systems?"

These are also wired into `scripts/capture-hero-answers.mjs` so their real COA
answers can be pre-captured into the demo cache (see below).

---

## Known behaviour: COA latency and the answer cache

COA's Tier-3 graph synthesis has variable latency (~16–30s) and sits right at
API Gateway's ~29s hard timeout, so a live graph query can intermittently 504
and (in the app) fall back to vector retrieval. This is expected and the app is
built for it:

- `src/lib/context/coa-cache.ts` serves **pre-captured real COA answers** for the
  scripted hero questions instantly. These are genuine COA outputs, not
  fabrications. Refresh them with `scripts/capture-hero-answers.mjs` when COA is
  warm and healthy. Set `COA_DISABLE_CACHE=1` to force the live path.
- Ad-hoc questions always go live, with a vector fallback so the user still gets
  a grounded answer if synthesis is momentarily unavailable.
- COA occasionally has transient connectivity/cold-start windows that self-heal;
  re-running the capture later succeeds.
- **The 29s timeout has a real fix:** the REST transport is capped at ~29s by API
  Gateway, but COA's AgentCore Runtime SSE endpoint is not. Set
  `COA_TRANSPORT=agentcore` + `COA_SERVE_RUNTIME_ARN` to send the slow `query`
  synthesis over SSE and avoid the 504s entirely — see the "Query transport"
  section in `docs/MODE3_COA.md`. REST stays the default for portability.

### Note for COA operators (not required for the sample)
The fast **Tier-1** governed-metric path (deterministic, ~1s, no LLM) engages
only when the serve/data-layer tier's metric resolver can load the metrics from
Neptune. That resolver matches metrics by a **graph-URI-template prefix**. If a
deployment's serve `GRAPH_URI_TEMPLATE` does not align with the base the
metric-import writer uses, `list_metrics` still shows the metrics (a different
code path) but Tier-1 loads zero and every query falls through to the slow
Tier-2/3 path. This is a COA deployment-config alignment concern, not a
GroundWork one — the sample does not depend on or modify it.

---

## Teardown

Delete in this order (nothing here is meant to live long):

1. COA source: `DELETE /namespaces/{ns}/sources/{sourceId}` (removes the source;
   COA cleans up the Glue federated catalog/connection it provisioned).
2. RDS instance `groundwork-ot-demo` (skip final snapshot for a demo).
3. DB subnet group `groundwork-ot-demo-subnet-group`.
4. The seed Lambda + its execution role (if you used the Lambda seed path).
5. Security group for the DB.
6. Secrets Manager secret `groundwork/ot-demo-db`.

Optionally leave the ontology + metrics in the namespace (they're harmless
without the source) or delete the metrics via the metric API.

---

## Portability

Everything here uses COA's stable public surface — `create_source`,
`import-osi`, `query`, and the ontology upload/ingest endpoints — plus standard
AWS resources. A customer who clones the sample points it at **their** COA
deployment and their own database; no GroundWork code or COA internal config
is hand-edited. That is the whole reason this rides COA's native `JDBC_DATABASE`
capability instead of adding a bespoke connector.
