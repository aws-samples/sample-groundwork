# Testing & Experiencing GroundWork — the three modes

> **What this is.** A hands-on walkthrough to *experience* GroundWork at all
> three fidelities, plus a runnable acceptance test (`scripts/test-modes.sh`)
> where **every assertion is tied to a specific claim** from the original
> LinkedIn post (the vision) and the `docs/RUNNING.md` post-claim→mode table.
>
> Companion docs: `docs/RUNNING.md` (architecture + the authoritative claim→mode
> table §10), `docs/RUNNING.md`), `MODE3_COA.md` (the live-COA
> deploy). This doc is the "run it and see" layer on top of those.

---

## 0. The one idea being tested

GroundWork is the *same UI and the same question* at three levels of fidelity,
one environment variable apart. The question that carries the whole thing:

> **"What's the blast radius if VOLTZITE compromises our VPN?"**

| Mode | `CONTEXT_MODE` | Setup | What you're proving |
|------|----------------|-------|---------------------|
| **1 — Demo** | `mock` | `npm run dev` | The story, in 30 seconds, zero AWS |
| **2 — Local Ontology** | `ontology` | `npm run dev` | It's a *real* W3C ontology (not hardcoded), real vector retrieval — still a laptop |
| **3 — Live COA** | `coa` | deployed COA + `.env.local` | The real thing — Neptune graph via COA, in your AWS account |

The on-screen **fidelity badge** (top-left, next to the logo) always tells you
which one you're looking at. It never lies — that's the point. It's also a
**live switcher**: click it to jump between Mode 1 / 2 / 3 without restarting the
server (the page reloads and every panel re-resolves through the new provider).

> **Demo shortcut.** Start on Mode 1, then click the badge → Local ontology →
> Live COA to climb the ladder in one browser session. Or launch a specific mode
> from the CLI: `npm run demo:mock`, `npm run demo:ontology`, `npm run demo:coa`.
> `demo:coa` mints a fresh COA token first (they expire ~hourly) — always use it
> for Mode 3 rather than a plain `next dev`, so a stale token can't 403 mid-demo.

---

## 1. One-time setup

```bash
npm install
npm run db:seed        # loads the curated VOLTZITE story into SQLite (Modes 1 & 2)
```

`db:seed` gives you the clean baseline: **44 nodes / 63 edges / 12 docs** in the
`otsec` vertical — VOLTZITE plus the full blast-radius chain
(`vpn-gw → fw-dmz → historian → scada-srv → hmi-01 → eng-ws → PLCs`), and smaller
`energy` and `cyber` graphs.

> If you ran the public connectors earlier and the graph looks bloated (hundreds
> of CVE nodes), just re-seed: `rm groundwork.db* && npm run db:seed`. That
> restores the tight, walkable demo story.

---

## 2. Run + experience each mode

Start the server in the mode you want, log in with **any** email/password, and
walk the pages. Then run the acceptance test in a second terminal.

### Mode 1 — Demo (`mock`)

```bash
CONTEXT_MODE=mock npm run dev
```

**Click through:**
1. `/console/graph` — the knowledge graph. Toggle vertical (OT Sec / Cyber /
   Energy) top-right. Badge reads **Demo data**.
2. `/console/query` — the hero. Run *"What's the blast radius if VOLTZITE
   compromises our VPN?"* Compare the **Vector** panel (one similar chunk) vs the
   **Graph** panel (the connected actor→technique→CVE→asset chain).
3. `/portal` — the Energy customer outage portal.

**Then test:**
```bash
./scripts/test-modes.sh
```
Expect **6/6 PASS**. Proves: graph populated, multi-hop blast-radius traversal,
GraphRAG returns a connected subgraph, vector path responds, badge = mock,
answers come from SQLite seed.

### Mode 2 — Local Ontology (`ontology`)

```bash
CONTEXT_MODE=ontology npm run dev
```

Same UI, same question — but now the brain is a real OWL ontology.

**Click through (what changed):**
1. `/console/graph` — entity types and colors now come from
   `packs/ot-security/ontology.ttl` (15 OWL classes), not hardcoded types. Badge
   reads **Local ontology**.
2. `/console/query` — the blast-radius number is the **transitive closure of the
   ontology's `canReach` property**, and governed metrics come from
   `metrics.osi.yaml` (6 metrics). Switch the **model picker** (Claude → Nova →
   Llama): the answer's model changes, the context underneath doesn't.
