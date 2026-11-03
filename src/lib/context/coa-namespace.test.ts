/**
 * COA namespace resolver tests (env → { id, configured }). No network.
 * Run: npm test
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { coaNamespace, configuredCoaVerticals } from "./coa-namespace";

const KEYS = [
  "COA_NAMESPACE_CYBER",
  "COA_NAMESPACE_ENERGY",
  "COA_NAMESPACE_OTSEC",
  "COA_NAMESPACE_PRODQUALITY",
  "COA_NAMESPACE_MANUFACTURING",
] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

test("unset env falls back to the pack name and is not configured", () => {
  assert.deepEqual(coaNamespace("otsec"), { id: "ot-security", configured: false });
  assert.deepEqual(coaNamespace("cyber"), { id: "ot-security", configured: false });
  assert.deepEqual(coaNamespace("energy"), { id: "energy-outage", configured: false });
  assert.deepEqual(coaNamespace("prodquality"), { id: "manufacturing", configured: false });
});

test("unknown vertical falls back to its own id", () => {
  assert.deepEqual(coaNamespace("other"), { id: "other", configured: false });
});

test("set env gives the value and configured true", () => {
  process.env.COA_NAMESPACE_OTSEC = "ns-placeholder";
  assert.deepEqual(coaNamespace("otsec"), { id: "ns-placeholder", configured: true });
  // cyber shares the pack but not the env var.
  assert.deepEqual(coaNamespace("cyber"), { id: "ot-security", configured: false });
});

test("empty env value counts as unset", () => {
  process.env.COA_NAMESPACE_ENERGY = "";
  assert.deepEqual(coaNamespace("energy"), { id: "energy-outage", configured: false });
});

test("COA_NAMESPACE_MANUFACTURING is still honoured for the manufacturing id", () => {
  process.env.COA_NAMESPACE_MANUFACTURING = "ns-placeholder-mfg";
  assert.deepEqual(coaNamespace("manufacturing"), { id: "ns-placeholder-mfg", configured: true });
  // prodquality uses its own key, not the manufacturing one.
  assert.equal(coaNamespace("prodquality").configured, false);
});

test("configuredCoaVerticals lists only verticals whose env is set", () => {
  assert.deepEqual(configuredCoaVerticals(), []);
  process.env.COA_NAMESPACE_OTSEC = "ns-placeholder-a";
  process.env.COA_NAMESPACE_PRODQUALITY = "ns-placeholder-b";
  process.env.COA_NAMESPACE_MANUFACTURING = "ns-placeholder-c";
  assert.deepEqual(configuredCoaVerticals().sort(), ["otsec", "prodquality"]);
});
