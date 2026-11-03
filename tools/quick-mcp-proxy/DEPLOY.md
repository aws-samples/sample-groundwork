# Deploy quick-mcp-proxy (container, e.g. AWS App Runner)

Goal: an **HTTPS** endpoint Amazon Quick can reach, **gated by OAuth** — never an
unauthenticated public URL. End-user setup, env vars, and the Quick connector steps are in
[`docs/QUICK_MCP_INTEGRATION.md`](../../docs/QUICK_MCP_INTEGRATION.md); this file covers
building and running the container.

Deploy into **your own AWS account**, ideally the one where your COA runs, so the proxy can
reach COA and mint its token. Every value below is a placeholder.

Pattern: build an amd64 image → push to Amazon ECR → run on a managed HTTPS front door
(App Runner shown here; ECS behind an ALB works the same way).

---

## 0. Prereqs
- AWS CLI credentials for your account: `export AWS_PROFILE=<your-profile> AWS_REGION=<region>`.
- Your COA values (same as GroundWork Mode 3): `COA_BASE_URL`, and Cognito mint creds
  `COA_CLIENT_ID` / `COA_USER` / `COA_PASS`.
- An OAuth client_credentials setup for Quick (issuer, Quick's app client ID, scope).
  See "Set up OAuth for Quick" in `docs/QUICK_MCP_INTEGRATION.md`.

## 1. Create the ECR repo (once)
```bash
aws ecr create-repository --repository-name quick-mcp-proxy --region $AWS_REGION
export ECR=$(aws sts get-caller-identity --query Account --output text).dkr.ecr.$AWS_REGION.amazonaws.com
```

## 2. Build + push the image

**Option A — locally** with any OCI-compatible container CLI (`docker`, `finch`, `podman`);
the image has no native addons, so building `linux/amd64` on Apple Silicon is fine:
```bash
cd tools/quick-mcp-proxy
mkdir -p coa-cache && cp -f ../../src/data/coa-cache/*.json coa-cache/   # bake in hero cache
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR
docker build --platform linux/amd64 -t $ECR/quick-mcp-proxy:latest .
docker push $ECR/quick-mcp-proxy:latest
```

**Option B — AWS CodeBuild**: point a CodeBuild project at this dir with
`tools/quick-mcp-proxy/buildspec.yml`, env vars `AWS_DEFAULT_REGION` + `ECR`, privileged
mode on (for docker). The buildspec copies the cache in and pushes `:latest`.

## 3. Store secrets (never bake them into the image)
```bash
aws secretsmanager create-secret --name quick-mcp-proxy/coa \
  --secret-string '{"COA_CLIENT_ID":"<...>","COA_USER":"<...>","COA_PASS":"<...>","COA_BASE_URL":"https://<...>"}' \
  --region $AWS_REGION
```
Don't set `QUICK_INBOUND_TOKENS` on a deployed service. It is a loopback-only local-test
credential and the server ignores it on a non-loopback bind.

## 3b. Create the ECR access role (once)
App Runner needs this to pull from ECR.
```bash
cat > /tmp/apprunner-trust.json <<'JSON'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow",
"Principal":{"Service":"build.apprunner.amazonaws.com"},"Action":"sts:AssumeRole"}]}
JSON
aws iam create-role --role-name AppRunnerECRAccessRole \
  --assume-role-policy-document file:///tmp/apprunner-trust.json 2>/dev/null || true
aws iam attach-role-policy --role-name AppRunnerECRAccessRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess
export ACCESS_ROLE_ARN=$(aws iam get-role --role-name AppRunnerECRAccessRole --query Role.Arn --output text)
```

## 4. Create the App Runner service
Console → App Runner → Create service → Source: **Container registry → ECR**, image
`<ECR>/quick-mcp-proxy:latest`.
- **Port:** `8080`
- **Health check:** HTTP path `/health`
- **Env vars (plain):**
  - `COA_DEFAULT_NAMESPACE=<your-namespace-uuid>`, `AWS_REGION=<region>`
  - `QUICK_OAUTH_ISSUER=https://cognito-idp.<region>.amazonaws.com/<user-pool-id>`
  - `QUICK_OAUTH_CLIENT_IDS=<quick-app-client-id>`
  - `QUICK_OAUTH_REQUIRED_SCOPE=<resource-server-id>/query`
- **Env vars (from Secrets Manager):** map `COA_BASE_URL`, `COA_CLIENT_ID`, `COA_USER`,
  `COA_PASS` from the secret above (the instance role needs `secretsmanager:GetSecretValue`
  on that secret).
- **Networking:** prefer a private endpoint (incoming traffic only from your VPC) and connect
  Quick through a Quick VPC connection. A public endpoint is acceptable only with the
  `QUICK_OAUTH_*` settings above.

The image sets `BIND_HOST=0.0.0.0` inside the container. The server **refuses to start**
on that bind unless `QUICK_OAUTH_ISSUER` plus `QUICK_OAUTH_CLIENT_IDS` (or
`QUICK_OAUTH_AUDIENCE`) are set, so a misconfigured service fails its health check instead
of serving `/mcp` unauthenticated.

CLI equivalent (plain env shown; add the secret refs via the console or a config file):
```bash
aws apprunner create-service --service-name quick-mcp-proxy \
  --source-configuration '{
    "AuthenticationConfiguration": {"AccessRoleArn": "'"$ACCESS_ROLE_ARN"'"},
    "ImageRepository": {
      "ImageIdentifier": "'"$ECR"'/quick-mcp-proxy:latest",
      "ImageRepositoryType": "ECR",
      "ImageConfiguration": {
        "Port": "8080",
        "RuntimeEnvironmentVariables": {
          "COA_DEFAULT_NAMESPACE": "<your-namespace-uuid>",
          "AWS_REGION": "<region>",
          "QUICK_OAUTH_ISSUER": "https://cognito-idp.<region>.amazonaws.com/<user-pool-id>",
          "QUICK_OAUTH_CLIENT_IDS": "<quick-app-client-id>",
          "QUICK_OAUTH_REQUIRED_SCOPE": "<resource-server-id>/query"
        }
      }
    },
    "AutoDeploymentsEnabled": false
  }' \
  --health-check-configuration '{"Protocol":"HTTP","Path":"/health","Interval":10,"Timeout":5,"HealthyThreshold":1,"UnhealthyThreshold":5}' \
  --region $AWS_REGION
```

## 5. Verify the gate first, then the happy path
```bash
URL=https://<service-host>
curl -s $URL/health                       # → {"ok":true}
# Anonymous MCP call MUST be rejected (401 + WWW-Authenticate: Bearer realm=...):
curl -s -i -X POST $URL/mcp -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```
If that returns anything other than `401`, stop and fix the configuration before
connecting Quick. Then test with a real client_credentials token:
```bash
TOKEN=$(curl -s -u "<client-id>:<client-secret>" \
  -d 'grant_type=client_credentials&scope=<resource-server-id>/query' \
  https://<your-domain>.auth.<region>.amazoncognito.com/oauth2/token | jq -r .access_token)
PROXY_URL=$URL/mcp QUICK_INBOUND_TOKEN="$TOKEN" npm run smoke
```

## 6. Connect Amazon Quick
Follow "Register the MCP server in Amazon Quick" in
[`docs/QUICK_MCP_INTEGRATION.md`](../../docs/QUICK_MCP_INTEGRATION.md): MCP server endpoint
`https://<service-host>/mcp`, **Service authentication** with your Client ID, Client Secret,
and Token URL. Don't choose "No authentication".

---

## Hardening checklist
- OAuth configured (`QUICK_OAUTH_ISSUER`, `QUICK_OAUTH_CLIENT_IDS`/`QUICK_OAUTH_AUDIENCE`,
  `QUICK_OAUTH_REQUIRED_SCOPE`) and anonymous `/mcp` verified as `401`.
- `COA_PASS` and the Quick client secret in Secrets Manager, never in the image or plain env.
- Prefer a private endpoint + Quick VPC connection over a public endpoint.
- **Namespaces:** callers can pass any `namespace` the proxy's COA user can read. Scope that
  COA user accordingly.
- The proxy returns a **text answer + evidence trail** (Quick renders chat, not an
  interactive graph).