3. `/console/pipeline` or `/console/sources` — **ingest a threat report** (paste
   text, or `POST /api/extract`). This auto-extracts entities into the graph AND
   embeds the text so the **vector panel now returns real cosine-kNN hits with
   citations**. This is the "auto-build a KG from unstructured docs" claim, live
   on your laptop.

**Then test:**
```bash
./scripts/test-modes.sh
```
Expect **8/8 PASS**. Adds over Mode 1: ontology-backed schema; ingest-a-report →
real vector retrieval.

### Mode 3 — Live COA (`coa`)

Requires a deployed COA and `.env.local` (see `MODE3_COA.md`). The repo's
`.env.local` is already pointed at the us-west-2 deployment; refresh the token
first (Cognito tokens last ~1h):

```bash
# refresh COA_TOKEN in .env.local
aws cognito-idp initiate-auth --auth-flow USER_PASSWORD_AUTH \
  --client-id <YOUR_COGNITO_CLIENT_ID> \
  --auth-parameters USERNAME=<you>@amazon.com,PASSWORD='<pw>' \
  --query AuthenticationResult.IdToken --output text
# paste into COA_TOKEN= in .env.local, then:
CONTEXT_MODE=coa npm run dev
```

**Click through:** same UI; badge reads **Live COA**. The graph/query now resolve
over the real COA deployment (Neptune via Ontop, OpenSearch, Bedrock) in the
`<YOUR_AWS_ACCOUNT_ID>` account — data sovereignty, in your own AWS.

**Then test:**
```bash
./scripts/test-modes.sh
```
Expect **PASS** on: query path reaches COA, backend is Neptune-via-COA, answers
resolve over the live deployment, badge = coa. You may see a **WARN** that graph
instance data isn't populated yet — that's honest: COA's document extraction runs
asynchronously after you register a source (see §4).

---

## 3. Claim → test mapping (what each assertion proves)

Each line in `scripts/test-modes.sh` is tagged with its source. `[LI]` = the
original LinkedIn post; `[§10]` = the `docs/RUNNING.md` table; `[NARR]` = the
`docs/RUNNING.md`) |
|---|---|---|
| Knowledge graph is populated | **[LI]** "Auto-build a Knowledge Graph" | 1, 2 |
| Blast-radius traversal reaches multiple assets | **[§10]** "Reason across sources → blast radius / attack path" | 1, 2 |
| GraphRAG query returns a *connected subgraph* | **[LI]** "GraphRAG — connected reasoning, not similar chunks" | 1, 2 |
| Vector query path responds | **[LI]** "Vector-only RAG finds similar text" (the honest foil) | all |
| Fidelity badge matches the active mode | **[§10]** honesty badge / progressive fidelity | all |
| Graph answers come from SQLite seed | **[§10]** Mode 1 = "the story" | 1 |
| Schema comes from `ontology.ttl` | **[§10]** Mode 2 = "it's a *real* ontology" | 2 |
| Ingesting a report populates the vector index | **[LI]** "Auto-build KG from unstructured docs using LLMs" | 2 |
| Vector query returns real cosine-kNN hits | **[LI]** "Vector RAG" is real, not simulated | 2 |
| GraphRAG query path reaches COA | **[§10]** Mode 3 = "the real thing" | 3 |
| Backend is Neptune-via-COA | **[LI]** "Neptune Analytics (knowledge graph + vector store)" | 3 |
| Answers resolve over the live COA deployment | **[LI]** "Runs in YOUR account — data sovereignty" | 3 |

### Claims that are demonstrated in the UI (not auto-asserted)

Some vision claims are best *seen* rather than scripted:

- **Model-agnostic (Claude, Nova, Llama, Mistral)** — the model picker on
  `/console/query`. The context layer is identical; only the reader changes. (In
  Modes 1–2 synthesis is simulated per `§10`; Mode 3 uses real `InvokeModel`.)
- **Evidence correlated across separate documents (citations)** — ingest two
  reports, ask the hero question, and watch the answer cite both source docs.
- **Two verticals** — Cybersecurity (`otsec`/`cyber`) and Energy (`energy`,
  `/portal`). Toggle top-right.
- **RBAC / audit / data sovereignty** — Mode 3 only: COA's Cedar authorization +
  OIDC + your-account deployment. See `MODE3_COA.md`.

---

## 3.5 Demo readiness — the one-time wait, and how to skip it forever

**Key fact: COA's data is persistent.** The document extraction (chunking →
embeddings → graph) is a **one-time ~90-minute job**, but the result lives in
COA's Neptune + OpenSearch — persistent infrastructure. Once it finishes, every
future demo queries the already-populated graph **instantly**. You only re-pay
the wait if you tear COA down (`make destroy-dev`) or add new documents.

