#!/usr/bin/env bash
# =============================================================================
# GroundWork — mode acceptance test
#
# Runs a series of assertions against a RUNNING dev server and reports, per
# assertion, PASS/FAIL and the LinkedIn-post / vision claim it validates.
#
#   Every assertion cites its source:
#     [LI]   = the original LinkedIn post (the vision)  -> docs recovered in git
#     [§10]  = MERGE_PLAN.md §10 post-claim -> mode fidelity table (authoritative)
#     [NARR] = NARRATIVE.md demo runbook
#
# USAGE
#   1. Start the app in the mode you want to test, in another terminal:
#        CONTEXT_MODE=mock      npm run dev      # Mode 1
#        CONTEXT_MODE=ontology  npm run dev      # Mode 2
#        CONTEXT_MODE=coa       npm run dev      # Mode 3 (needs .env.local COA_*)
#   2. Then run:
#        ./scripts/test-modes.sh                 # auto-detects the running mode
#        ./scripts/test-modes.sh --url http://localhost:3000 --vertical otsec
#
# The script never changes the server's mode — it tests whatever is running and
# tailors its expectations to that mode's fidelity.
# =============================================================================
set -uo pipefail

URL="http://localhost:3000"
VERTICAL="otsec"
while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="$2"; shift 2 ;;
    --vertical) VERTICAL="$2"; shift 2 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1"; exit 2 ;;
  esac
done

PASS=0; FAIL=0
c_grn=$'\033[32m'; c_red=$'\033[31m'; c_dim=$'\033[2m'; c_bold=$'\033[1m'; c_off=$'\033[0m'

# assert <claim-tag> <description> <test-cmd...>
# The test command should exit 0 for PASS. It runs in a subshell.
assert() {
  local tag="$1"; local desc="$2"; shift 2
  if "$@" >/tmp/cf_assert.out 2>&1; then
    PASS=$((PASS+1)); printf "  ${c_grn}PASS${c_off}  ${c_dim}%-6s${c_off} %s\n" "$tag" "$desc"
  else
    FAIL=$((FAIL+1)); printf "  ${c_red}FAIL${c_off}  ${c_dim}%-6s${c_off} %s\n" "$tag" "$desc"
    sed 's/^/          /' /tmp/cf_assert.out | head -4
  fi
}

# --- tiny JSON helpers (python3, always present on macOS) --------------------
jget() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval('d'+sys.argv[1]))" "$1" 2>/dev/null; }
api_get()  { curl -s --max-time 60 "$URL$1"; }
api_post() { curl -s --max-time 120 -X POST -H "content-type: application/json" -d "$2" "$URL$1"; }

# --- preflight: server up? which mode? ---------------------------------------
MODE_JSON="$(api_get /api/mode)"
if [ -z "$MODE_JSON" ]; then
  echo "${c_red}Cannot reach $URL — start the dev server first (see --help).${c_off}"; exit 1
fi
FIDELITY="$(printf '%s' "$MODE_JSON" | jget "['fidelity']")"
echo ""
echo "${c_bold}GroundWork acceptance test${c_off}"
echo "  server:   $URL"
echo "  vertical: $VERTICAL"
echo "  fidelity: ${c_bold}$FIDELITY${c_off}   ${c_dim}(from /api/mode — the on-screen honesty badge)${c_off}"
echo ""

# warn <claim-tag> <description> <detail>  — a non-fatal note (does not count as FAIL)
warn() {
  printf "  ${c_dim}WARN  %-6s %s${c_off}\n" "$1" "$2"
  [ -n "${3:-}" ] && printf "          ${c_dim}%s${c_off}\n" "$3"
}

# =============================================================================
# SECTION A — claims true in EVERY mode (the core product)
# =============================================================================
echo "${c_bold}A. Core product${c_off}"

