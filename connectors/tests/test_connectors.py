"""Connector normalisation, S3 write skipping, and the Lambda handler."""

from __future__ import annotations

import httpx
import pytest
import respx

from gw_connectors import cisa_kev, mitre_ics, nvd
from gw_connectors.base import ConnectorError, Document, S3DocumentWriter, fetch_json
from gw_connectors.handler import handler

# ── fixtures ─────────────────────────────────────────────────────────────────

KEV_PAYLOAD = {
    "catalogVersion": "2026.08.01",
    "vulnerabilities": [
        {
            "cveID": "CVE-2026-1111",
            "vendorProject": "Siemens",
            "product": "SIMATIC S7-1200",
            "vulnerabilityName": "Siemens SIMATIC Improper Authentication",
            "shortDescription": "Allows an unauthenticated attacker to alter PLC logic.",
            "requiredAction": "Apply vendor firmware update.",
            "dateAdded": "2026-07-01",
            "dueDate": "2026-07-22",
            "knownRansomwareCampaignUse": "Unknown",
            "cwes": ["CWE-287"],
        },
        {
            "cveID": "CVE-2026-2222",
            "vendorProject": "Acme Web Co",
            "product": "Acme CMS",
            "vulnerabilityName": "Acme CMS SQL Injection",
            "shortDescription": "SQL injection in the admin console.",
            "requiredAction": "Update to 4.2.1.",
            "dateAdded": "2026-07-05",
            "dueDate": "2026-07-26",
            "knownRansomwareCampaignUse": "Known",
        },
    ],
}

NVD_PAYLOAD = {
    "totalResults": 1,
    "vulnerabilities": [
        {
            "cve": {
                "id": "CVE-2026-3333",
                "published": "2026-06-01T00:00:00.000",
                "lastModified": "2026-06-15T00:00:00.000",
                "vulnStatus": "Analyzed",
                "descriptions": [
                    {"lang": "en", "value": "Stack overflow in the protocol parser."},
                    {"lang": "es", "value": "Desbordamiento."},
                ],
                "metrics": {
                    "cvssMetricV31": [
                        {"cvssData": {"baseScore": 9.8, "baseSeverity": "CRITICAL"}}
                    ],
                    "cvssMetricV2": [{"cvssData": {"baseScore": 7.5}}],
                },
                "weaknesses": [{"description": [{"value": "CWE-121"}]}],
                "configurations": [
                    {
                        "nodes": [
                            {
                                "cpeMatch": [
                                    {"criteria": "cpe:2.3:o:schneider_electric:modicon_m580:*"}
                                ]
                            }
                        ]
                    }
                ],
                "references": [{"url": "https://example.org/advisory"}],
            }
        }
    ],
}

ATTACK_BUNDLE = {
    "objects": [
        {
            "id": "attack-pattern--t1",
            "type": "attack-pattern",
            "name": "Modify Controller Tasking",
            "description": "Adversaries may modify the tasking of a controller.",
            "external_references": [
                {"source_name": "mitre-attack", "external_id": "T0821",
                 "url": "https://attack.mitre.org/techniques/T0821/"}
            ],
            "kill_chain_phases": [
                {"kill_chain_name": "mitre-ics-attack", "phase_name": "execution"}
            ],
            "x_mitre_platforms": ["None"],
        },
        {
            "id": "attack-pattern--deprecated",
            "type": "attack-pattern",
            "name": "Old Technique",
            "x_mitre_deprecated": True,
            "external_references": [
                {"source_name": "mitre-attack", "external_id": "T0000"}
            ],
        },
        {
            "id": "intrusion-set--g1",
            "type": "intrusion-set",
            "name": "VOLTZITE",
            "description": "A group targeting electric utilities.",
            "aliases": ["VOLTZITE", "Volt Typhoon"],
            "external_references": [
                {"source_name": "mitre-attack", "external_id": "G1017"}
            ],
        },
        {
            "id": "malware--m1",
            "type": "malware",
            "name": "PIPEDREAM",
            "description": "Modular ICS attack framework.",
            "external_references": [
                {"source_name": "mitre-attack", "external_id": "S1058"}
            ],
            "x_mitre_platforms": ["None"],
        },
        {
            "id": "relationship--r1",
            "type": "relationship",
            "relationship_type": "uses",
            "source_ref": "intrusion-set--g1",
            "target_ref": "attack-pattern--t1",
        },
        {
            "id": "relationship--r2",
            "type": "relationship",
            "relationship_type": "uses",
            "source_ref": "intrusion-set--g1",
            "target_ref": "malware--m1",
        },
    ]
}


