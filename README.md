# ContextForge

An open-source **context-engineering** layer for security and operations. Point
it at messy sources — threat reports, advisories, CVEs, SBOMs, reviews, returns,
purchase orders — and it builds a governed knowledge graph you can query. Vector
search finds *similar* chunks; a graph finds *connected* knowledge. In security,
that's the difference between an alert and an investigation; in product quality,
between a complaint and a root cause.

Clone it, run it in your own AWS account, pick your model, ask across all your
sources.

> **Sample code — not production-ready.** ContextForge is a demonstration
> sample. It ships with demo-grade defaults (e.g. the local login is
> unauthenticated by default, sample data is synthetic) and is intended for
> learning and evaluation, not production use. Review and harden authentication,
> authorization, secrets management, logging, and data handling for your own
> environment before any production deployment. See [`docs/SETUP.md`](docs/SETUP.md)
> for locking down the login gate and configuring real credentials.

## Quick start (no AWS needed)

```bash
npm install
npm run db:seed        # load the SQLite seed data (required on a fresh clone)
npm run dev            # http://localhost:3000
```

That's **Mode 1** — the demo runs on local SQLite seed data and boots in seconds.
Open http://localhost:3000, and log in with any email/password (the local login
is unauthenticated by default; see `docs/SETUP.md` to lock it down).

## Progressive fidelity — one UI, three modes

The same UI runs at three fidelities, selected by the `CONTEXT_MODE` env var. You
climb the ladder nothing is thrown away. An on-screen badge always shows which
level is live.

| Mode | `CONTEXT_MODE` | What it is | AWS? |
|------|----------------|-----------|------|
| 1 · Demo | `mock` (default) | SQLite seed data | none |
| 2 · Local Ontology | `ontology` | Real OWL reasoning from the vertical packs + real local vector retrieval + citations + model picker | none |
| 3 · Live COA | `coa` | Real graph over a deployed [Context Ontology Accelerator](https://github.com/aws/context-ontology-accelerator) (Neptune, governed metrics, Cedar) | yes |

Two env flips light up real AWS with no code change (see `.env.example`):

- `EMBEDDINGS_BACKEND=titan` — real Titan embeddings for the vector path
- `GENERATION_BACKEND=bedrock` — real Bedrock model generation for graph answers

```bash
# Mode 2, still no AWS
CONTEXT_MODE=ontology npm run dev

# Mode 2 UI with REAL Bedrock (Titan + model generation)
AWS_PROFILE=<your-profile> AWS_REGION=<your-region> \
EMBEDDINGS_BACKEND=titan GENERATION_BACKEND=bedrock \
CONTEXT_MODE=ontology npm run dev
```

## Configuration & Mode 3 (Live COA)

Mode 3 runs against a **[Context Ontology Accelerator](https://github.com/aws/context-ontology-accelerator)**
you deploy into **your own** AWS account. ContextForge is model- and
account-agnostic: you supply your COA endpoint, your Cognito credentials, and
your namespace IDs — nothing is hardcoded.

**See [`docs/SETUP.md`](docs/SETUP.md) for the complete, step-by-step setup** —
every value you need to provide, where to get it, and how to wire `.env.local`.
The short version:

```bash
cp .env.example .env.local     # then fill in your own values
npm run demo:coa               # mints a token & launches in Mode 3
npm run demo:preflight         # checks all three modes are ready
```

## How it's built

Everything flows through one `ContextProvider` interface (`src/lib/context/`),
with three implementations — one per mode. The UI never knows which is active.

- `src/lib/context/` — the provider seam (`local-mock`, `local-ontology`, `coa`)
- `src/lib/embeddings.ts`, `src/lib/models.ts`, `src/lib/synthesize.ts` — vector + model layer
- `packs/` — the vertical OWL ontologies + governed metrics (drive Mode 2, install into COA for Mode 3)
- `tools/coa-pack/`, `connectors/`, `infra/` — COA pack installer, feed connectors, infrastructure
- `src/app/console/` — the operator UI; `src/app/portal/` — the customer portal

## Docs

| Doc | What |
|-----|------|
| [`docs/SETUP.md`](docs/SETUP.md) | Full setup for a fresh clone — every config value explained |
| [`docs/MODE3_COA.md`](docs/MODE3_COA.md) | Deploying & connecting a Context Ontology Accelerator |
| [`docs/RUNNING.md`](docs/RUNNING.md) | Detailed run/config reference |
| [`docs/TESTING_MODES.md`](docs/TESTING_MODES.md) | Exercising the three modes |
| [`docs/DEPLOY_PUBLIC.md`](docs/DEPLOY_PUBLIC.md) | Hosting the app (e.g. AWS App Runner) |

The container (`Dockerfile`) uses the official Node.js base image from Docker Hub
(`node:22-bookworm-slim`), pinned to an immutable digest — you build and run it in
your own AWS account.

## Verticals

OT Security, Energy Outage, Manufacturing, and Product Quality — each a real OWL
ontology in `packs/` with synthetic sample data in `connectors/sample-data/`. Two
hero stories ship with the demo:

- **Security:** *"If a threat group compromises our VPN, what's the blast radius
  through our OT network?"* — actor → technique → CVE → asset.
- **Product Quality:** *"Why the sudden bad reviews on the drill, and which
  supplier lot is the root cause?"* — reviews → returns → component → lot →
  supplier.

## License

Released under the MIT-0 (MIT No Attribution) License — see [`LICENSE`](LICENSE).
Built on the open-source [Context Ontology Accelerator](https://github.com/aws/context-ontology-accelerator).
