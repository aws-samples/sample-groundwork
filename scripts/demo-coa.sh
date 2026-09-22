#!/usr/bin/env bash
# =============================================================================
# GroundWork — launch the dev server ready for a Mode 3 (Live COA) demo.
#
# COA uses short-lived Cognito OIDC tokens (~1h). This script mints a FRESH one,
# writes it to .env.local, and launches `next dev` with any stale COA_TOKEN
# unset — because Next.js gives a process/shell env var precedence over
# .env.local, a leftover exported COA_TOKEN will otherwise 403 mid-demo.
#
#   ./scripts/demo-coa.sh
#
# Requires: AWS creds for your profile, and COA_* values in .env.local. See
# docs/SETUP.md for how to obtain each value from your COA deployment.
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

# Pull COA_USER / COA_PASS / COA_CLIENT_ID (and any COA_* overrides) from
# .env.local if present, so no credential lives in this tracked script.
# .env.local is gitignored.
if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.local
  set +a
fi

REGION="${AWS_REGION:-us-west-2}"
PROFILE="${AWS_PROFILE:-default}"
CLIENT_ID="${COA_CLIENT_ID:-}"
COA_USER="${COA_USER:-}"
COA_PASS="${COA_PASS:-}"

if [ -z "$COA_USER" ] || [ -z "$COA_PASS" ] || [ -z "$CLIENT_ID" ]; then
  echo "ERROR: COA_USER, COA_PASS and COA_CLIENT_ID must be set (in .env.local or the environment)." >&2
  echo "  These are the Cognito user credentials + app client id for YOUR COA deployment." >&2
  echo "  See docs/SETUP.md. Add them to .env.local, e.g.:" >&2
  echo "    COA_USER=you@example.com  COA_PASS=...  COA_CLIENT_ID=..." >&2
  exit 1
fi

echo "Minting a fresh COA token for ${COA_USER} (profile ${PROFILE}, ${REGION})..."
TOKEN="$(AWS_PROFILE="$PROFILE" AWS_DEFAULT_REGION="$REGION" aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH --client-id "$CLIENT_ID" \
  --auth-parameters "USERNAME=${COA_USER},PASSWORD=${COA_PASS}" \
  --query 'AuthenticationResult.IdToken' --output text)"

if [ -z "$TOKEN" ] || [ "$TOKEN" = "None" ]; then
  echo "ERROR: could not mint a token. Check AWS creds / Cognito user." >&2
  exit 1
fi

# Update (or append) COA_TOKEN in .env.local without touching other keys.
python3 - "$TOKEN" <<'PY'
import re, sys, pathlib
tok = sys.argv[1]
p = pathlib.Path(".env.local")
s = p.read_text() if p.exists() else ""
if re.search(r'^COA_TOKEN=', s, flags=re.M):
    s = re.sub(r'^COA_TOKEN=.*$', 'COA_TOKEN=' + tok, s, flags=re.M)
else:
    s += ("" if s.endswith("\n") or not s else "\n") + "COA_TOKEN=" + tok + "\n"
p.write_text(s)
print("  .env.local COA_TOKEN refreshed successfully")
PY

echo "Launching Next dev in CONTEXT_MODE=coa (stale COA_TOKEN unset so .env.local wins)..."
# The two unsets are the whole point — see the header.
unset COA_TOKEN COA_BASE_URL
export CONTEXT_MODE=coa
exec npm run dev
