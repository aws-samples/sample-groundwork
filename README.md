# GroundWork

An open-source **context-engineering** layer for security and operations. Point
it at messy sources — threat reports, advisories, CVEs, SBOMs, reviews, returns,
purchase orders — and it builds a governed knowledge graph you can query. Vector
search finds *similar* chunks; a graph finds *connected* knowledge. In security,
that's the difference between an alert and an investigation; in product quality,
between a complaint and a root cause.

Clone it, run it in your own AWS account, pick your model, ask across all your
sources.

> **Sample code — not production-ready.** GroundWork is a demonstration
> sample. It ships with demo-grade defaults (e.g. a single shared-password login
> gate that refuses to serve until configured, synthetic sample data) and is intended for
> learning and evaluation, not production use. Review and harden authentication,
> authorization, secrets management, logging, and data handling for your own
> environment before any production deployment. See [`docs/SETUP.md`](docs/SETUP.md)
> for locking down the login gate and configuring real credentials.

## What's new in this release

- **Pack-driven View Schema.** `GET /api/schema?vertical=<id>` parses the
  vertical's `packs/<pack>/ontology.ttl` at runtime, so the schema you see is the
  ontology you install. In Live COA mode it also compares against COA's
  `describe_schema` for that namespace (bounded to 8 s) and splits the live
  classes into pack, governed-metric and other classes.
  (`src/app/api/schema/route.ts`, `src/lib/context/pack-schema.ts`)
- **Live / seed Data Sources view.** `GET /api/sources?vertical=<id>` and the
  **Sources** page show a vertical's sources: live, read-only COA source status
  (documents and JDBC database sources with their approved tables) in Live COA
  mode, or the local demo seed otherwise. Responses never include credential
  ARNs, full database hosts, S3 prefixes or namespace ids. The route has no
  write methods. (`src/app/api/sources/route.ts`, `src/lib/coa-sources.ts`,
  `src/lib/coa-source-shape.ts`, `src/components/vertical-sources.tsx`)
- **Per-vertical COA namespaces.** `COA_NAMESPACE_<VERTICAL>` (for example
  `COA_NAMESPACE_OTSEC`) picks the namespace per vertical; `/api/mode` reports
  which verticals are Live-COA-configured (`coaVerticals`) without exposing the
  ids. (`src/lib/context/coa-namespace.ts`)
- **Config-driven console pages.** Pipeline, Graph, Monitor, Settings, Usage and
  Onboarding read per-vertical configuration from `src/data/verticals.ts`
  instead of hardcoded content.
- **Graph rendering fix.** Node colouring and centering are fixed, the seed
  graph is drawn in Live COA mode, and `/api/graph` validates the vertical and
  returns generic errors. (`src/app/console/graph/page.tsx`,
  `src/app/api/graph/route.ts`)
- **COA Tier-1 / Tier-2 results.** The Query page reads Tier-1 governed-metric
  `resultRows` and renders Tier-2 (NL→SQL) rows, including a truncation note.
  (`src/lib/context/coa-rows.ts`, `src/lib/context/coa-provider.ts`,
  `src/app/console/query/page.tsx`)
- **Honest labels.** The vector panel is neutral, and anything faked in Demo
  mode is labelled as simulated.
- **Fail-closed access gate and loopback binds.** `npm run dev` / `npm start`
  bind `127.0.0.1`. Every page and API route except `/api/health` returns `503`
  until the login gate or the local-only bypass is configured.
  (`src/lib/auth.ts`, `src/proxy.ts`, `package.json`)
- **Unit tests.** `npm test` runs `src/**/*.test.ts` with Node's built-in
  test runner.
