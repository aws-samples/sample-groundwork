# quick-mcp-proxy — Amazon Quick → COA bridge

A thin **remote HTTP MCP server** that lets **Amazon Quick** query the *same* COA
context GroundWork uses. It bridges the one real gap between Quick and COA:

- **Quick** authenticates with **Service authentication** (OAuth 2.0 client_credentials):
  it sends an IdP-issued access token (JWT).
- **COA** needs a **user OIDC token** (no machine-to-machine creds today).

This proxy verifies Quick's access token, mints COA's user token server-side, and proxies a
single `context_query` tool to COA's governed `query` operation.

**Full end-user guide:** [`docs/QUICK_MCP_INTEGRATION.md`](../../docs/QUICK_MCP_INTEGRATION.md)
(env vars, OAuth setup, Quick connector steps, testing, troubleshooting, security notes).
Container deployment: [`DEPLOY.md`](DEPLOY.md). End-user guide: [`docs/QUICK_MCP_INTEGRATION.md`](../../docs/QUICK_MCP_INTEGRATION.md).

## The one tool

`context_query(question, namespace?)` → a governed, graph-grounded answer with its evidence
chain, formatted as Markdown for Quick's chat surface. `namespace` defaults to
`COA_DEFAULT_NAMESPACE`.

## Security defaults

- Binds `127.0.0.1` unless `BIND_HOST` is set; refuses a non-loopback bind unless OAuth
  JWT verification (`QUICK_OAUTH_ISSUER` + `QUICK_OAUTH_CLIENT_IDS`/`QUICK_OAUTH_AUDIENCE`)
  is configured.
- Fails closed: with no inbound auth configured, every `/mcp` request gets `401`.
- `QUICK_INBOUND_TOKENS` is a loopback-only local-test credential (constant-time compare).

## Quick local run (hero cache, no live COA)

```bash
npm ci && npm run build && npm test
export COA_BASE_URL=http://unused.local COA_TOKEN=unused
export COA_CACHE_DIR="$(cd ../../src/data/coa-cache && pwd)"
export QUICK_INBOUND_TOKEN="$(openssl rand -hex 32)" QUICK_INBOUND_TOKENS="$QUICK_INBOUND_TOKEN"
PORT=8787 npm start          # listens on http://127.0.0.1:8787/mcp
# in another shell with QUICK_INBOUND_TOKEN exported:
npm run smoke                # initialize + tools/list + tools/call, expects the NorthStar answer
```

## What this is / isn't

- **Is:** a working front door from Quick to COA: same engine, same answer, chat UI.
- **Isn't:** production-hardened. All Quick users share the proxy's single COA identity, and
  graph visualization is out of scope (text answer only).