class FakeS3:
    """Minimal in-memory S3 stand-in."""

    def __init__(self, existing: dict[str, bytes] | None = None):
        self.objects: dict[str, bytes] = dict(existing or {})
        self.puts: list[str] = []

    def get_object(self, Bucket: str, Key: str):  # noqa: N803 - boto3 signature
        if Key not in self.objects:
            raise KeyError(Key)

        class Body:
            def __init__(self, data: bytes):
                self._data = data

            def read(self) -> bytes:
                return self._data

        return {"Body": Body(self.objects[Key])}

    def put_object(self, Bucket: str, Key: str, Body: bytes, **kwargs):  # noqa: N803
        self.objects[Key] = Body
        self.puts.append(Key)
        return {}


# ── Document rendering ───────────────────────────────────────────────────────


def test_document_renders_frontmatter_and_body():
    doc = Document(
        key_suffix="x.md",
        title="Title: with colon",
        body="# Heading\n\nText.",
        source_url="https://example.org",
        upstream_id="X-1",
        metadata={"feed": "test", "flag": True, "items": ["a", "b"], "nothing": None},
    )
    rendered = doc.render()

    assert rendered.startswith("---\n")
    assert 'title: "Title: with colon"' in rendered  # colon forces quoting
    assert "flag: true" in rendered
    assert "  - a" in rendered
    assert "nothing" not in rendered  # None keys are dropped
    assert "# Heading" in rendered


def test_content_hash_ignores_fetched_at():
    """Otherwise every run rewrites every document and re-triggers extraction."""
    a = Document("x.md", "T", "body", "https://e", "X", fetched_at="2026-01-01T00:00:00Z")
    b = Document("x.md", "T", "body", "https://e", "X", fetched_at="2026-08-19T00:00:00Z")
    assert a.content_hash() == b.content_hash()


def test_content_hash_changes_with_body():
    a = Document("x.md", "T", "body one", "https://e", "X")
    b = Document("x.md", "T", "body two", "https://e", "X")
    assert a.content_hash() != b.content_hash()


# ── S3 writer ────────────────────────────────────────────────────────────────


def test_writer_writes_document_and_hash_sidecar():
    s3 = FakeS3()
    writer = S3DocumentWriter("bkt", "feeds/test", s3_client=s3)
    doc = Document("a.md", "T", "body", "https://e", "X")

    assert writer.write(doc) is True
    assert "feeds/test/a.md" in s3.objects
    assert "feeds/test/a.md.sha256" in s3.objects
    assert writer.written == 1


def test_writer_skips_unchanged_content():
    doc = Document("a.md", "T", "body", "https://e", "X")
    s3 = FakeS3({"feeds/test/a.md.sha256": doc.content_hash().encode()})
    writer = S3DocumentWriter("bkt", "feeds/test", s3_client=s3)

    assert writer.write(doc) is False
    assert writer.skipped == 1
    assert s3.puts == []


def test_writer_rewrites_when_hash_differs():
    s3 = FakeS3({"feeds/test/a.md.sha256": b"stale-hash"})
    writer = S3DocumentWriter("bkt", "feeds/test", s3_client=s3)

    assert writer.write(Document("a.md", "T", "body", "https://e", "X")) is True
    assert writer.written == 1