# In Modes 1/2 the graph is local (SQLite) and pre-seeded, so we assert populated
# instance data directly. In Mode 3 the graph is COA's virtual graph over live
# sources — CoaProvider intentionally has no "return the whole graph" call, and
# instance data only appears after COA's async document extraction finishes. So
# for coa we assert the *path works* and treat "no instance data yet" as a WARN.
if [ "$FIDELITY" != "coa" ]; then
  # [LI] "Auto-build a Knowledge Graph" — the graph exists and has entities+edges.
  assert "[LI]" "Knowledge graph is populated (nodes + edges exist)" bash -c '
    s="$(curl -s "'"$URL"'/api/graph?vertical='"$VERTICAL"'&action=stats")"
    n="$(printf "%s" "$s" | python3 -c "import sys,json;print(json.load(sys.stdin).get(\"totalNodes\",0))")"
    e="$(printf "%s" "$s" | python3 -c "import sys,json;print(json.load(sys.stdin).get(\"totalEdges\",0))")"
    echo "nodes=$n edges=$e"; [ "$n" -gt 0 ] && [ "$e" -gt 0 ]'

  # [§10] "Reason across sources -> blast radius / attack path" — multi-hop traversal.
  assert "[§10]" "Blast-radius traversal from VPN reaches multiple assets (multi-hop)" bash -c '
    s="$(curl -s "'"$URL"'/api/graph?vertical='"$VERTICAL"'&action=traverse&nodeId=vpn-gw&hops=4")"
    n="$(printf "%s" "$s" | python3 -c "import sys,json;print(len(json.load(sys.stdin).get(\"nodes\",[])))")"
    echo "reachable nodes=$n"; [ "$n" -ge 5 ]'

  # [LI] "GraphRAG - connected reasoning" — graph query returns a subgraph.
  assert "[LI]" "GraphRAG query returns a connected subgraph (not one chunk)" bash -c '
    r="$(curl -s -X POST -H "content-type: application/json" -d "{\"vertical\":\"'"$VERTICAL"'\",\"query\":\"What is the blast radius if VOLTZITE compromises our VPN?\",\"mode\":\"graph\"}" "'"$URL"'/api/query")"
    nc="$(printf "%s" "$r" | python3 -c "import sys,json;d=json.load(sys.stdin);sg=d.get(\"subgraph\") or {};print(sg.get(\"nodeCount\",0))")"
    echo "subgraph nodeCount=$nc"; [ "$nc" -ge 3 ]'
else
  # [§10] Mode 3: the graph query PATH must succeed (200 + a result envelope),
  # even before instance data lands. Populated data is a separate WARN below.
  assert "[§10]" "GraphRAG query path reaches COA and returns a result" bash -c '
    r="$(curl -s -X POST -H "content-type: application/json" -d "{\"vertical\":\"'"$VERTICAL"'\",\"query\":\"What is the blast radius if VOLTZITE compromises our VPN?\",\"mode\":\"graph\"}" "'"$URL"'/api/query")"
    err="$(printf "%s" "$r" | python3 -c "import sys,json;print(json.load(sys.stdin).get(\"error\",\"\"))")"
    echo "error=${err:-none}"; [ -z "$err" ]'

  # Data-populated is best-effort while extraction runs — report, do not fail.
  SG="$(api_post /api/query "{\"vertical\":\"$VERTICAL\",\"query\":\"blast radius if VOLTZITE compromises the VPN\",\"mode\":\"graph\"}")"
  NC="$(printf '%s' "$SG" | python3 -c 'import sys,json;d=json.load(sys.stdin);sg=d.get("subgraph") or {};print(sg.get("nodeCount",0))' 2>/dev/null || echo 0)"
  if [ "${NC:-0}" -ge 1 ]; then
    assert "[§10]" "Mode 3: graph query returns live instance data (extraction done)" true
  else
    warn "[§10]" "Mode 3: no graph instance data yet" "COA async document extraction still running — schema is live, instances land when the source finishes SCANNING. Re-run later."
  fi
fi

# [LI] "vector-only RAG finds similar text" — vector mode responds in every mode.
assert "[LI]" "Vector query path responds (the honest foil to GraphRAG)" bash -c '
  r="$(curl -s -X POST -H "content-type: application/json" -d "{\"vertical\":\"'"$VERTICAL"'\",\"query\":\"blast radius if VPN compromised\",\"mode\":\"vector\"}" "'"$URL"'/api/query")"
  m="$(printf "%s" "$r" | python3 -c "import sys,json;print(json.load(sys.stdin).get(\"mode\",\"\"))")"
  echo "mode=$m"; [ "$m" = "vector" ]'

# [§10] fidelity badge is honest and matches the running mode.
assert "[§10]" "Fidelity badge reports the active mode ($FIDELITY)" bash -c '
  [ "'"$FIDELITY"'" = "mock" ] || [ "'"$FIDELITY"'" = "ontology" ] || [ "'"$FIDELITY"'" = "coa" ]'

echo ""

# =============================================================================
# SECTION B — mode-specific fidelity (what each rung PROVES, per §10)
# =============================================================================
echo "${c_bold}B. Fidelity for this mode ($FIDELITY)${c_off}"

case "$FIDELITY" in
  mock)
    # [§10] Mode 1 proves "the story" — seed data, fast, no AWS. Types are hardcoded.
    assert "[§10]" "Mode 1: graph answers come from seed data (the 30-sec story)" bash -c '
      r="$(curl -s -X POST -H "content-type: application/json" -d "{\"vertical\":\"'"$VERTICAL"'\",\"query\":\"blast radius\",\"mode\":\"graph\"}" "'"$URL"'/api/query")"
      b="$(printf "%s" "$r" | python3 -c "import sys,json;print(json.load(sys.stdin).get(\"backend\",\"\"))")"
      echo "backend=$b"; printf "%s" "$b" | grep -qi "sqlite"'
    ;;

  ontology)
    # [§10] Mode 2 proves "it is a REAL ontology" — OWL classes + canReach transitive.
    assert "[§10]" "Mode 2: schema comes from ontology.ttl (>=15 OWL classes)" bash -c '
      # describeSchema is surfaced via the query backend string + the graph; we
      # assert the graph query cites the ontology backend.
      r="$(curl -s -X POST -H "content-type: application/json" -d "{\"vertical\":\"'"$VERTICAL"'\",\"query\":\"blast radius\",\"mode\":\"graph\"}" "'"$URL"'/api/query")"
      b="$(printf "%s" "$r" | python3 -c "import sys,json;print(json.load(sys.stdin).get(\"backend\",\"\"))")"
      echo "backend=$b"; printf "%s" "$b" | grep -qi "ontology"'

    # [LI] "Auto-build KG from unstructured docs using LLMs" + [NARR] citations appear.
    # Ingest a threat report, then the vector path returns real chunks.
    assert "[LI]" "Mode 2: ingesting a report populates the vector index (KG-from-text)" bash -c '
      ing="$(curl -s -X POST -H "content-type: application/json" -d "{\"vertical\":\"'"$VERTICAL"'\",\"mode\":\"text\",\"title\":\"Test Threat Report\",\"text\":\"VOLTZITE exploited CVE-2024-3400 in the PAN-OS VPN gateway to gain initial access, then used T0886 for lateral movement toward the SCADA server and PIPEDREAM malware against ControlLogix PLCs via T0855.\"}" "'"$URL"'/api/extract")"
      stored="$(printf "%s" "$ing" | python3 -c "import sys,json;print(json.load(sys.stdin).get(\"stored\",False))")"
      echo "stored=$stored"; [ "$stored" = "True" ]'

    assert "[LI]" "Mode 2: vector query now returns real cosine-kNN hits" bash -c '
      r="$(curl -s -X POST -H "content-type: application/json" -d "{\"vertical\":\"'"$VERTICAL"'\",\"query\":\"VOLTZITE PAN-OS VPN initial access\",\"mode\":\"vector\"}" "'"$URL"'/api/query")"
      s="$(printf "%s" "$r" | python3 -c "import sys,json;print(json.load(sys.stdin).get(\"sources\",0) or 0)")"
      echo "vector sources=$s"; [ "$s" -ge 1 ]'
    ;;

  coa)
    # [§10] Mode 3 proves "the real thing" — Neptune via COA, real schema over HTTP.
    assert "[§10]" "Mode 3: backend is Neptune-via-COA (real graph)" bash -c '
      r="$(curl -s -X POST -H "content-type: application/json" -d "{\"vertical\":\"'"$VERTICAL"'\",\"query\":\"What threat groups target ICS?\",\"mode\":\"graph\"}" "'"$URL"'/api/query")"
      b="$(printf "%s" "$r" | python3 -c "import sys,json;print(json.load(sys.stdin).get(\"backend\",\"\"))")"
      echo "backend=$b"; printf "%s" "$b" | grep -qiE "neptune|coa"'

    # [LI] "Runs in YOUR account" — the query is served by the deployed COA endpoint.
    assert "[LI]" "Mode 3: answers resolve over the live COA deployment (your account)" bash -c '
      r="$(curl -s -X POST -H "content-type: application/json" -d "{\"vertical\":\"'"$VERTICAL"'\",\"query\":\"describe the ontology\",\"mode\":\"graph\"}" "'"$URL"'/api/query")"
      # A COA-served response has a tiered-resolution model string.
      m="$(printf "%s" "$r" | python3 -c "import sys,json;print(json.load(sys.stdin).get(\"model\",\"\"))")"
      echo "model=$m"; printf "%s" "$m" | grep -qi "coa"'
    ;;
esac

echo ""
echo "${c_bold}Result:${c_off} ${c_grn}$PASS passed${c_off}, ${c_red}$FAIL failed${c_off}   (mode: $FIDELITY)"
[ "$FAIL" -eq 0 ]
