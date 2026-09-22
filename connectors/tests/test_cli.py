"""Connector CLI. Dry-run everywhere so no test touches AWS."""

from __future__ import annotations

import httpx
import pytest
import respx
from click.testing import CliRunner

from gw_connectors import cisa_kev, mitre_ics, nvd
from gw_connectors.cli import main
from tests.test_connectors import ATTACK_BUNDLE, KEV_PAYLOAD, NVD_PAYLOAD


@pytest.fixture
def runner():
    return CliRunner()


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr("gw_connectors.base.time.sleep", lambda _: None)
    monkeypatch.setattr("gw_connectors.nvd.time.sleep", lambda _: None)


@respx.mock
def test_kev_dry_run(runner):
    respx.get(cisa_kev.KEV_FEED_URL).mock(return_value=httpx.Response(200, json=KEV_PAYLOAD))

    result = runner.invoke(main, ["kev", "--bucket", "bkt", "--dry-run"])

    assert result.exit_code == 0, result.output
    assert "would write 2" in result.output
    assert "s3://bkt/feeds/cisa-kev/" in result.output


@respx.mock
def test_kev_ics_only_dry_run(runner):
    respx.get(cisa_kev.KEV_FEED_URL).mock(return_value=httpx.Response(200, json=KEV_PAYLOAD))

    result = runner.invoke(main, ["kev", "--bucket", "bkt", "--ics-only", "--dry-run"])

    assert result.exit_code == 0
    assert "would write 1" in result.output


@respx.mock
def test_kev_upstream_failure_exits_1(runner):
    respx.get(cisa_kev.KEV_FEED_URL).mock(return_value=httpx.Response(429))

    result = runner.invoke(main, ["kev", "--bucket", "bkt", "--dry-run"])

    assert result.exit_code == 1
    assert "✗" in result.output


@respx.mock
def test_nvd_dry_run_warns_without_api_key(runner, monkeypatch):
    monkeypatch.delenv("NVD_API_KEY", raising=False)
    respx.get(url__startswith=nvd.NVD_CVE_API).mock(
        return_value=httpx.Response(200, json=NVD_PAYLOAD)
    )

    result = runner.invoke(main, ["nvd", "--bucket", "bkt", "--dry-run"])

    assert result.exit_code == 0, result.output
    assert "no NVD API key" in result.output
    assert "would write 1" in result.output


def test_nvd_rejects_half_a_window(runner):
    """Both window bounds or neither — NVD 400s otherwise."""
    result = runner.invoke(
        main, ["nvd", "--bucket", "bkt", "--last-mod-start", "2026-01-01T00:00:00.000Z"]
    )
    assert result.exit_code == 2
    assert "must be given together" in result.output


@respx.mock
def test_mitre_ics_dry_run(runner):
    respx.get(mitre_ics.ICS_ATTACK_URL).mock(
        return_value=httpx.Response(200, json=ATTACK_BUNDLE)
    )

    result = runner.invoke(main, ["mitre-ics", "--bucket", "bkt", "--dry-run"])

    assert result.exit_code == 0, result.output
    assert "would write 3" in result.output


@respx.mock
def test_all_runs_every_feed(runner, monkeypatch):
    monkeypatch.delenv("NVD_API_KEY", raising=False)
    respx.get(cisa_kev.KEV_FEED_URL).mock(return_value=httpx.Response(200, json=KEV_PAYLOAD))
    respx.get(mitre_ics.ICS_ATTACK_URL).mock(
        return_value=httpx.Response(200, json=ATTACK_BUNDLE)
    )
    respx.get(url__startswith=nvd.NVD_CVE_API).mock(
        return_value=httpx.Response(200, json=NVD_PAYLOAD)
    )

    result = runner.invoke(main, ["all", "--bucket", "bkt", "--dry-run"])

    assert result.exit_code == 0, result.output
    assert "cisa-kev" in result.output
    assert "mitre-attack-ics" in result.output
    assert "nvd" in result.output
    assert "all feeds complete" in result.output


@respx.mock
def test_all_exits_1_on_partial_failure(runner, monkeypatch):
    monkeypatch.delenv("NVD_API_KEY", raising=False)
    respx.get(cisa_kev.KEV_FEED_URL).mock(return_value=httpx.Response(200, json=KEV_PAYLOAD))
    respx.get(mitre_ics.ICS_ATTACK_URL).mock(return_value=httpx.Response(500))
    respx.get(url__startswith=nvd.NVD_CVE_API).mock(
        return_value=httpx.Response(200, json=NVD_PAYLOAD)
    )

    result = runner.invoke(main, ["all", "--bucket", "bkt", "--dry-run"])

    assert result.exit_code == 1
    assert "1 feed(s) failed" in result.output
    # The feeds that worked still reported.
    assert "cisa-kev" in result.output


def test_bucket_is_required(runner):
    result = runner.invoke(main, ["kev", "--dry-run"])
    assert result.exit_code == 2
    assert "--bucket" in result.output


@respx.mock
def test_custom_prefix_is_used(runner):
    respx.get(cisa_kev.KEV_FEED_URL).mock(return_value=httpx.Response(200, json=KEV_PAYLOAD))

    result = runner.invoke(
        main, ["kev", "--bucket", "bkt", "--prefix", "threat-intel", "--dry-run"]
    )

    assert "s3://bkt/threat-intel/cisa-kev/" in result.output