def test_dry_run_writer_needs_no_client():
    writer = S3DocumentWriter("bkt", "feeds/test", dry_run=True)
    assert writer.write(Document("a.md", "T", "body", "https://e", "X")) is True
    assert writer.written == 1


# ── fetch_json ───────────────────────────────────────────────────────────────


@respx.mock
def test_fetch_json_retries_on_429_then_succeeds(monkeypatch):
    monkeypatch.setattr("gw_connectors.base.time.sleep", lambda _: None)
    route = respx.get("https://api.example.com/data")
    route.side_effect = [
        httpx.Response(429, headers={"Retry-After": "1"}),
        httpx.Response(200, json={"ok": True}),
    ]

    assert fetch_json("https://api.example.com/data") == {"ok": True}
    assert route.call_count == 2


@respx.mock
def test_fetch_json_retries_on_500(monkeypatch):
    monkeypatch.setattr("gw_connectors.base.time.sleep", lambda _: None)
    route = respx.get("https://api.example.com/data")
    route.side_effect = [httpx.Response(503), httpx.Response(200, json=[])]

    assert fetch_json("https://api.example.com/data") == []


@respx.mock
def test_fetch_json_gives_up_after_max_retries(monkeypatch):
    monkeypatch.setattr("gw_connectors.base.time.sleep", lambda _: None)
    respx.get("https://api.example.com/data").mock(return_value=httpx.Response(429))

    with pytest.raises(ConnectorError, match="failed after"):
        fetch_json("https://api.example.com/data")


@respx.mock
def test_fetch_json_does_not_retry_a_404(monkeypatch):
    monkeypatch.setattr("gw_connectors.base.time.sleep", lambda _: None)
    route = respx.get("https://api.example.com/data").mock(
        return_value=httpx.Response(404, text="gone")
    )

    with pytest.raises(ConnectorError, match="404"):
        fetch_json("https://api.example.com/data")
    assert route.call_count == 1  # a 404 will not fix itself


# ── CISA KEV ─────────────────────────────────────────────────────────────────


def test_kev_identifies_ics_vendors():
    assert cisa_kev.is_ics_vendor("Siemens") is True
    assert cisa_kev.is_ics_vendor("Rockwell Automation") is True
    assert cisa_kev.is_ics_vendor("  SCHNEIDER ELECTRIC ") is True
    assert cisa_kev.is_ics_vendor("Acme Web Co") is False
    assert cisa_kev.is_ics_vendor("") is False


@respx.mock
def test_kev_documents_render_expected_facts():
    respx.get(cisa_kev.KEV_FEED_URL).mock(return_value=httpx.Response(200, json=KEV_PAYLOAD))

    docs = list(cisa_kev.documents())

    assert len(docs) == 2
    siemens = docs[0]
    assert siemens.upstream_id == "CVE-2026-1111"
    assert siemens.key_suffix == "CVE-2026-1111.md"
    assert siemens.metadata["exploited_in_wild"] is True
    assert siemens.metadata["ics_vendor"] is True
    assert siemens.metadata["entity_types"] == ["Vulnerability"]
    # Ontology vocabulary must appear so extraction lands on the right classes.
    assert "exploited in the wild" in siemens.body
    assert "OT relevance" in siemens.body
    assert "2026-07-22" in siemens.body  # due date


@respx.mock
def test_kev_ics_only_filters_non_ics_vendors():
    respx.get(cisa_kev.KEV_FEED_URL).mock(return_value=httpx.Response(200, json=KEV_PAYLOAD))

    docs = list(cisa_kev.documents(ics_only=True))

    assert [d.upstream_id for d in docs] == ["CVE-2026-1111"]


@respx.mock
def test_kev_limit_is_respected():
    respx.get(cisa_kev.KEV_FEED_URL).mock(return_value=httpx.Response(200, json=KEV_PAYLOAD))
    assert len(list(cisa_kev.documents(limit=1))) == 1


@respx.mock
def test_kev_rejects_malformed_feed():
    respx.get(cisa_kev.KEV_FEED_URL).mock(return_value=httpx.Response(200, json={"nope": 1}))
    with pytest.raises(ValueError, match="vulnerabilities"):
        list(cisa_kev.documents())


