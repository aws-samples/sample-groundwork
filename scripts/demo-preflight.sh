#!/usr/bin/env bash
# =============================================================================
# GroundWork — demo readiness preflight
#
# Run this a few minutes BEFORE any demo. It answers one question fast:
# "Can I demo all three modes right now?" — checking the things that actually
# bite (unseeded local DB, expired COA token, COA graph not yet populated).
#
#   ./scripts/demo-preflight.sh
#
# Exit 0 = all green. Non-zero = something needs attention (details printed).
#
# WHY THIS EXISTS: COA's document extraction is a one-time ~90-min job, but the
# result is PERSISTENT (Neptune + OpenSearch). So future demos are instant — you
# just need to confirm the graph is still populated and your token is fresh.
# This script confirms exactly that in ~10 seconds.
# =============================================================================
set -uo pipefail
cd "$(dirname "$0")/.."

# Pull COA_* creds/overrides from .env.local (gitignored) so no credential
# lives in this tracked script.
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
COA_BASE="${COA_BASE_URL:-}"
# COA data-plane resolves namespaces by UUID, not name (name → 0 results).
NS="${COA_NAMESPACE_OTSEC:-${COA_NAMESPACE:-}}"
DB="groundwork.db"

if [ -z "$COA_BASE" ] || [ -z "$CLIENT_ID" ] || [ -z "$NS" ]; then
  echo "NOTE: COA_BASE_URL / COA_CLIENT_ID / COA_NAMESPACE_OTSEC not set in .env.local —" >&2
  echo "      Mode 3 checks will be skipped. See docs/SETUP.md. Modes 1 & 2 still checked." >&2
fi

g=$'\033[32m'; r=$'\033[31m'; y=$'\033[33m'; d=$'\033[2m'; b=$'\033[1m'; x=$'\033[0m'
fails=0; warns=0
ok()   { printf "  ${g}✓${x} %s\n" "$1"; }
bad()  { printf "  ${r}✗${x} %s\n" "$1"; fails=$((fails+1)); }
warn() { printf "  ${y}!${x} %s\n" "$1"; warns=$((warns+1)); }

echo ""
echo "${b}GroundWork — demo readiness${x}   ${d}$(date '+%H:%M:%S')${x}"

# ── Modes 1 & 2: local SQLite must be seeded ─────────────────────────────────
echo "${b}Modes 1 & 2 (local, no AWS)${x}"
if [ -f "$DB" ]; then
  N=$(sqlite3 "$DB" "SELECT COUNT(*) FROM nodes WHERE vertical='otsec';" 2>/dev/null || echo 0)
  if [ "${N:-0}" -ge 20 ]; then ok "SQLite seeded (otsec: $N nodes) — VOLTZITE story ready"
  else warn "SQLite thin (otsec: ${N:-0} nodes). Run: npm run db:seed"; fi
else
  bad "No $DB. Run: npm run db:seed"
fi

# ── Mode 3: token, reachability, populated graph ─────────────────────────────
echo "${b}Mode 3 (Live COA, $REGION)${x}"
TOKEN="$(AWS_PROFILE="$PROFILE" AWS_DEFAULT_REGION="$REGION" aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH --client-id "$CLIENT_ID" \
  --auth-parameters "USERNAME=${COA_USER},PASSWORD=${COA_PASS}" \
  --query 'AuthenticationResult.IdToken' --output text 2>/dev/null || echo "")"
if [ -z "$TOKEN" ] || [ "$TOKEN" = "None" ]; then
  bad "Could not mint a COA token (check AWS creds / mwinit / Isengard). Rest of Mode 3 skipped."
else
  ok "COA token minted (fresh, ~1h)"
  H=(-H "Authorization: Bearer $TOKEN")

  # Reachable + schema present
  SCHEMA="$(curl -s --max-time 20 "${H[@]}" "$COA_BASE/namespaces/$NS/schema")"
  CLASSES="$(printf '%s' "$SCHEMA" | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('classes',[])))" 2>/dev/null || echo 0)"
  if [ "${CLASSES:-0}" -ge 1 ]; then ok "COA reachable; ontology live ($CLASSES classes)"
  else bad "COA schema empty/unreachable — is the namespace '$NS' installed? (coa-pack install)"; fi

  # Vector store populated?
  CH="$(curl -s --max-time 25 "${H[@]}" -H "content-type: application/json" \
    -d '{"query":"known exploited vulnerability","topK":3}' \
    "$COA_BASE/namespaces/$NS/kb/search" \
    | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('chunks',[])))" 2>/dev/null || echo 0)"
  if [ "${CH:-0}" -ge 1 ]; then ok "Vector store populated (kb/search returns chunks)"
  else warn "Vector store empty — document extraction not finished (or no docs). Mode 3 answers will say 'no context'."; fi

  # Source status (is extraction still running?). The /sources endpoint uniquely
  # requires the namespace UUID (not the name), so resolve it from /namespaces first.
  NSID="$(curl -s --max-time 20 "${H[@]}" "$COA_BASE/namespaces" \
    | python3 -c "import sys,json;ns=[n for n in json.load(sys.stdin).get('namespaces',[]) if n.get('name')=='$NS'];print(ns[0]['namespaceId'] if ns else '')" 2>/dev/null || echo "")"
  if [ -n "$NSID" ]; then
    ST="$(curl -s --max-time 20 "${H[@]}" "$COA_BASE/namespaces/$NSID/sources" \
      | python3 -c "import sys,json;items=json.load(sys.stdin).get('items',[]);print(items[0]['status'] if items else 'none')" 2>/dev/null || echo "?")"
  else
    ST="?"
  fi
  case "$ST" in
    COMPLETED) ok "Document source status: COMPLETED" ;;
    none) warn "No document source registered (schema-only demo)." ;;
    SCANNING*|REGISTERED|IN_PROGRESS) warn "Document source still ingesting ($ST) — data lands when it completes." ;;
    *) warn "Document source status: $ST" ;;
  esac
fi

# ── App server running? ──────────────────────────────────────────────────────
echo "${b}Dev server${x}"
MODE_JSON="$(curl -s --max-time 5 http://localhost:3000/api/mode 2>/dev/null || echo "")"
if [ -n "$MODE_JSON" ]; then
  FID="$(printf '%s' "$MODE_JSON" | python3 -c "import sys,json;print(json.load(sys.stdin).get('mode','?'))" 2>/dev/null)"
  ok "Running on :3000 (mode: $FID). Switch modes from the badge, or npm run demo:{mock,ontology,coa}"
else
  warn "No server on :3000. Start one: npm run demo:mock (or demo:ontology / demo:coa)"
fi

echo ""
if [ "$fails" -eq 0 ] && [ "$warns" -eq 0 ]; then
  echo "${g}${b}READY — all three modes are demo-ready.${x}"
elif [ "$fails" -eq 0 ]; then
  echo "${y}${b}MOSTLY READY — $warns warning(s) above (usually: server not started, or COA still ingesting).${x}"
else
  echo "${r}${b}NOT READY — $fails blocker(s), $warns warning(s). Fix the ✗ items above.${x}"
fi
[ "$fails" -eq 0 ]