So for future demos you never "wait 90 minutes" — you run a **10-second
readiness check** and go:

```bash
npm run demo:preflight
```

It verifies, fast, the things that actually break a demo:
- Modes 1 & 2: local SQLite is seeded (the VOLTZITE story).
- Mode 3: a fresh COA token mints, COA is reachable, the ontology is live, the
  vector store is populated, and the document source reads `COMPLETED`.
- Whether a dev server is running and in which mode.

It prints `READY`, `MOSTLY READY`, or `NOT READY` with the specific fix for any
item. Run it a few minutes before you present.

**Recommended pre-demo ritual:**
```bash
npm run demo:preflight     # 10s go/no-go
npm run demo:coa           # if you want to open in Mode 3 (mints a fresh token)
# then in the browser: use the badge to climb Mode 1 -> 2 -> 3 live
```

If preflight says the COA vector store is empty (e.g. right after a fresh
deploy), that's the only time you wait — start the extraction and come back; it
never needs repeating for that dataset.

## 4. Mode 3 data — how answers become non-empty

Mode 3's graph starts empty and fills from the sources you register:

- **Documents** — public threat feeds landed to S3 by the connectors, then
  registered as a COA `DOCUMENTS` source:
  ```bash
  cd connectors && uv run gw-connect all --bucket <YOUR_COA_SOURCES_BUCKET> --ics-only
  ```
  366 threat-intel docs (CISA KEV + MITRE ATT&CK ICS + NVD) are already landed and
  registered. COA extracts them **asynchronously** (chunking → embeddings → graph
  propositions). While it runs, the source status reads `SCANNING_ENTITY_EXTRACTION`
  and queries return "no context yet" — expected. When it finishes, `kb/search`
  returns chunks and the graph query returns instance data.

  > **Gotcha we hit:** land only the `.md` files, not the `.sha256` sidecars — COA
  > skips unsupported formats, and a prefix full of sidecars can leave a scan
  > "COMPLETED" with zero chunks. If retrieval is empty after a COMPLETED scan,
  > remove non-document files and re-scan:
  > `POST /namespaces/{ns}/sources/{sourceId}/rescan`.

- **Governed metrics** — the 6 SQL metrics in `packs/ot-security/metrics.osi.yaml`
  need a registered **JDBC/Glue data source** (a real OT-inventory database). Until
  one is registered, `list_metrics` is empty and metric queries return
  `datasetsResolved: 0`. This is a data-availability step, not a code gap — see
  `MODE3_COA.md`.

---

## 5. How the merge with the ontology-layer COA work shows up here

The whole point of the merge (`docs/RUNNING.md`) is that **nothing is two-of**. This
test surface shows it concretely:

- The **same `packs/ot-security/ontology.ttl`** drives Mode 2's local reasoner
  *and* installs into COA for Mode 3 (`coa-pack install`). One ontology, two
  fidelities.
- The **same `metrics.osi.yaml`** defines Mode 2's governed-metric list and Mode
  3's COA Metric Service metrics.
- the ontology-layer **`connectors/` (gw-connect)** land the Mode 3 documents; the app's
  **TypeScript connectors** (`/api/sync`) land Mode 1/2 data. Same feeds, right
  runtime per mode.
- The **`CoaProvider`** speaks COA's Serve/Data-Layer REST — the one seam that
  lets the identical UI ride all three providers.

---

## 6. Quick reference

```bash
# Modes (each in its own terminal; test in another)
CONTEXT_MODE=mock      npm run dev  &&  ./scripts/test-modes.sh   # 6/6
CONTEXT_MODE=ontology  npm run dev  &&  ./scripts/test-modes.sh   # 8/8
CONTEXT_MODE=coa       npm run dev  &&  ./scripts/test-modes.sh   # wiring PASS (+WARN until extraction done)

# Options
./scripts/test-modes.sh --vertical energy         # test the Energy vertical
./scripts/test-modes.sh --url http://localhost:3000

# Handy API pokes (see RUNNING.md for the full set)
curl -s "http://localhost:3000/api/graph?vertical=otsec&action=stats"
curl -s "http://localhost:3000/api/graph?vertical=otsec&action=traverse&nodeId=vpn-gw&hops=4"
curl -s -X POST http://localhost:3000/api/query -H 'content-type: application/json' \
  -d '{"vertical":"otsec","query":"blast radius if VPN compromised","mode":"graph"}'
```
