# Public deployment — AWS App Runner

The public demo runs on **AWS App Runner** in the shared account
(`<YOUR_AWS_ACCOUNT_ID>`, us-west-2). It's always-on (laptop-independent), serves the
Next SSR app + API routes, and **live Mode 3 (COA) works for anyone** because the
server mints its own Cognito token server-side. A login gate protects the URL.

## Live URL + demo login

- **URL:** <YOUR_APP_URL>
- **Login:** `you@example.com` / `<YOUR_DEMO_PASSWORD>`
- Default mode is **Live COA**. Use the **OT Sec** vertical for the richest data.

> The URL changes if the service is deleted + recreated. After any recreate,
> grab the new URL from `aws apprunner describe-service ... --query Service.ServiceUrl`.

## How it's wired

| Piece | What |
|-------|------|
| Image | `<YOUR_AWS_ACCOUNT_ID>.dkr.ecr.us-west-2.amazonaws.com/groundwork:latest` (ECR) |
| Build | AWS CodeBuild project `groundwork-image` (native **amd64** — local Apple-Silicon cross-builds segfault under emulation) |
| Secrets | Secrets Manager `groundwork/app` → COA_USER/PASS, COA_CLIENT_ID, DEMO_USER/PASS, AUTH_SECRET (injected as env via `RuntimeEnvironmentSecrets`) |
| Roles | `GroundWorkAppRunnerECRAccess` (pull image), `GroundWorkAppRunnerInstance` (read secret) |
| Token | `src/lib/context/coa-token.ts` auto-mints + caches + refreshes the Cognito id token; no token is baked into the image |
| Gate | `src/proxy.ts` + `src/lib/auth.ts` — signed httpOnly cookie; enabled only when DEMO_USER/DEMO_PASS are set |

## Redeploy (after code changes)

```bash
export AWS_PROFILE=<your-profile> AWS_DEFAULT_REGION=us-west-2
BUCKET=<YOUR_BUILD_BUCKET>

# 1. Package source (exclude heavy/irrelevant dirs) and upload
zip -rq /tmp/gw-src.zip . \
  -x 'node_modules/*' -x '.next/*' -x 'third_party/*' -x '.git/*' \
  -x 'infra/node_modules/*' -x 'infra/cdk.out/*' -x 'connectors/.venv/*' \
  -x 'tools/*/.venv/*' -x '*.db' -x '*.db-shm' -x '*.db-wal' -x '.env.local'
aws s3 cp /tmp/gw-src.zip s3://$BUCKET/gw-src.zip

# 2. Build the amd64 image (CodeBuild) — pushes to ECR:latest
aws codebuild start-build --project-name groundwork-image

# 3. Roll the running service to the new image
ARN=$(aws apprunner list-services --query "ServiceSummaryList[?ServiceName=='groundwork'].ServiceArn" --output text)
aws apprunner start-deployment --service-arn "$ARN"
```

## Rotate the demo password / COA creds

```bash
aws secretsmanager put-secret-value --secret-id groundwork/app \
  --secret-string '{"COA_USER":"...","COA_PASS":"...","COA_CLIENT_ID":"...","DEMO_USER":"...","DEMO_PASS":"...","AUTH_SECRET":"..."}'
# then roll the service (step 3 above) so it re-reads the secret
```

## Build tooling (which tool, where)

- **CodeBuild (the image build):** uses `docker` — this is AWS CodeBuild's own
  managed, native-amd64 environment, **not** Docker Desktop. Correct tool here.
- **Local Mac:** use **`finch`** (Docker Desktop is disallowed at Amazon). You do
  not need Docker installed to work on this repo. Note: a local
  `finch build --platform linux/amd64` **cannot** produce the deploy image — the
  Next.js build segfaults under QEMU amd64 emulation on Apple Silicon. So the
  amd64 deploy image is always built in CodeBuild; Finch locally is for arm64
  dev/testing only.

## Gotchas we hit (so you don't again)

- **Node version (root cause of the Modes 1/2 crash):** `better-sqlite3@13`
  requires **Node ≥22**. The container was Node 20 → ABI mismatch → segfault
  (exit 139) on every SQLite call, which killed the container on Mode 1/2 queries
  while Mode 3 (no SQLite) worked. Fix: base image is `node:22-bookworm-slim`.
- **arch:** App Runner is amd64. Build via CodeBuild (native x86), not a local
  Apple-Silicon build (Next build segfaults under QEMU).
- **bind address:** Next standalone binds to `os.hostname()`; the container must
  launch with `HOSTNAME=0.0.0.0` (set in the Dockerfile CMD) or the health check
  can't reach it — this is the #1 "health check failed" cause.
- **SQLite in a read-only container:** the app dir is read-only and WAL writes
  sidecar files, so the DB is copied to `/tmp` at start and `DB_PATH` points there.
- **namespace:** COA resolves namespaces by **UUID**, not name.
- A `CREATE_FAILED` service can't be redeployed — delete and recreate it.
