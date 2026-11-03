# Connecting Amazon Quick to GroundWork's COA context (MCP)

GroundWork ships a small **remote MCP server**, `tools/quick-mcp-proxy`, that lets
[Amazon Quick](https://docs.aws.amazon.com/quick/latest/userguide/mcp-integration.html)
ask questions of the same [Context Ontology Accelerator](https://github.com/aws/context-ontology-accelerator)
(COA) knowledge graph that GroundWork's Mode 3 uses. Quick connects as an MCP
client, calls one tool, and shows COA's graph-grounded answer and evidence trail in
chat.

This guide covers running the proxy locally, securing it, registering it in Quick,
and testing it. For a container deployment walkthrough,
see [`tools/quick-mcp-proxy/DEPLOY.md`](../tools/quick-mcp-proxy/DEPLOY.md).

> **Sample code.** Like the rest of GroundWork, the proxy is a demonstration sample.
> Review authentication, authorization, logging, and data handling for your
> environment before you connect it to anything sensitive.

---

## How it works

```
Amazon Quick ──(HTTPS, Bearer access token)──▶ quick-mcp-proxy ──(COA user token)──▶ COA
   MCP client      OAuth client_credentials        /mcp endpoint       minted server-side
```

- **One tool:** `context_query(question, namespace?)`. `namespace` defaults to
  `COA_DEFAULT_NAMESPACE`. The answer comes back as Markdown: the synthesized answer,
  the source documents it cites, and a line with COA tier, confidence, namespace, and
  whether it was live or served from the hero-answer cache.
- **Transport:** MCP Streamable HTTP, stateless, on a single path (`/mcp` by default).
  Quick prefers HTTP streaming and does not support local stdio servers
  ([Quick MCP docs](https://docs.aws.amazon.com/quick/latest/userguide/mcp-integration.html)).
- **Inbound auth (Quick → proxy):** Quick's *Service authentication* is the OAuth 2.0
  client_credentials flow. Quick gets an access token from your IdP's token URL and sends
  it as `Authorization: Bearer <jwt>`. The proxy verifies that JWT against your issuer's
  JWKS. If no auth is configured, every `/mcp` request is rejected.
- **Outbound auth (proxy → COA):** the proxy mints COA's Cognito user token itself
  (`COA_CLIENT_ID` / `COA_USER` / `COA_PASS`) or uses a static `COA_TOKEN`. Quick never
  sees a COA credential.
- **Bind:** the proxy listens on `127.0.0.1` unless you set `BIND_HOST`. It refuses to
  start on a non-loopback address unless OAuth verification is configured.

Endpoints:

| Path | Auth | Response |
|---|---|---|
| `GET /health` | none | `200 {"ok":true}` (liveness only, no config details) |
| `POST /mcp` (or your `MCP_PATH`) | Bearer token required | MCP JSON-RPC over Streamable HTTP |
| anything else | n/a | `404` |

Unauthenticated `/mcp` requests get `401 {"error":"unauthorized"}` with
`WWW-Authenticate: Bearer realm="groundwork-coa-proxy"`. Request bodies over 1 MiB get
`413`.

---

## Prerequisites

| For | You need |
|---|---|
| Running the proxy | Node 20+ and npm |
| Live answers | A deployed COA (see [`MODE3_COA.md`](MODE3_COA.md)) and its endpoint + Cognito user credentials (the same values GroundWork Mode 3 uses) |
| Connecting Quick | An Amazon Quick Enterprise subscription ([Quick MCP prerequisites](https://docs.aws.amazon.com/quick/latest/userguide/mcp-integration.html)) |
| Quick's Service authentication | An OAuth 2.0 authorization server that issues client_credentials access tokens as signed JWTs, for example an [Amazon Cognito user pool with a resource server and an M2M app client](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-resource-servers.html) |
| Reaching the proxy from Quick | An HTTPS endpoint Quick can reach: public internet, or private through a [Quick VPC connection](https://docs.aws.amazon.com/quick/latest/userguide/mcp-integration.html) |

A proxy running on your laptop at `127.0.0.1` is for local testing only. Quick runs in
AWS and cannot reach your loopback interface; for Quick you deploy the proxy behind HTTPS
(see [Security notes](#security-notes)).

---

## Configuration

The proxy reads its configuration from environment variables. Placeholders for all of
them are in the root [`.env.example`](../.env.example) under *Amazon Quick MCP proxy*.
The proxy does not load `.env` files itself; export the variables in your shell, or use
Node's `--env-file` (for example `node --env-file=.env.quick dist/server.js`). Keep any
file holding real values out of git.

### Network

| Variable | Default | Purpose |
|---|---|---|
| `BIND_HOST` | `127.0.0.1` | Interface to listen on. A non-loopback value requires `QUICK_OAUTH_ISSUER`. The container image sets `0.0.0.0` inside the container. |
| `PORT` | `8787` (`8080` in the container) | Listen port. |
| `MCP_PATH` | `/mcp` | Path of the MCP endpoint. |

### Inbound auth (Quick → proxy)

| Variable | Purpose |
|---|---|
| `QUICK_OAUTH_ISSUER` | Expected `iss` of access tokens. For Cognito: `https://cognito-idp.<region>.amazonaws.com/<user-pool-id>`. Setting this turns on JWT verification. |
| `QUICK_OAUTH_CLIENT_IDS` | Comma-separated allowed `client_id` (or `azp`) values: the app client Quick uses. Cognito client_credentials tokens carry `client_id` and no `aud`, so use this for Cognito. |
| `QUICK_OAUTH_AUDIENCE` | Comma-separated allowed `aud` values, for IdPs that set an audience. At least one of `QUICK_OAUTH_CLIENT_IDS` / `QUICK_OAUTH_AUDIENCE` is required when the issuer is set, otherwise the proxy won't start. |
| `QUICK_OAUTH_REQUIRED_SCOPE` | Scope the token must carry, e.g. `<resource-server-id>/query`. Recommended. |
| `QUICK_OAUTH_JWKS_URL` | Override the key set URL. Default: `<issuer>/.well-known/jwks.json` (Cognito's location). |
| `QUICK_INBOUND_TOKENS` | **Local testing only.** Comma-separated bearer values accepted when the proxy is bound to loopback (compared in constant time). Ignored on any other bind. Not a substitute for OAuth. |

The verifier accepts only asymmetric signatures (RS/PS/ES/EdDSA), checks `iss`, `exp`, and
`nbf` (5 s clock tolerance), rejects Cognito ID tokens (`token_use` must be `access` when
present), and enforces the client-id/audience allowlist and the scope.

### Outbound (proxy → COA)

| Variable | Default | Purpose |
|---|---|---|
| `COA_BASE_URL` | (required) | COA API base URL, same as GroundWork's. The proxy won't start without it. |
| `COA_DEFAULT_NAMESPACE` | `prodquality` | Namespace used when the caller omits one. COA resolves namespaces by UUID, so set your namespace UUID for live queries. |
| `COA_CLIENT_ID` / `COA_USER` / `COA_PASS` | | Cognito app client + user the proxy uses to mint COA's ID token (refreshed automatically). |
| `COA_TOKEN` | | Static COA token instead of minting (expires; for short tests). |
| `AWS_REGION` | `us-west-2` | Cognito / AgentCore region for COA. |
| `COA_TRANSPORT` | `rest` | `agentcore` sends `query` over COA's AgentCore Runtime SSE endpoint (avoids API Gateway's ~29 s cap), falling back to REST on failure. Needs `COA_SERVE_RUNTIME_ARN`. |
| `COA_SERVE_RUNTIME_ARN` | | COA serve runtime ARN (from your COA deployment). |
| `COA_QUERY_TIMEOUT_MS` | `240000` | Hard timeout for a COA query. Quick's MCP operations time out at 5 minutes. |
| `COA_CACHE_DIR` | | Directory of pre-captured hero answers (`<vertical>.json`). Point it at `src/data/coa-cache` to reuse GroundWork's. Matching questions return instantly and are tagged as cached. |
| `COA_NAMESPACE_<VERTICAL>` | | Optional `<uuid>` per vertical (e.g. `COA_NAMESPACE_PRODQUALITY`), same as GroundWork. Lets a UUID namespace find its `<vertical>.json` cache file. |

---

## Run the proxy locally (loopback)

From the repo root:

```bash
cd tools/quick-mcp-proxy
npm ci
npm run build
npm test                         # auth unit tests, no network needed
```

### Option 1: cache only (no COA, no AWS)

Good for checking the MCP plumbing. `COA_BASE_URL` must be set but is not called for
cached questions.

```bash
export COA_BASE_URL=http://unused.local COA_TOKEN=unused
export COA_CACHE_DIR="$(cd ../../src/data/coa-cache && pwd)"
export QUICK_INBOUND_TOKEN="$(openssl rand -hex 32)"     # local test credential
export QUICK_INBOUND_TOKENS="$QUICK_INBOUND_TOKEN"
PORT=8787 npm start
```

You should see:

```
quick-mcp-proxy listening on http://127.0.0.1:8787/mcp
  ...
  inbound auth  : local-test token x1 (loopback only)
```

In a second shell (same `QUICK_INBOUND_TOKEN` exported):

```bash
npm run smoke      # initialize → tools/list → tools/call on a cached hero question
```

### Option 2: live COA

```bash
export COA_BASE_URL=https://<your-api-id>.execute-api.<region>.amazonaws.com/prod
export COA_CLIENT_ID=<your-cognito-app-client-id> COA_USER=<you@example.com>
export COA_PASS=<your-cognito-user-password>   # better: read from a secrets manager
export AWS_REGION=<region> COA_DEFAULT_NAMESPACE=<your-namespace-uuid>
export QUICK_INBOUND_TOKENS="$(openssl rand -hex 32)"
npm start
```

Questions not in the cache run live against COA (typically tens of seconds for graph
synthesis).

If you start the proxy with no inbound auth at all, it still starts and logs
`inbound auth : NOT CONFIGURED — every /mcp request is rejected (fail closed)`.

---

## Test it

With the proxy running on `127.0.0.1:8787`:

```bash
# Liveness (no auth)
curl -s http://127.0.0.1:8787/health
# {"ok":true}

# Unauthenticated MCP call → rejected
curl -s -i -X POST http://127.0.0.1:8787/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
# HTTP/1.1 401 Unauthorized
# www-authenticate: Bearer realm="groundwork-coa-proxy"
# {"error":"unauthorized"}

# Authenticated MCP call → tool list
curl -s -X POST http://127.0.0.1:8787/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H "authorization: Bearer $QUICK_INBOUND_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
# event: message
# data: {"result":{"tools":[{"name":"context_query",...}]},"jsonrpc":"2.0","id":1}
```

The MCP client must accept both `application/json` and `text/event-stream`; the
response comes back as a server-sent event.

To test a deployed proxy with real OAuth, get an access token from your token URL with
the same client Quick will use, then call `/mcp` with it:

```bash
TOKEN=$(curl -s -u "<client-id>:<client-secret>" \
  -d 'grant_type=client_credentials&scope=<resource-server-id>/query' \
  https://<your-domain>.auth.<region>.amazoncognito.com/oauth2/token | jq -r .access_token)
PROXY_URL=https://<proxy-host>/mcp QUICK_INBOUND_TOKEN="$TOKEN" npm run smoke
```

(See Cognito's [token endpoint](https://docs.aws.amazon.com/cognito/latest/developerguide/token-endpoint.html)
reference for the request format.)

---

## Set up OAuth for Quick (Amazon Cognito example)

Any OAuth 2.0 IdP that issues JWT access tokens for the client_credentials grant works.
With Amazon Cognito (see
[Scopes, M2M, and resource servers](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-resource-servers.html)
and [OAuth 2.0 grants](https://docs.aws.amazon.com/cognito/latest/developerguide/federation-endpoints-oauth-grants.html)):

1. Use a user pool with a domain (for the `/oauth2/token` endpoint). This can be a
   dedicated pool; it does not need to be COA's.
2. Create a **resource server** (identifier e.g. `groundwork-coa`) with a custom scope
   (e.g. `query`). The full scope string is `groundwork-coa/query`.
3. Create an **app client with a client secret**, allow the **client credentials** grant,
   and allow the `groundwork-coa/query` scope. Cognito does not allow client credentials
   on the same app client as authorization code or implicit grants.
4. Configure the proxy:

   ```bash
   QUICK_OAUTH_ISSUER=https://cognito-idp.<region>.amazonaws.com/<user-pool-id>
   QUICK_OAUTH_CLIENT_IDS=<quick-app-client-id>
   QUICK_OAUTH_REQUIRED_SCOPE=groundwork-coa/query
   ```

5. Keep the client secret for Quick's connector setup. Store it in a secrets manager,
   not in git.

---

## Register the MCP server in Amazon Quick

These steps follow the
[Amazon Quick MCP integration guide](https://docs.aws.amazon.com/quick/latest/userguide/mcp-integration.html);
check it for the current console flow.

1. Deploy the proxy behind an HTTPS endpoint Quick can reach, with OAuth configured (see
   [`DEPLOY.md`](../tools/quick-mcp-proxy/DEPLOY.md) and [Security notes](#security-notes)).
2. In the Amazon Quick console, choose **Connectors**, then the **Create for your team**
   tab, then **Model Context Protocol (MCP)**.
3. Enter the integration details:
   - **Name** / **Description**: e.g. "GroundWork COA context".
   - **MCP server endpoint**: `https://<proxy-host>/mcp`
   - **Connection type**: **Public network** for an internet-facing HTTPS endpoint, or a
     **named VPC connection** for a private one.
   - **Auth server connection type**: **Public network** if your token URL is on the
     internet (Cognito's is), otherwise the VPC connection that reaches your IdP.
4. Choose **Next**, select **Service authentication (Service-to-Service)**, and enter:
   - **Client ID**: the app client ID from step 3 above.
   - **Client Secret**: its secret.
   - **Token URL**: e.g. `https://<your-domain>.auth.<region>.amazoncognito.com/oauth2/token`.
5. Choose **Create and continue**, review, and share the integration if needed.
6. Quick discovers `context_query` and registers it as an action. Ask in chat, for
   example: *"Which cell lot and supplier are the root cause of the cold-weather battery
   failures on the VoltCore drill?"*

Do not pick **No authentication** for this proxy. It is gated by design, so Quick's
calls would get `401`, and an ungated proxy would let anyone who finds the URL spend your
COA credentials.

If you change the tool definitions later, custom MCP connectors don't pick that up
automatically. Open the connector and choose **Sync** (see *MCP Sync* in the Quick docs).

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `Missing required env var: COA_BASE_URL` at startup | Set `COA_BASE_URL` (any placeholder URL works for cache-only testing). |
| `BIND_HOST=… is not loopback and QUICK_OAUTH_ISSUER is not set — refusing to start` | Expected. Configure OAuth or bind to `127.0.0.1`. |
| `QUICK_OAUTH_ISSUER is set but neither QUICK_OAUTH_CLIENT_IDS nor QUICK_OAUTH_AUDIENCE is` | Add the Quick app client ID to `QUICK_OAUTH_CLIENT_IDS`. |
| `401 unauthorized` with a local token | The proxy isn't on loopback (local tokens are ignored elsewhere), the header isn't `Authorization: Bearer <token>`, or the value differs from `QUICK_INBOUND_TOKENS`. |
| `401 unauthorized` with an OAuth token | Decode the token (header + payload only) and check: `iss` equals `QUICK_OAUTH_ISSUER` exactly (no trailing slash); `client_id` is in `QUICK_OAUTH_CLIENT_IDS` (or `aud` in `QUICK_OAUTH_AUDIENCE`); `scope` contains `QUICK_OAUTH_REQUIRED_SCOPE`; it's an access token, not an ID token; it hasn't expired; the proxy can reach the JWKS URL. |
| `406` / "Not Acceptable" from `/mcp` | The client must send `Accept: application/json, text/event-stream`. |
| Quick connector creation fails, or token requests fail | Check the token URL, client ID/secret, and scopes. Quick determines scopes from OAuth protected-resource metadata, and this proxy doesn't publish that metadata; Quick may then apply default scopes. See *Limitations* and *Troubleshooting* in the [Quick MCP docs](https://docs.aws.amazon.com/quick/latest/userguide/mcp-integration.html). |
| Connector passes discovery but fails at publish | Quick validates each tool's `inputSchema` against JSON Schema Draft 7. The proxy's schema uses a root-level `required` array; if you add tools, keep that format (see the Quick docs). |
| Tool returns `COA query failed: 401/403 …` | COA token problem: check `COA_CLIENT_ID` / `COA_USER` / `COA_PASS` (the app client must allow `USER_PASSWORD_AUTH`), or replace an expired `COA_TOKEN`. |
| Tool returns `COA query exceeded …ms` or a `504` | Long graph synthesis. Try `COA_TRANSPORT=agentcore` with `COA_SERVE_RUNTIME_ARN`. Keep `COA_QUERY_TIMEOUT_MS` under Quick's 5-minute limit. |
| Live answer is empty or has no evidence | `COA_DEFAULT_NAMESPACE` (or the `namespace` argument) must be the namespace **UUID**, not its friendly name. |
| `413 payload too large` | Request body over 1 MiB. |

---

## Security notes

- **Loopback by default.** A local run listens on `127.0.0.1` only. Don't change
  `BIND_HOST` on a laptop or shared host to make it reachable; the proxy will refuse
  anyway unless OAuth is configured.
- **Never expose it without auth.** No public URL should serve `/mcp` without OAuth
  verification. Don't use tunneling services to put a local proxy on the internet.
- **How Quick reaches it safely.** Pick one:
  - **Private (preferred):** run the proxy in your VPC with no public ingress, and connect
    Quick through a [Quick VPC connection](https://docs.aws.amazon.com/quick/latest/userguide/mcp-integration.html).
    Keep OAuth on as well.
  - **Public HTTPS with OAuth:** a TLS-terminating managed front door (e.g. AWS App
    Runner, see `DEPLOY.md`) with `QUICK_OAUTH_*` configured. The container only binds
    `0.0.0.0` inside the container, and the server won't start that way without OAuth.
  - For a local container test, publish to loopback only: `docker run -p 127.0.0.1:8080:8080 …`.
- **Local test tokens stay local.** `QUICK_INBOUND_TOKENS` works only on loopback. Generate
  a random value, don't reuse it, and don't put it in a deployed config.
- **Secrets.** Keep `COA_PASS`, the Quick client secret, and any tokens in a secrets
  manager or an untracked env file. The proxy doesn't log tokens or passwords; it logs
  the COA base URL, default namespace, auth mode, and cache dir at startup.
- **Shared identity.** Every Quick user of the connector reaches COA as the proxy's single
  COA user, and can pass any `namespace` that user can read. Scope that COA user to the
  namespaces you intend to share, and share the Quick connector only with the right people.
- **Error text.** Tool errors include COA/Cognito status and response text to help
  debugging. They go only to authenticated callers, but review this before wider sharing.
