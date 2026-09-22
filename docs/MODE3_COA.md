# Mode 3 — Live COA

> How to take the same GroundWork UI from a laptop demo (Modes 1–2) to a real
> Context Ontology Accelerator (COA) deployment on your own AWS account, backed by
> real data and reachable by agents. This is the production on-ramp.
>
> Prereqs and constraints live in `docs/RUNNING.md` §4 and §7. Read the
> deployment constraints before you start — COA is admin-heavy and not free.

Mode 3 flips one env var (`CONTEXT_MODE=coa`) and points the app at a deployed
COA. The UI, graph, query playground, and portal are unchanged; the answers now
resolve over Neptune with governed metrics and Cedar authorization.

> **Status (verified, LIVE).** Mode 3 is deployed and wired end-to-end in
> **us-west-2**, account `<YOUR_AWS_ACCOUNT_ID>`, profile `<your-profile>`, role
> `<YOUR_ADMIN_ROLE>`:
> - **COA platform**: all 16 stacks deployed (`SCL_PREFIX=<your-prefix>`). 15 in
>   us-west-2 + 1 CloudFront-WAF stack in us-east-1. See "us-west-2 deploy —
>   verified specifics" below.
> - **Bedrock half**: real Titan embeddings + real model generation (Claude
>   Sonnet 4.5, Claude Haiku 4.5, Nova Pro, Llama 3.3 70B) all invoked
>   successfully.
> - **COA graph path** (`CONTEXT_MODE=coa`): `CoaProvider` points at the live
>   `COA_BASE_URL`; the `ot-security` pack is installed into namespace `otsec`
>   (15 classes, 30 properties live); a DOCUMENTS source of 366 threat-intel
>   docs (CISA KEV + MITRE ATT&CK ICS + NVD) is registered and ingesting.
>   `describeSchema` / `query` / `graph_traversal` verified live against the
>   deployed endpoint.
>
> Two follow-ups remain, both **data-availability**, not defects: (a) the 6
> governed SQL metrics need a registered JDBC data source (a real OT database) —
> deferred; (b) content answers are thin until the async document extraction
> finishes populating the vector store + KG.

### AWS setup used (verified working)

```bash
# ~/.aws/config
[profile groundwork]
region=us-west-2
credential_process=/Users/<you>/.toolbox/bin/ada credentials print \
  --account <YOUR_AWS_ACCOUNT_ID> --role <YOUR_ADMIN_ROLE> --provider isengard
```

Turn on the two Bedrock flips (no code change):

```bash
AWS_PROFILE=<your-profile> AWS_REGION=us-west-2 \
EMBEDDINGS_BACKEND=titan GENERATION_BACKEND=bedrock \
CONTEXT_MODE=ontology npm run dev     # Mode 2 UI, but real Titan + real model synthesis
```

> **Bedrock lesson (important).** Newer Bedrock models reject raw on-demand
> model IDs with a ValidationException — you must invoke the **`us.` cross-region
> inference-profile IDs** (e.g. `us.amazon.nova-pro-v1:0`,
> `us.anthropic.claude-sonnet-4-5-20250929-v1:0`). The registry in
> `src/lib/models.ts` already uses these. Also: Claude Sonnet 4 is legacy-flagged
> in this account (use 4.5), and Nova's content filters are stricter on
> attack-phrased prompts than Claude's — expect occasional "blocked by content
> filters" from Nova on red-team wording.

The vertical packs and connectors used here are **the ontology-layer**
(`the ontology layer`), vendored into this repo under `packs/`,
`tools/coa-pack/`, and `connectors/`. Nothing is reimplemented — Mode 3 uses them
as intended.

---

## Step 1 — Deploy COA

Follow COA's deploy guide. Expect `AdministratorAccess`, a DataZone/SMUS domain,
an always-on Neptune `db.r8g.large`, OpenSearch Serverless, ECS, and validation
only in `us-east-1`. Adopt an existing VPC with `SCL_VPC_ID`; namespace resources
with `SCL_PREFIX`.

```bash
# in the COA checkout
SCL_VPC_ID=vpc-abc SCL_PREFIX=groundwork make deploy-dev
```

Note the resulting API endpoint — that becomes `COA_BASE_URL`.

## Step 2 — Install a vertical pack into a COA namespace

One vertical → one namespace. The pack's `ontology.ttl` and `metrics.osi.yaml`
(the same files Mode 2 reasons over locally) install into COA:

```bash
export COA_BASE_URL=https://abc123.execute-api.us-east-1.amazonaws.com/prod
export COA_TOKEN=$(your-oidc-token-command)

cd tools/coa-pack
uv run coa-pack install ../../packs/ot-security \
  --namespace otsec --create-namespace --owner you@example.com
# --dry-run validates and prints the plan without calling COA
```

Repeat for `energy-outage` (`--namespace energy`) and `manufacturing`.

## Step 3 — Land real data

**Public feeds → S3 (then register as a COA DOCUMENTS source).** the ontology-layer Python
connectors normalize NVD / CISA KEV / MITRE ATT&CK ICS to Markdown in S3.

> **Create your own bucket first.** Use a globally-unique name you own — include
> your account ID and region so it can't be pre-registered by anyone else, e.g.
> `groundwork-feeds-<your-account-id>-<region>`. S3 bucket names are global;
> a short generic name can be squatted by another account, causing the connector
> to write to a bucket you don't control.

```bash
cd connectors
# use the unique bucket you created and own:
uv run gw-connect all --bucket <your-unique-feeds-bucket> --ics-only
# --dry-run fetches and renders without writing (no AWS creds needed)
```

Register the parent prefix once as a COA `DOCUMENTS` source and every feed shows
up under it. COA's Scan stage handles ingestion, chunking, and KG build.

**Structured data (asset registries, CMDB, work orders) → PostgreSQL/Glue.**
COA supports `JDBC_DATABASE` and `GLUE_DATABASE` sources natively — register your
Postgres/Redshift/Athena source in COA; no custom connector needed. (Cross-account
data needs manual Lake Formation wiring — see docs/RUNNING.md.)

## Step 4 — Point GroundWork at COA

```bash
# .env.local
CONTEXT_MODE=coa
COA_BASE_URL=https://abc123.execute-api.us-east-1.amazonaws.com/prod
COA_TOKEN=your-oidc-or-gateway-token
# optional namespace overrides if you didn't use the default names:
# COA_NAMESPACE_OTSEC=otsec
```

`npm run dev`. The fidelity badge now reads **Live COA**. The `CoaProvider`
(`src/lib/context/coa-provider.ts`) maps the app's calls onto COA's six query
operations. Those operations are exposed **both** as MCP tools (for agents, via
the AgentCore MCP runtime) **and** as plain REST on COA's Serve / Data-Layer
surface (Smithy `DataLayerService`). GroundWork uses the **REST surface** —
which is served by the *same* API Gateway as the control plane, so one
`COA_BASE_URL` covers everything:

| GroundWork call | COA operation | REST route (on `COA_BASE_URL`) |
|---|---|---|
| `query(…, "graph")` | `query` (tiered: metric → SPARQL → agentic) | `POST /namespaces/{ns}/query` |
| `query(…, "vector")` | `rag_retrieval` | `POST /namespaces/{ns}/kb/search` |
| `traverse` | `graph_traversal` | `POST /namespaces/{ns}/graph/traverse` |
| `listMetrics` | `list_metrics` | `GET  /namespaces/{ns}/metrics` |
| `computeMetric` | `query` (Tier-1 governed metric, no LLM) | `POST /namespaces/{ns}/query` |
| `describeSchema` | `describe_schema` | `GET  /namespaces/{ns}/schema` |

All wire calls go through one method, `CoaProvider.callTool()`, which holds the
route map above. If a deployment fronts the query surface differently (e.g. only
the AgentCore MCP gateway, no REST), that one method is the only thing to adapt.

### Query transport: REST (default) vs AgentCore SSE (no 29s cap)

The REST routes above are served by COA's **API Gateway**, whose Lambda-proxy
integration has a hard **~29s** response cap. COA's Tier-3 graph synthesis
routinely runs 20-90s, so a graph `query` over REST intermittently returns a
**504** at the gateway even though serve itself allows ~170s
(`RESOLVE_TIMEOUT_S`). This is the single most common source of "the graph panel
timed out" in a live demo.

COA exposes the *same* query over its **Bedrock AgentCore Runtime** endpoint,
which is a **different host** (not behind that API Gateway) and streams the
answer back over SSE — so the 29s ceiling does not apply. GroundWork can send
just the slow `query` call over that path via a transport switch:

```bash
# .env.local — opt in to the timeout-free query transport
COA_TRANSPORT=agentcore
# The serve runtime ARN. On a COA deployment it's in SSM at
# /<your-coa-prefix>/serve/runtime-arn, e.g.:
#   aws ssm get-parameter --name /my-coa-dev/serve/runtime-arn \
#     --query Parameter.Value --output text
COA_SERVE_RUNTIME_ARN=arn:aws:bedrock-agentcore:us-west-2:<account>:runtime/<id>
```