# ── NVD ──────────────────────────────────────────────────────────────────────


def test_nvd_prefers_v31_over_v2():
    """Deterministic score selection: v4.0 > v3.1 > v3.0 > v2."""
    score, version, severity = nvd._best_cvss(NVD_PAYLOAD["vulnerabilities"][0]["cve"]["metrics"])
    assert score == 9.8
    assert version == "3.1"
    assert severity == "CRITICAL"


def test_nvd_best_cvss_handles_absent_metrics():
    assert nvd._best_cvss({}) == (None, None, None)


def test_nvd_picks_english_description():
    cve = NVD_PAYLOAD["vulnerabilities"][0]["cve"]
    assert nvd._english_description(cve).startswith("Stack overflow")


def test_nvd_flattens_cpe_to_readable_products():
    cve = NVD_PAYLOAD["vulnerabilities"][0]["cve"]
    assert nvd._affected_products(cve) == ["schneider electric modicon m580"]


@respx.mock
def test_nvd_documents_and_api_key_header(monkeypatch):
    monkeypatch.setattr("gw_connectors.nvd.time.sleep", lambda _: None)
    route = respx.get(url__startswith=nvd.NVD_CVE_API).mock(
        return_value=httpx.Response(200, json=NVD_PAYLOAD)
    )

    docs = list(nvd.documents(api_key="secret-key"))

    assert len(docs) == 1
    doc = docs[0]
    assert doc.upstream_id == "CVE-2026-3333"
    assert doc.metadata["cvss_score"] == 9.8
    assert "nvd.nist.gov/vuln/detail/CVE-2026-3333" in doc.source_url
    assert "schneider electric modicon m580" in doc.body
    # API 2.0 requires the key in a header, not a query parameter.
    assert route.calls.last.request.headers["apiKey"] == "secret-key"


@respx.mock
def test_nvd_omits_api_key_header_when_absent(monkeypatch):
    monkeypatch.setattr("gw_connectors.nvd.time.sleep", lambda _: None)
    route = respx.get(url__startswith=nvd.NVD_CVE_API).mock(
        return_value=httpx.Response(200, json=NVD_PAYLOAD)
    )

    list(nvd.documents())

    assert "apiKey" not in route.calls.last.request.headers


@respx.mock
def test_nvd_stops_on_empty_page(monkeypatch):
    monkeypatch.setattr("gw_connectors.nvd.time.sleep", lambda _: None)
    respx.get(url__startswith=nvd.NVD_CVE_API).mock(
        return_value=httpx.Response(200, json={"totalResults": 0, "vulnerabilities": []})
    )
    assert list(nvd.documents()) == []


# ── MITRE ATT&CK ICS ─────────────────────────────────────────────────────────


@respx.mock
def test_mitre_emits_techniques_groups_and_malware():
    respx.get(mitre_ics.ICS_ATTACK_URL).mock(
        return_value=httpx.Response(200, json=ATTACK_BUNDLE)
    )

    docs = list(mitre_ics.documents())
    by_id = {d.upstream_id: d for d in docs}

    assert set(by_id) == {"T0821", "G1017", "S1058"}
    assert by_id["T0821"].key_suffix == "techniques/T0821.md"
    assert by_id["G1017"].key_suffix == "groups/G1017.md"
    assert by_id["S1058"].key_suffix == "malware/S1058.md"


@respx.mock
def test_mitre_skips_deprecated_objects():
    respx.get(mitre_ics.ICS_ATTACK_URL).mock(
        return_value=httpx.Response(200, json=ATTACK_BUNDLE)
    )
    assert "T0000" not in {d.upstream_id for d in mitre_ics.documents()}


