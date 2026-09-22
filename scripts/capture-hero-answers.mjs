#!/usr/bin/env node
/**
 * Capture real COA graph answers for the scripted demo (hero) questions and
 * write them to src/data/coa-cache/<vertical>.json. These cached answers are
 * *genuine* COA output — captured live — served instantly during a demo so the
 * scripted questions never stall on COA's variable Tier-3 latency. Ad-hoc
 * questions still go live. Re-run this to refresh the cache.
 *
 * Usage: COA_BASE_URL=... COA_TOKEN=... node scripts/capture-hero-answers.mjs
 *   (or it will read COA_BASE_URL / COA_TOKEN / COA_NAMESPACE_* from .env.local)
 */
import fs from "node:fs";
import path from "node:path";

// --- load .env.local (simple parser) ---------------------------------------
const envLocal = path.join(process.cwd(), ".env.local");
const env = { ...process.env };
if (fs.existsSync(envLocal)) {
  for (const line of fs.readFileSync(envLocal, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !env[m[1]]) env[m[1]] = m[2];
  }
}

const BASE = env.COA_BASE_URL;
const TOKEN = env.COA_TOKEN;
if (!BASE || !TOKEN) {
  console.error("Need COA_BASE_URL and COA_TOKEN (in env or .env.local).");
  process.exit(1);
}

// The scripted hero questions per vertical + the COA namespace to hit.
// The `key` is the normalized question used for cache lookup at runtime.
const HERO = {
  prodquality: {
    namespace: env.COA_NAMESPACE_PRODQUALITY,
    questions: [
      "The VoltCore 20V drill has a cluster of cold-weather battery reviews — which cell lot and supplier are the root cause?",
      "Which VoltCore products share the battery pack built from cell lot NS-2411?",
      "According to ECN-NS-77 and CAPA #NS-01, what changed at NorthStar and what is the corrective action?",
    ],
  },
  otsec: {
    namespace: env.COA_NAMESPACE_OTSEC,
    questions: [
      "Which ICS threat groups can reach our PLCs and what techniques would they use?",
      "What is CVE-2024-36401 in GeoServer, how severe is it, and how could it be exploited?",
      "How can an attacker achieve persistence on a Siemens PLC?",
      // Live-database (COA JDBC_DATABASE) questions — answered from the federated
      // Postgres OT-inventory tables via governed metrics + graph reasoning.
      // See docs/JDBC_OT_SECURITY_SCENARIO.md.
      "How many OT assets are affected by actively exploited (CISA KEV) vulnerabilities?",
      "How many NERC CIP and IEC 62443 compliance controls are failing across our OT assets?",
      "If an attacker compromises our VPN gateway, how many OT assets are reachable and does the path reach any safety-critical systems?",
    ],
  },
};

async function ask(namespace, question) {
  const body = {
    query: `${question} Answer concisely in under 120 words, focusing on the key entities and the chain between them.`,
    execute: true,
    mode: "standard",
    includeSupporting: true,
    maxResults: 5,
  };
  const t0 = Date.now();
  const res = await fetch(`${BASE}/namespaces/${namespace}/query`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  const r = json.result ?? json;
  return {
    answer: r.synthesizedAnswer ?? r.answer ?? "",
    tier: r.tier,
    confidence: r.confidence?.score ?? r.confidence,
    supportingContent: r.supportingContent ?? [],
    capturedMs: Date.now() - t0,
    capturedAt: new Date().toISOString(),
  };
}

function norm(q) {
  return q.toLowerCase().replace(/\s+/g, " ").trim();
}

const outDir = path.join(process.cwd(), "src/data/coa-cache");
fs.mkdirSync(outDir, { recursive: true });

for (const [vertical, cfg] of Object.entries(HERO)) {
  if (!cfg.namespace) {
    console.warn(`skip ${vertical}: no namespace configured`);
    continue;
  }
  const entries = {};
  // Load any existing cache so a re-run only fills the gaps (keeps good captures).
  const existingFile = path.join(outDir, `${vertical}.json`);
  if (fs.existsSync(existingFile)) {
    try {
      const prev = JSON.parse(fs.readFileSync(existingFile, "utf8"));
      for (const [k, v] of Object.entries(prev)) if (v?.answer?.length >= 200) entries[k] = v;
    } catch {}
  }
  for (const q of cfg.questions) {
    const key = norm(q);
    if (entries[key]?.answer?.length >= 200) {
      console.log(`  [${vertical}] "${q.slice(0, 45)}..." cached OK (skip)`);
      continue;
    }
    process.stdout.write(`  [${vertical}] "${q.slice(0, 45)}..." `);
    // COA Tier-3 latency is variable and sometimes 504s; retry until we get a
    // substantial answer (>=200 chars) so the demo cache is solid.
    let got = null;
    for (let attempt = 1; attempt <= 5 && !got; attempt++) {
      try {
        const r = await ask(cfg.namespace, q);
        if (r.answer && r.answer.length >= 200) got = r;
        else process.stdout.write(`(try ${attempt}: ${r.answer ? r.answer.length + "ch" : "empty"}) `);
      } catch (e) {
        process.stdout.write(`(try ${attempt}: ${e.message}) `);
      }
    }
    if (got) {
      entries[key] = got;
      console.log(`OK (${got.capturedMs}ms, ${got.answer.length} chars)`);
    } else {
      console.log("STILL FAILING — left uncached (will fall back live)");
    }
  }
  const file = path.join(outDir, `${vertical}.json`);
  fs.writeFileSync(file, JSON.stringify(entries, null, 2));
  console.log(`wrote ${file} (${Object.keys(entries).length} answers)`);
}