How it works (`src/lib/context/coa-agentcore.ts`, wired into `callTool()`):

- **Only the `query` tool** takes the AgentCore path. The fast tools
  (`list_metrics`, `describe_schema`, `graph_traversal`, `kb/search`) return well
  under 29s, so they stay on REST — no reason to change them.
- **Endpoint:** `https://bedrock-agentcore.{region}.amazonaws.com/runtimes/{urlEncodedRuntimeArn}/invocations?qualifier=DEFAULT` (region-format-validated to prevent URL injection from a tampered ARN).
- **Auth:** the *same* Cognito **ID token** the REST path already mints
  (`coa-token.ts`). AgentCore validates the token audience and Cedar reads the
  email/groups claims. Programmatic `USER_PASSWORD_AUTH` is enabled on the
  default app client in COA **dev** environments; a machine-to-machine/agent auth
  path is on COA's roadmap for prod-like environments.
- **Session id:** the required `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id`
  header (≥33 chars) is derived injectively from the token `sub` so a user's
  requests stick to one session without two users ever colliding.
- **SSE parsing:** AgentCore frames each event as `data: {json}`; the event type
  is a `type` field *inside* the JSON (`step`/`token`/`done`/`error`), **not** the
  SSE `event:` field. The consumer reads to the terminal frame and returns
  `done.payload.result` — the exact `{ result: QueryResult }` shape the REST path
  returns, so nothing downstream changes.
- **Graceful fallback:** if `COA_SERVE_RUNTIME_ARN` is unset, the token is
  missing, or the AgentCore call fails, `callTool()` logs and **falls back to the
  REST path**. So enabling the flag can only help; a misconfiguration degrades to
  today's behaviour rather than breaking.

**Default stays `rest`** for portability — a customer cloning the sample gets the
simple one-URL setup and opts into AgentCore only if they hit the 29s wall.

## Step 5 — Let agents ask too (AgentCore Gateway)

the ontology-layer Gateway CDK (`infra/gateway/`) fronts COA's MCP server as an `mcpServer`
target so a customer's *existing* agents can call the same tools GroundWork does.

```bash
cd infra/gateway
npx cdk deploy
```

⚠️ **The M2M auth caveat (docs/RUNNING.md).** COA has no machine-to-machine
credentials — agents act three-legged on behalf of a human. Autonomous agents
therefore need the Gateway's **on-behalf-of token-exchange** pattern wired to the
customer's IdP. The Gateway supports three inbound modes (`NONE`+passthrough for
experimentation, JWT client-credentials, `AUTHENTICATE_ONLY`+Cedar); start with
passthrough to prove the path, move to on-behalf-of before any pilot. Do not claim
autonomous-agent access in a demo until this is wired.

---

## The demo climb (lead engineer at a client visit)

1. `npm install && npm run dev` → **Demo data** → walk the VOLTZITE blast-radius
   story. Zero AWS. (~5 min)
2. `CONTEXT_MODE=ontology` → **Local ontology** → same UI, now the real OWL packs
   and transitive reasoning. Still laptop. (~2 min)
3. On the client account: deploy COA once, `coa-pack install`, land data,
   `CONTEXT_MODE=coa` → **Live COA** → same UI over their Neptune graph, agents via
   Gateway.

Same repo, same UI, three fidelity levels.

---

## us-west-2 deploy — verified specifics

Everything below was learned deploying COA `v0.2.1` to a us-west-2 account
(`SCL_PREFIX=<your-prefix>`, profile `<your-profile>`, role `<YOUR_ADMIN_ROLE>`).
COA upstream only *validates* us-east-1; us-west-2 works, with the caveats here.

### Toolchain (via mise, no Docker)

- Node 22, Java 17 (temurin), pnpm 10, Python 3.12, `uv` — pinned with `mise` and
  scoped to the COA checkout via a `mise.toml`. Run COA commands through
  `mise exec -- …`.
- **Docker is disallowed at Amazon — use Finch.** COA's preflight auto-detects
  Finch and exports `CDK_DOCKER=finch`. Finch VM must be running
  (`finch vm status` → Running). A belt-and-suspenders `docker`→`finch` shim on
  `PATH` also works if any script calls `docker` directly.

### Deploy from a space-free path

