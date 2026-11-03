/**
 * Pack ontology schema reader tests, against the real packs/* files.
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPackSchemaDetail, classifyLiveClasses } from "./pack-schema";
import { TRANSITIVE_PROPERTY } from "./pack-loader";

const EXPECTED: Record<string, { title: string; classes: number; relationships: number; metrics: number; sharedWith: string[] }> = {
  cyber: { title: "GroundWork OT Security Ontology", classes: 15, relationships: 15, metrics: 6, sharedWith: ["otsec"] },
  energy: { title: "GroundWork Energy Outage Ontology", classes: 16, relationships: 13, metrics: 7, sharedWith: [] },
  otsec: { title: "GroundWork OT Security Ontology", classes: 15, relationships: 15, metrics: 6, sharedWith: ["cyber"] },
  prodquality: { title: "GroundWork Manufacturing Supply Chain Ontology", classes: 18, relationships: 16, metrics: 7, sharedWith: [] },
};

for (const [vertical, want] of Object.entries(EXPECTED)) {
  test(`${vertical}: title, counts, transitive relation, sharedWith`, () => {
    const d = loadPackSchemaDetail(vertical);
    assert.ok(d.title.length > 0);
    assert.equal(d.title, want.title);
    assert.equal(d.classes.length, want.classes);
    assert.equal(d.relationships.length, want.relationships);
    assert.equal(d.metrics.length, want.metrics);
    assert.deepEqual(d.counts, { classes: want.classes, relationships: want.relationships, metrics: want.metrics });
    const transitive = d.relationships.filter((r) => r.transitive);
    assert.equal(transitive.length, 1);
    assert.equal(transitive[0].id, TRANSITIVE_PROPERTY[d.pack]);
    assert.deepEqual(d.sharedWith, want.sharedWith);
    assert.equal(d.vertical, vertical);
    assert.equal(d.source, `packs/${d.pack}/ontology.ttl`);
    // The owl:Ontology node is not a class; ids are unique.
    assert.equal(new Set(d.classes.map((c) => c.id)).size, d.classes.length);
    assert.ok(d.classes.every((c) => c.id !== "" && !c.id.startsWith("http")));
  });
}

test("classifyLiveClasses dedupes rows and splits metric vs other classes", () => {
  const detail = { classes: [{ id: "Asset" }, { id: "Zone" }, { id: "Threat" }] };
  const live = {
    classes: [
      { id: "Asset", label: "Asset" },
      { id: "Asset", label: "Asset" },
      { id: "Zone", label: "Zone" },
      { id: "Zone", label: "Zone" },
      { id: "GovernedMetric", label: "Governed Metric" },
      { id: "ns:metric:asset_count", label: "asset_count", subClassOf: "GovernedMetric" },
      { id: "ns:metric:open_alerts", label: "open_alerts", subClassOf: "GovernedMetric" },
      { id: "Extra", label: "Extra" },
    ],
  };
  const r = classifyLiveClasses(detail, live);
  assert.equal(r.rawClassRows, 8);
  assert.equal(r.uniqueClasses, 6);
  assert.ok(r.uniqueClasses < r.rawClassRows);
  assert.equal(r.packClassesPresent, 2);
  assert.equal(r.packClassesTotal, 3);
  assert.deepEqual(r.packClassesMissing, ["Threat"]);
  assert.equal(r.metricClasses, 3);
  assert.deepEqual(r.metricsPresent, ["asset_count", "open_alerts"]);
  assert.deepEqual(r.otherClasses, ["Extra"]);
});
