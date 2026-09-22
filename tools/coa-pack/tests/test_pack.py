"""Pack loading and validation.

Each test that asserts a rejection names the COA constraint it protects, so a
future maintainer can tell which rules are ours and which are COA's.
"""

from __future__ import annotations

import textwrap

import pytest

from coa_pack.errors import PackValidationError
from coa_pack.pack import discover_packs, load_pack


def findings_for(make_pack, **kwargs) -> list[tuple[str, str]]:
    """Load a pack expecting failure; return its findings."""
    with pytest.raises(PackValidationError) as exc_info:
        load_pack(make_pack(**kwargs))
    return exc_info.value.findings


def pointers(findings: list[tuple[str, str]]) -> str:
    return " | ".join(f"{p}: {m}" for p, m in findings)


# ── happy path ───────────────────────────────────────────────────────────────


def test_loads_a_valid_pack(make_pack):
    pack = load_pack(make_pack())

    assert pack.name == "Test Pack"
    assert pack.version == "1.0.0"
    assert pack.ontology.ontology_iri == "https://example.org/test"
    assert pack.ontology.class_count == 2
    assert pack.ontology.object_property_count == 1
    assert pack.metric_names == ("widget_count",)
    assert pack.ontology.content_type == "text/turtle"
    assert pack.ontology.ingest_format == "turtle"


def test_ontology_type_defaults_to_user_created(make_pack):
    # A hand-authored pack ontology is neither foundational (COA-shipped) nor
    # induced (produced by a data scan).
    assert load_pack(make_pack()).ontology_type == "user_created"


def test_metrics_are_optional(make_pack):
    manifest = textwrap.dedent(
        """\
        name: Ontology Only
        version: 0.1.0
        description: No metrics here
        ontology: ontology.ttl
        """
    )
    pack = load_pack(make_pack(manifest=manifest, metrics=None))
    assert pack.metric_names == ()
    assert pack.metrics_path is None
    assert pack.metrics_yaml is None


# ── ontology rules ───────────────────────────────────────────────────────────


def test_rejects_ontology_without_owl_ontology_subject(make_pack):
    """COA derives the ontology id from owl:Ontology and errors without one.

    Without this check the install "succeeds" with a randomly minted
    urn:ontology:upload-<hex> IRI, and reinstalling duplicates the ontology
    instead of conflicting. Catching it offline is much cheaper.
    """
    ttl = textwrap.dedent(
        """\
        @prefix ex:  <https://example.org/test#> .
        @prefix owl: <http://www.w3.org/2002/07/owl#> .

        ex:Widget a owl:Class .
        """
    )
    findings = findings_for(make_pack, ontology=ttl)
    assert "no owl:Ontology subject" in pointers(findings)


def test_rejects_multiple_owl_ontology_subjects(make_pack):
    ttl = textwrap.dedent(
        """\
        @prefix ex:  <https://example.org/test#> .
        @prefix owl: <http://www.w3.org/2002/07/owl#> .

        <https://example.org/one> a owl:Ontology .
        <https://example.org/two> a owl:Ontology .
        ex:Widget a owl:Class .
        """
    )
    findings = findings_for(make_pack, ontology=ttl)
    assert "owl:Ontology subjects declared" in pointers(findings)


def test_rejects_ontology_with_no_classes(make_pack):
    ttl = textwrap.dedent(
        """\
        @prefix owl: <http://www.w3.org/2002/07/owl#> .
        <https://example.org/test> a owl:Ontology .
        """
    )
    findings = findings_for(make_pack, ontology=ttl)
    assert "no owl:Class" in pointers(findings)


def test_rejects_unparseable_turtle(make_pack):
    findings = findings_for(make_pack, ontology="this is not turtle at all {{{")
    assert "not valid turtle" in pointers(findings)


def test_rejects_unsupported_ontology_extension(make_pack):
    """COA accepts RDF serialisations only — no OWL functional syntax, no OMN."""
    manifest = textwrap.dedent(
        """\
        name: Bad Format
        version: 1.0.0
        description: Wrong extension
        ontology: ontology.omn
        """
    )
    findings = findings_for(
        make_pack, manifest=manifest, ontology_filename="ontology.omn", metrics=None
    )
    assert "unsupported extension" in pointers(findings)


def test_detects_transitive_properties(make_pack):
    # Not a validation rule, but the transitive relation is the modelling point
    # of every shipped pack, so confirm the parse surfaces it.
    from rdflib import OWL, RDF, Graph

    pack = load_pack(make_pack())
    graph = Graph()
    graph.parse(str(pack.ontology.path), format="turtle")
    assert set(graph.subjects(RDF.type, OWL.TransitiveProperty))


# ── manifest rules ───────────────────────────────────────────────────────────


def test_missing_manifest_is_rejected(make_pack):
    findings = findings_for(make_pack, manifest=None)
    assert "missing pack.yaml" in pointers(findings)