@respx.mock
def test_mitre_group_document_states_relationships():
    """usesTechnique and deploysMalware must appear as prose.

    Without the relationship sentences, extraction produces three unconnected
    entities and the graph loses the edges the ontology declares.
    """
    respx.get(mitre_ics.ICS_ATTACK_URL).mock(
        return_value=httpx.Response(200, json=ATTACK_BUNDLE)
    )

    group = next(d for d in mitre_ics.documents() if d.upstream_id == "G1017")

    assert "Techniques used" in group.body
    assert "T0821" in group.body
    assert "Malware deployed" in group.body
    assert "PIPEDREAM" in group.body
    assert "Volt Typhoon" in group.body  # alias preserved
    assert group.metadata["technique_count"] == 1


@respx.mock
def test_mitre_malware_document_records_attribution():
    respx.get(mitre_ics.ICS_ATTACK_URL).mock(
        return_value=httpx.Response(200, json=ATTACK_BUNDLE)
    )

    malware = next(d for d in mitre_ics.documents() if d.upstream_id == "S1058")

    assert "VOLTZITE" in malware.body
    assert "Attribution" in malware.body


@respx.mock
def test_mitre_rejects_malformed_bundle():
    respx.get(mitre_ics.ICS_ATTACK_URL).mock(return_value=httpx.Response(200, json={"x": 1}))
    with pytest.raises(ValueError, match="objects"):
        list(mitre_ics.documents())


# ── Lambda handler ───────────────────────────────────────────────────────────


@respx.mock
def test_handler_runs_a_single_feed(monkeypatch):
    monkeypatch.setenv("FEED_BUCKET", "bkt")
    respx.get(cisa_kev.KEV_FEED_URL).mock(return_value=httpx.Response(200, json=KEV_PAYLOAD))

    fake = FakeS3()
    monkeypatch.setattr(
        "gw_connectors.handler.S3DocumentWriter",
        lambda bucket, prefix, **kw: S3DocumentWriter(bucket, prefix, s3_client=fake),
    )

    result = handler({"feed": "kev"})

    assert result["written"] == 2
    assert result["failed"] == 0
    assert result["results"][0]["feed"] == "cisa-kev"


def test_handler_requires_a_bucket(monkeypatch):
    monkeypatch.delenv("FEED_BUCKET", raising=False)
    with pytest.raises(ValueError, match="FEED_BUCKET"):
        handler({})


def test_handler_rejects_unknown_feed(monkeypatch):
    monkeypatch.setenv("FEED_BUCKET", "bkt")
    with pytest.raises(ValueError, match="unknown feed"):
        handler({"feed": "gossip"})


@respx.mock
def test_handler_all_reports_partial_failure_instead_of_raising(monkeypatch):
    """One dead upstream must not discard the feeds that worked."""
    monkeypatch.setenv("FEED_BUCKET", "bkt")
    monkeypatch.setattr("gw_connectors.base.time.sleep", lambda _: None)
    monkeypatch.setattr("gw_connectors.nvd.time.sleep", lambda _: None)

    respx.get(cisa_kev.KEV_FEED_URL).mock(return_value=httpx.Response(200, json=KEV_PAYLOAD))
    respx.get(mitre_ics.ICS_ATTACK_URL).mock(return_value=httpx.Response(500))
    respx.get(url__startswith=nvd.NVD_CVE_API).mock(
        return_value=httpx.Response(200, json={"totalResults": 0, "vulnerabilities": []})
    )

    fake = FakeS3()
    monkeypatch.setattr(
        "gw_connectors.handler.S3DocumentWriter",
        lambda bucket, prefix, **kw: S3DocumentWriter(bucket, prefix, s3_client=fake),
    )

    result = handler({"feed": "all"})

    assert result["failed"] == 1
    assert result["errors"][0]["feed"] == "mitre-ics"
    assert result["written"] == 2  # KEV still landed


def test_handler_clamps_nvd_window_to_120_days():
    from gw_connectors.handler import _nvd_window

    start, end = _nvd_window(400)
    assert start is not None and end is not None
    # Clamped, so the span must be ~120 days, not 400.
    assert _nvd_window(None) == (None, None)