The workspace path contains a space (`.../Kiro Apps/groundwork`). COA's Lambda
bundling (`cp -r` + Finch volume mounts) does **not** quote paths, so local
bundling and the Finch fallback both fail from a spaced path
(`unsupported volume option "delegated"`, `cp: …-building: Not a directory`).
**Fix:** deploy from a space-free copy, e.g. `~/coa-deploy/coa`
(`rsync -a --exclude node_modules --exclude 'cdk.out*' --exclude .venv …`). Bundling
then works: esbuild for Node Lambdas, Finch container builds for the Python/ML
Lambdas (torch, `unstructured`, spacy, llama-index, `owlready2`/`rdflib` VKG,
poppler), all pushed to ECR.

### CDK: use the pinned binary, not `npx cdk`

`npx cdk` hangs trying to download a newer CDK on an interactive prompt. Use COA's
pinned local binary: `infra/node_modules/.bin/cdk` (2.1127.0). `deploy.sh` uses
`pnpm --filter coa-infra exec cdk …`, which resolves to the same pinned binary.

### Bootstrap BOTH regions

`cdk bootstrap` us-west-2 **and** us-east-1. The `edge-waf` stack is a
CloudFront-scope WAFv2 WebACL, which can only be created in **us-east-1**, so CDK
deploys that one stack cross-region. Without a us-east-1 bootstrap the deploy fails
partway through with `SSM /cdk-bootstrap/hnb659fds/version not found`.

```bash
node_modules/.bin/cdk bootstrap aws://<YOUR_AWS_ACCOUNT_ID>/us-west-2
node_modules/.bin/cdk bootstrap aws://<YOUR_AWS_ACCOUNT_ID>/us-east-1
```

### SMUS / DataZone admin principal

Set `SCL_SMUS_ADMIN_ARNS` explicitly to the IAM role(s) humans federate into —
here the Isengard `*_admin` roles:

```bash
export SCL_SMUS_ADMIN_ARNS=arn:aws:iam::<YOUR_AWS_ACCOUNT_ID>:role/<YOUR_ADMIN_ROLE>
```

If unset, `deploy.sh` falls back to an IAM role literally named `Admin` (an
Isengard-account convention). The fallback deploys, but only that role can admin
the DataZone/SMUS portal — set the ARNs so the real operators can.

### Clean stray synth output before deploy

A leftover `infra/cdk.out.*` directory from an earlier manual synth breaks the NX
build with `MultipleProjectsWithSameNameError` (NX walks the bundled asset copies
and sees each project defined many times). Remove stray `cdk.out*` dirs, then
`pnpm nx reset`.

### The full deploy command (background + poll)

No `timeout` on PATH — run long commands as a background PID + sleep-poll loop.

```bash
cd ~/coa-deploy/coa
export PATH="/opt/homebrew/bin:$HOME/.groundwork-shims:$PATH"
export AWS_PROFILE=<your-profile> AWS_DEFAULT_REGION=us-west-2 CDK_DEFAULT_REGION=us-west-2
export SCL_PREFIX=<your-prefix> CDK_DOCKER=finch
export SCL_SMUS_ADMIN_ARNS=arn:aws:iam::<YOUR_AWS_ACCOUNT_ID>:role/<YOUR_ADMIN_ROLE>
nohup mise exec -- make deploy-dev > /tmp/coa_deploy.log 2>&1 &
```

~56 min, 16 stacks. Two Bedrock AgentCore runtimes (serve + mcp) each take
~5 min to reach ACTIVE (CloudFormation blocks on eventual consistency — normal).

### Authentication — mint a real user OIDC token

COA has **no machine-to-machine credentials**: every control-plane and query call
needs a real user's OIDC bearer token. The deployed UI client
(`AllowedOAuthFlows: code`) also has `ALLOW_USER_PASSWORD_AUTH` and no client
secret, so you can mint a token headlessly:

```bash
# one-time: a user in the pool, with a permanent password, in the Admin group
aws cognito-idp admin-create-user --user-pool-id <YOUR_COGNITO_USER_POOL_ID> \
  --username you@amazon.com --message-action SUPPRESS \
  --user-attributes Name=email,Value=you@amazon.com Name=email_verified,Value=true
aws cognito-idp admin-set-user-password --user-pool-id <YOUR_COGNITO_USER_POOL_ID> \
  --username you@amazon.com --password '<no-shell-special-chars>' --permanent
aws cognito-idp admin-add-user-to-group --user-pool-id <YOUR_COGNITO_USER_POOL_ID> \
  --username you@amazon.com --group-name Admin      # REQUIRED — see below

# mint (repeat when the ~1h token expires)
aws cognito-idp initiate-auth --auth-flow USER_PASSWORD_AUTH \
  --client-id <YOUR_COGNITO_CLIENT_ID> \
  --auth-parameters USERNAME=you@amazon.com,PASSWORD='<pw>' \
  --query AuthenticationResult.IdToken --output text
```