def test_missing_required_manifest_fields_are_all_reported(make_pack):
    """All findings at once — fixing one field per run is miserable."""
    findings = findings_for(make_pack, manifest="ontology: ontology.ttl\n")
    reported = pointers(findings)
    assert "$.name" in reported
    assert "$.version" in reported
    assert "$.description" in reported


def test_missing_ontology_key_is_rejected(make_pack):
    manifest = "name: X\nversion: 1.0.0\ndescription: Y\n"
    findings = findings_for(make_pack, manifest=manifest, metrics=None)
    assert "$.ontology" in pointers(findings)


def test_ontology_file_not_found_is_rejected(make_pack):
    manifest = textwrap.dedent(
        """\
        name: X
        version: 1.0.0
        description: Y
        ontology: nope.ttl
        """
    )
    findings = findings_for(make_pack, manifest=manifest, metrics=None)
    assert "file not found" in pointers(findings)


def test_invalid_ontology_type_is_rejected(make_pack):
    manifest = textwrap.dedent(
        """\
        name: X
        version: 1.0.0
        description: Y
        ontology: ontology.ttl
        ontology_type: nonsense
        """
    )
    findings = findings_for(make_pack, manifest=manifest, metrics=None)
    assert "$.ontology_type" in pointers(findings)


def test_invalid_grant_principal_type_is_rejected(make_pack):
    manifest = textwrap.dedent(
        """\
        name: X
        version: 1.0.0
        description: Y
        ontology: ontology.ttl
        grants:
          - principalType: ROBOT
            principalId: someone@example.com
            role: namespace_data_analyst
        """
    )
    findings = findings_for(make_pack, manifest=manifest, metrics=None)
    assert "must be USER, GROUP or AGENT" in pointers(findings)


def test_grant_missing_role_is_rejected(make_pack):
    manifest = textwrap.dedent(
        """\
        name: X
        version: 1.0.0
        description: Y
        ontology: ontology.ttl
        grants:
          - principalType: USER
            principalId: someone@example.com
        """
    )
    findings = findings_for(make_pack, manifest=manifest, metrics=None)
    assert "$.grants[0].role" in pointers(findings)


# ── OSI rules (mirroring COA's osi_parser) ───────────────────────────────────


def test_rejects_missing_osi_spec_version(make_pack):
    osi = textwrap.dedent(
        """\
        metrics:
          - name: m
            description: d
            expression:
              dialects:
                - dialect: ANSI_SQL
                  expression: "COUNT(*)"
        """
    )
    findings = findings_for(make_pack, metrics=osi)
    assert "$.osi_spec_version" in pointers(findings)


def test_rejects_wrong_osi_spec_version(make_pack):
    osi = VALID_OSI_WITH_VERSION = textwrap.dedent(
        """\
        osi_spec_version: "2.0"
        metrics:
          - name: m
            description: d
            expression:
              dialects:
                - dialect: ANSI_SQL
                  expression: "COUNT(*)"
        """
    )
    findings = findings_for(make_pack, metrics=osi)
    assert "must be '1.0'" in pointers(findings)


def test_rejects_empty_metrics_list(make_pack):
    findings = findings_for(make_pack, metrics='osi_spec_version: "1.0"\nmetrics: []\n')
    assert "$.metrics" in pointers(findings)


def test_rejects_metric_without_dialects(make_pack):
    osi = textwrap.dedent(
        """\
        osi_spec_version: "1.0"
        metrics:
          - name: m
            description: d
            expression: {}
        """
    )
    findings = findings_for(make_pack, metrics=osi)
    assert "$.metrics[0].expression.dialects" in pointers(findings)


def test_rejects_dialect_entry_missing_expression(make_pack):
    osi = textwrap.dedent(
        """\
        osi_spec_version: "1.0"
        metrics:
          - name: m
            description: d
            expression:
              dialects:
                - dialect: ANSI_SQL
        """
    )
    findings = findings_for(make_pack, metrics=osi)
    assert "$.metrics[0].expression.dialects[0].expression" in pointers(findings)


def test_rejects_unknown_dialect(make_pack):
    """COA maps exactly three dialects; anything else is silently dropped."""
    osi = textwrap.dedent(
        """\
        osi_spec_version: "1.0"
        metrics:
          - name: m
            description: d
            expression:
              dialects:
                - dialect: ORACLE
                  expression: "COUNT(*)"
        """
    )
    findings = findings_for(make_pack, metrics=osi)
    assert "unknown dialect 'ORACLE'" in pointers(findings)


def test_rejects_string_ai_context(make_pack):
    """ai_context is a structured object in OSI v1.0.

    Authors coming from prose metric docs write a paragraph here constantly.
    """
    osi = textwrap.dedent(
        """\
        osi_spec_version: "1.0"
        metrics:
          - name: m
            description: d
            expression:
              dialects:
                - dialect: ANSI_SQL
                  expression: "COUNT(*)"
            ai_context: "just use it for counting things"
        """
    )
    findings = findings_for(make_pack, metrics=osi)
    assert "not a string" in pointers(findings)