- **Amazon Quick MCP proxy.** `tools/quick-mcp-proxy` is a small remote MCP
  server with one `context_query` tool, so Amazon Quick can query the same COA
  knowledge graph. See [Use it from Amazon Quick](#use-it-from-amazon-quick-mcp).

## How it's built

Everything flows through one `ContextProvider` interface
(`src/lib/context/provider.ts`, selected in `src/lib/context/index.ts`), with
three implementations — one per mode. The UI never knows which is active.

- `src/lib/context/` — the provider seam (`local-mock`, `local-ontology`, `coa`)
- `src/lib/embeddings.ts`, `src/lib/models.ts`, `src/lib/synthesize.ts` — vector + model layer
- `packs/` — the vertical OWL ontologies + governed metrics + source templates
  (drive Mode 2, install into COA for Mode 3)
- `tools/coa-pack/` — validates packs offline and installs them into a COA deployment
- `connectors/` — feed connectors for public data (NVD, MITRE ATT&CK for ICS, CISA KEV)
- `infra/` — AWS CDK app (and `infra/gateway/` for an AgentCore Gateway stack)
- `tools/quick-mcp-proxy/` — remote MCP server that lets Amazon Quick query COA
- `src/app/console/` — the operator UI; `src/app/portal/` — the customer portal

## Modes — one UI, three fidelities

The same UI runs at three fidelities, selected by the `CONTEXT_MODE` env var. You
climb the ladder; nothing is thrown away. An on-screen badge always shows which
level is live.

| Mode | `CONTEXT_MODE` | What it is | AWS? |
|------|----------------|-----------|------|
| 1 · Demo data | `mock` (default) | SQLite seed data; simulated parts are labelled | none |
| 2 · Local ontology | `ontology` | Real OWL reasoning from the vertical packs + real local vector retrieval + citations + model picker | none |
| 3 · Live COA | `coa` | Real graph over a deployed [Context Ontology Accelerator](https://github.com/aws/context-ontology-accelerator) (Neptune, governed metrics, Cedar) | yes |

Two env flips light up real AWS with no code change (see `.env.example`):

- `EMBEDDINGS_BACKEND=titan` — real Titan embeddings for the vector path
- `GENERATION_BACKEND=bedrock` — real Bedrock model generation for graph answers

## Prerequisites

- Node.js 20 or later (the container image uses Node 22) and npm
- Optional: [`uv`](https://docs.astral.sh/uv/) for the Python tools
  (`connectors/`, `tools/coa-pack/`, `tools/validate-packs.sh`)
- Optional, Mode 3 and the Bedrock flips only: an AWS account, the AWS CLI with
  a configured profile, and a deployed COA

## Setup

1. **Install dependencies.**

   ```bash
   npm ci
   ```

2. **Create your local env file.** `.env.local` is gitignored; `.env.example`
   documents every variable with placeholders only.

   ```bash
   cp .env.example .env.local
   ```

3. **Configure the access gate.** The gate fails closed: with neither option
   set, every page and API route except `/api/health` answers `503` with a
   setup message.

   - **Login gate** (required for anything shared or hosted): set all three of
     `DEMO_USER`, `DEMO_PASS` and `AUTH_SECRET` in `.env.local`. Generate the
     secret with `openssl rand -base64 32`.
   - **Local-only bypass:** `AUTH_LOCAL_BYPASS=true` (only the exact value
     `true` is honoured) skips the login. Use it on your own machine on
     `127.0.0.1` only; never on a shared deployment.

4. **Seed the demo database** (required on a fresh clone; writes
   `groundwork.db`, which is gitignored).

   ```bash
   npm run db:seed
   ```

5. **Run it.** The server binds `127.0.0.1` only.

   ```bash
   AUTH_LOCAL_BYPASS=true npm run dev   # http://127.0.0.1:3000 (local only, no login)
   ```

   For a production build: `npm run build && npm start`.

6. **Try the other modes.**

   ```bash
   # Mode 2, still no AWS
   CONTEXT_MODE=ontology npm run dev

   # Mode 2 UI with real Bedrock (Titan + model generation)
   AWS_PROFILE=<your-profile> AWS_REGION=<your-region> \
   EMBEDDINGS_BACKEND=titan GENERATION_BACKEND=bedrock \
   CONTEXT_MODE=ontology npm run dev
   ```

[`docs/SETUP.md`](docs/SETUP.md) walks through every value in detail.

## Packs

Each vertical's domain model lives in a pack under `packs/<pack>/`:

| File | What |
|------|------|
| `pack.yaml` | Name, version, suggested namespace, ontology type, grants |
| `ontology.ttl` | The OWL ontology (Turtle). Drives Mode 2 reasoning and the View Schema modal; installed into COA for Mode 3 |
| `metrics.osi.yaml` | Governed metrics (OSI format) |
| `sources.yaml` | Source registration templates: `DOCUMENTS` and `DATABASE` (JDBC, e.g. PostgreSQL on RDS). Entries ship commented out with `${...}` placeholders such as `${OT_DB_HOST}` and a Secrets Manager ARN for credentials; fill them in and uncomment the one you want before installing. Nothing templates them for you |
| `seed/` | Optional seed data (e.g. `packs/ot-security/seed/ot_inventory.sql`) |

The shipped packs are `ot-security`, `energy-outage` and `manufacturing`. UI
verticals map onto them in `src/lib/context/pack-loader.ts` (`VERTICAL_TO_PACK`):
`cyber` and `otsec` use `ot-security`, `energy` uses `energy-outage`, and
`prodquality` uses `manufacturing`.

Validate packs offline with `tools/validate-packs.sh` (needs `uv`; a second
pass runs against COA's real parsers if a COA checkout is present at
`./context-ontology-accelerator`), and install one into COA with `coa-pack`:

```bash
cd tools/coa-pack
uv run coa-pack validate ../../packs/ot-security
uv run coa-pack install ../../packs/ot-security --namespace otsec \
  --base-url https://<your-api-id>.execute-api.<region>.amazonaws.com/prod \
  --create-namespace --owner you@example.com
```

## Connecting Live COA (Mode 3)

Mode 3 runs against a **[Context Ontology Accelerator](https://github.com/aws/context-ontology-accelerator)**
you deploy into **your own** AWS account. GroundWork is model- and
account-agnostic: you supply your COA endpoint, your Cognito credentials, and
your namespace ids — nothing is hardcoded.

Set these in `.env.local` (all documented in `.env.example`):

| Variable | What |
|----------|------|
| `CONTEXT_MODE=coa` | Turn on Mode 3 |
| `COA_BASE_URL` | Your COA API stage URL |
| `COA_CLIENT_ID`, `COA_USER`, `COA_PASS` | Cognito app client + user used to mint a short-lived token server-side |
| `COA_NAMESPACE_<VERTICAL>` | Namespace UUID per vertical (`OTSEC`, `PRODQUALITY`, `ENERGY`, `MANUFACTURING`, `CYBER`). The data-plane endpoints and the Sources view need the UUID, not the friendly name |
| `COA_TRANSPORT`, `COA_SERVE_RUNTIME_ARN` | Optional: send `query` over COA's AgentCore Runtime SSE endpoint instead of REST |

```bash
npm run demo:coa         # mints a fresh token & launches in Mode 3
npm run demo:preflight   # checks all three modes are ready
```

See [`docs/SETUP.md`](docs/SETUP.md) and [`docs/MODE3_COA.md`](docs/MODE3_COA.md)
for deploying COA and finding each value. To add a live database (JDBC/RDS) as
a source, see [`docs/JDBC_OT_SECURITY_SCENARIO.md`](docs/JDBC_OT_SECURITY_SCENARIO.md).

## Use it from Amazon Quick (MCP)

Teams that work in [Amazon Quick](https://docs.aws.amazon.com/quick/latest/userguide/mcp-integration.html)
can ask the same COA knowledge graph from Quick's chat. `tools/quick-mcp-proxy` is a small
remote MCP server with one tool, `context_query`. Quick connects with Service
authentication (OAuth client_credentials); the proxy verifies the token and calls COA
with its own server-side credentials.

```bash
cd tools/quick-mcp-proxy
npm ci && npm run build && npm test
npm start      # binds 127.0.0.1:8787; rejects /mcp until auth is configured
```

The proxy listens on loopback by default and won't start on any other interface without
OAuth configured. **See [`docs/QUICK_MCP_INTEGRATION.md`](docs/QUICK_MCP_INTEGRATION.md)**
for env vars, OAuth setup, registering the connector in Quick, testing, and security notes.

## Testing

```bash
npm run lint             # ESLint
npm test                 # unit tests (node:test via tsx)
npm run test:modes       # end-to-end checks against a running server (see docs/TESTING_MODES.md)

(cd tools/quick-mcp-proxy && npm ci && npm run build && npm test)
(cd infra && npm ci && npm test)
(cd infra/gateway && npm ci && npm test)
(cd connectors && uv run --extra dev pytest)
(cd tools/coa-pack && uv run --extra dev pytest)
```

## Security notes

- `npm run dev` / `npm start` bind `127.0.0.1`. To reach the app from another
  machine, use an SSH port-forward rather than widening the bind.
- The access gate fails closed. Never set `AUTH_LOCAL_BYPASS` on a shared or
  hosted deployment; use the full login gate (`DEMO_USER`, `DEMO_PASS`,
  `AUTH_SECRET`) and put your organisation's identity provider in front of it.
  [`docs/DEPLOY_PUBLIC.md`](docs/DEPLOY_PUBLIC.md) covers hosting.
- Keep `.env.local` out of git (it is gitignored). Store COA passwords and
  other secrets in a secrets manager for anything beyond local use.
- The Quick MCP proxy requires OAuth JWT verification for any non-loopback
  bind. Never register it in Quick with "No authentication".
- Report security issues as described in
  [`CONTRIBUTING.md`](CONTRIBUTING.md#security-issue-notifications).

## Docs

| Doc | What |
|-----|------|
| [`docs/SETUP.md`](docs/SETUP.md) | Full setup for a fresh clone — every config value explained |
| [`docs/MODE3_COA.md`](docs/MODE3_COA.md) | Deploying & connecting a Context Ontology Accelerator |
| [`docs/RUNNING.md`](docs/RUNNING.md) | Detailed run/config reference |
| [`docs/TESTING_MODES.md`](docs/TESTING_MODES.md) | Exercising the three modes |
| [`docs/JDBC_OT_SECURITY_SCENARIO.md`](docs/JDBC_OT_SECURITY_SCENARIO.md) | Adding a live database (JDBC/RDS) as a source — provision, seed, register |
| [`docs/DEPLOY_PUBLIC.md`](docs/DEPLOY_PUBLIC.md) | Hosting the app (e.g. AWS App Runner) |
| [`docs/QUICK_MCP_INTEGRATION.md`](docs/QUICK_MCP_INTEGRATION.md) | Connecting Amazon Quick to COA over MCP (proxy setup, auth, connector, testing) |

The container (`Dockerfile`) uses the official Node.js base image from Docker Hub
(`node:22-bookworm-slim`), pinned to an immutable digest — you build and run it in
your own AWS account.

## Verticals

The header toggle switches between **Cyber**, **Energy**, **OT Sec** and
**Product Quality** (`src/data/verticals.ts`), backed by the OT Security, Energy
Outage and Manufacturing packs in `packs/` with synthetic sample data. Two hero
stories ship with the demo:

- **Security:** *"If a threat group compromises our VPN, what's the blast radius
  through our OT network?"* — actor → technique → CVE → asset.
- **Product Quality:** *"Why the sudden bad reviews on the drill, and which
  supplier lot is the root cause?"* — reviews → returns → component → lot →
  supplier.

## License

This library is licensed under the MIT-0 License. See the [`LICENSE`](LICENSE) file.
Built on the open-source [Context Ontology Accelerator](https://github.com/aws/context-ontology-accelerator).