Use the **IdToken** (`token_use: id`, `aud` = client id) as `COA_TOKEN`.

- **The `Admin` Cognito group is required for control-plane writes.** Without it,
  `GET /namespaces/{id}` and `POST /namespaces` return `403 explicit deny` (an
  API-Gateway-authorizer deny, not app RBAC). `GET /namespaces` (list) works
  regardless, which is a misleading first smoke test.
- Avoid shell-special characters (`!`, `#`) in the password — zsh history
  expansion silently mangles the command otherwise.

### WAF exception for OSI metric import

The API Gateway sits behind a regional WAFv2 WebACL (`ApiWafResource-…`) whose
`AWSManagedRulesCommonRuleSet` blocks `POST /namespaces/{ns}/import-osi`: the OSI
body contains legitimate SQL (`COUNT(DISTINCT …)`) that the managed rules read as
injection, returning `403 ForbiddenException` from CloudFront. **Fix (scoped):** a
terminating `Allow` rule at priority 0 matching `POST` + `UriPath ENDS_WITH
/import-osi`, so only that path bypasses body inspection; everything else keeps
full WAF coverage.

```bash
# find the API's regional WebACL, then add a scoped Allow rule (priority 0):
aws wafv2 list-web-acls --scope REGIONAL --region us-west-2
# rule statement: AndStatement[ ByteMatch(UriPath ENDS_WITH "/import-osi"),
#                                ByteMatch(Method EXACTLY "POST") ], Action: Allow
```

> This modifies the deployment's security posture. It is deliberately narrow
> (one path, POST only) and is the correct operator fix — COA's own control plane
> accepts SQL-bearing OSI specs, but the WAF it ships blocks them.

### Governed metrics need a registered data source

The `ot-security` pack ships `metrics.osi.yaml` with 6 SQL metrics whose datasets
bind to `data_source_id: ds-ot-inventory`. COA resolves datasets before creating
metrics, so importing them **without a registered JDBC source** returns a job with
`datasetsResolved: 0`, `metricsProcessed: 0` (no per-metric error). This is
expected when `sources.yaml` is still a template (no live OT database). The
ontology installs regardless; metrics come online once the source is registered
and `coa-pack install` is re-run.

### `coa-pack` client fixes made for this deploy

`tools/coa-pack` is ours; three robustness fixes were needed against a real
us-west-2 COA (all covered by the tool's tests):

1. **S3 presigned-PUT 307.** COA presigns ontology uploads against the *global*
   S3 endpoint (`<bucket>.s3.amazonaws.com`). A us-west-2 bucket answers the first
   PUT with `307 TemporaryRedirect` and drops the body, so ingest later fails with
   `NoSuchKey`. `put_presigned` now follows the 307 to the regional host named in
   the S3 `<Endpoint>` (the SigV2 signature is not host-bound).
2. **Namespace create 409.** DataZone-backed namespaces are eventually
   consistent — `GET /namespaces/{id}` can 404 while `POST /namespaces` 409s
   "already exists". Create now tolerates 409 and reuses the namespace.
3. **Async ontology conflict.** An "ontology already exists" conflict can surface
   as an async job failure (`202` then job `failed` with a conflict message), not
   only a sync 409. Treated as an idempotent skip.
4. **Metric-import as warning.** A metric-import job that fails with
   `metricsProcessed: 0` and no errors (the "no data source" case above) is
   downgraded to a warning so the ontology install still succeeds.

### Async document ingestion

Registering a `DOCUMENTS` source returns `201 REGISTERED` immediately, but COA's
extraction (chunking → embeddings → KG propositions) runs asynchronously and takes
a while. Right after registration, `query`/`kb/search` legitimately return
"no context retrieved" even though the schema is live. Give the Scan/extraction
pipeline time before judging answer quality.

### One-namespace-per-vertical, addressed by name or UUID

Most endpoints accept the namespace **name** (`otsec`); the `sources` endpoint
requires the namespace **UUID**. Get the UUID from `GET /namespaces`.