def test_rejects_duplicate_metric_names(make_pack):
    osi = textwrap.dedent(
        """\
        osi_spec_version: "1.0"
        metrics:
          - name: dup
            description: first
            expression:
              dialects:
                - dialect: ANSI_SQL
                  expression: "COUNT(*)"
          - name: dup
            description: second
            expression:
              dialects:
                - dialect: ANSI_SQL
                  expression: "SUM(1)"
        """
    )
    findings = findings_for(make_pack, metrics=osi)
    assert "duplicate metric name" in pointers(findings)


def test_rejects_metric_missing_description(make_pack):
    osi = textwrap.dedent(
        """\
        osi_spec_version: "1.0"
        metrics:
          - name: m
            expression:
              dialects:
                - dialect: ANSI_SQL
                  expression: "COUNT(*)"
        """
    )
    findings = findings_for(make_pack, metrics=osi)
    assert "$.metrics[0].description" in pointers(findings)


# ── sources rules ────────────────────────────────────────────────────────────


def test_rejects_unknown_source_type(make_pack):
    """COA has exactly three source shapes and no plugin model."""
    manifest = textwrap.dedent(
        """\
        name: X
        version: 1.0.0
        description: Y
        ontology: ontology.ttl
        sources: sources.yaml
        """
    )
    sources = textwrap.dedent(
        """\
        sources:
          - sourceType: KAFKA
            databaseSource:
              name: stream
        """
    )
    findings = findings_for(make_pack, manifest=manifest, metrics=None, sources=sources)
    assert "must be DATABASE or DOCUMENTS" in pointers(findings)


def test_rejects_source_with_both_configs(make_pack):
    manifest = textwrap.dedent(
        """\
        name: X
        version: 1.0.0
        description: Y
        ontology: ontology.ttl
        sources: sources.yaml
        """
    )
    sources = textwrap.dedent(
        """\
        sources:
          - sourceType: DATABASE
            databaseSource:
              name: a
            documentSource:
              name: b
        """
    )
    findings = findings_for(make_pack, manifest=manifest, metrics=None, sources=sources)
    assert "exactly one of databaseSource / documentSource" in pointers(findings)


def test_empty_sources_list_is_valid(make_pack):
    """Shipped packs ship `sources: []` on purpose — registration is not idempotent."""
    manifest = textwrap.dedent(
        """\
        name: X
        version: 1.0.0
        description: Y
        ontology: ontology.ttl
        sources: sources.yaml
        """
    )
    pack = load_pack(
        make_pack(manifest=manifest, metrics=None, sources="sources: []\n")
    )
    assert pack.sources == ()


# ── discovery ────────────────────────────────────────────────────────────────


def test_discover_packs_finds_only_dirs_with_manifest(tmp_path, make_pack):
    make_pack(name="good-one")
    (tmp_path / "not-a-pack").mkdir()
    (tmp_path / "loose-file.txt").write_text("x", encoding="utf-8")

    found = discover_packs(tmp_path)
    assert [p.name for p in found] == ["good-one"]


def test_discover_packs_on_missing_dir_returns_empty(tmp_path):
    assert discover_packs(tmp_path / "nope") == []


# ── x_coa -> custom_extensions translation (emit-time) ───────────────────────


def test_metrics_yaml_translates_x_coa_to_custom_extensions(make_pack):
    """COA's osi_parser reads per-metric vendor data only from custom_extensions.

    The pack authors it as the readable `x_coa:` shorthand; metrics_yaml must
    emit the `custom_extensions: [{vendor_name: COA, data: {...}}]` wire shape
    COA expects, or the metric imports with no source binding and never resolves.
    """
    import yaml

    pack = load_pack(make_pack())
    emitted = pack.metrics_yaml
    assert emitted is not None

    doc = yaml.safe_load(emitted)
    metric = doc["metrics"][0]
    assert "x_coa" not in metric, "x_coa must not leak into the emitted OSI"
    ext = metric["custom_extensions"]
    assert ext == [
        {
            "vendor_name": "COA",
            "data": {
                "data_source_id": "ds-test",
                "source_table": "public.widgets",
                "return_type": "integer",
            },
        }
    ]

    # The on-disk pack file is left in its readable x_coa form — only the emitted
    # content is translated.
    assert "x_coa:" in (pack.metrics_path.read_text(encoding="utf-8"))


def test_metrics_yaml_passes_through_custom_extensions_unchanged(make_pack):
    """A pack already using custom_extensions (no x_coa) is emitted verbatim."""
    osi = textwrap.dedent(
        """\
        osi_spec_version: "1.0"
        metrics:
          - name: widget_count
            description: "Count of widgets"
            expression:
              dialects:
                - dialect: ANSI_SQL
                  expression: "COUNT(*)"
            custom_extensions:
              - vendor_name: COA
                data:
                  data_source_id: ds-test
                  source_table: public.widgets
        """
    )
    pack = load_pack(make_pack(metrics=osi))
    assert pack.metrics_yaml == osi
