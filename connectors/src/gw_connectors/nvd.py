"""NVD CVE API 2.0.

Docs: https://nvd.nist.gov/developers/vulnerabilities

Two operational facts drive the design here:

* The 1.0 APIs and the legacy data feeds were retired in December 2023. Only
  2.0 exists, and it uses offset-based pagination with a hard 2,000-record page.
* An API key is passed in the ``apiKey`` request header — not a query parameter,
  which is how 1.0 accepted it. Without a key the rate limit is low enough that
  any real backfill will hit 429, so ``fetch_json`` honours Retry-After and this
  module sleeps between pages.

Request an API key at https://nvd.nist.gov/developers/request-an-api-key
"""

from __future__ import annotations

import logging
import time
from collections.abc import Iterator
from typing import Any

from .base import Document, fetch_json, markdown_table

logger = logging.getLogger(__name__)

NVD_CVE_API = "https://services.nvd.nist.gov/rest/json/cves/2.0"

PAGE_SIZE = 2000  # API maximum
# NVD asks for roughly 6s between requests without a key, 0.6s with one.
SLEEP_WITH_KEY = 0.7
SLEEP_WITHOUT_KEY = 6.5


def _headers(api_key: str | None) -> dict[str, str]:
    return {"apiKey": api_key} if api_key else {}


def _best_cvss(metrics: dict[str, Any]) -> tuple[float | None, str | None, str | None]:
    """Highest-priority CVSS score available: v4.0, then v3.1, then v3.0, then v2.

    NVD returns several metric versions per CVE and callers almost always want
    "the" score, so pick deterministically rather than whatever iterates first.
    """
    for key, label in (
        ("cvssMetricV40", "4.0"),
        ("cvssMetricV31", "3.1"),
        ("cvssMetricV30", "3.0"),
        ("cvssMetricV2", "2.0"),
    ):
        entries = metrics.get(key) or []
        if not entries:
            continue
        data = entries[0].get("cvssData", {})
        score = data.get("baseScore")
        severity = data.get("baseSeverity") or entries[0].get("baseSeverity")
        if score is not None:
            return float(score), label, severity
    return None, None, None


def _english_description(cve: dict[str, Any]) -> str:
    for item in cve.get("descriptions", []):
        if item.get("lang") == "en":
            return item.get("value", "")
    return ""


def _affected_products(cve: dict[str, Any], limit: int = 25) -> list[str]:
    """Flatten CPE match criteria into readable vendor/product strings."""
    seen: list[str] = []
    for config in cve.get("configurations", []):
        for node in config.get("nodes", []):
            for match in node.get("cpeMatch", []):
                criteria = match.get("criteria", "")
                # cpe:2.3:a:vendor:product:version:...
                parts = criteria.split(":")
                if len(parts) >= 5:
                    vendor = parts[3].replace("_", " ")
                    product = parts[4].replace("_", " ")
                    label = f"{vendor} {product}".strip()
                    if label and label not in seen:
                        seen.append(label)
                        if len(seen) >= limit:
                            return seen
    return seen


def to_document(cve: dict[str, Any], *, source_url: str = NVD_CVE_API) -> Document:
    cve_id = cve.get("id", "UNKNOWN")
    description = _english_description(cve)
    score, version, severity = _best_cvss(cve.get("metrics", {}))
    published = cve.get("published", "")
    modified = cve.get("lastModified", "")
    status = cve.get("vulnStatus", "")
    products = _affected_products(cve)

    weaknesses: list[str] = []
    for weakness in cve.get("weaknesses", []):
        for item in weakness.get("description", []):
            value = item.get("value")
            if value and value not in weaknesses:
                weaknesses.append(value)

    references = [
        ref.get("url") for ref in cve.get("references", [])[:10] if ref.get("url")
    ]

    body = [
        f"# {cve_id}",
        "",
        f"**{cve_id}** is a vulnerability published on {published or 'an unrecorded date'}.",
    ]
    if score is not None:
        body.append(
            f" It carries a CVSS v{version} base score of **{score}**"
            f"{f' ({severity})' if severity else ''}."
        )
    body += ["", "## Description", "", description or "_No description provided._", ""]

    facts = [
        ["CVE ID", cve_id],
        ["CVSS base score", f"{score} (v{version})" if score is not None else "—"],
        ["Severity", severity or "—"],
        ["Published", published or "—"],
        ["Last modified", modified or "—"],
        ["NVD status", status or "—"],
    ]
    if weaknesses:
        facts.append(["Weakness (CWE)", ", ".join(weaknesses)])
    body += ["## Facts", "", markdown_table(["Property", "Value"], facts), ""]

    if products:
        body += [
            "## Affected products",
            "",
            f"This vulnerability affects the following products:",
            "",
        ]
        body += [f"- {product}" for product in products]
        body.append("")

    if references:
        body += ["## References", ""]
        body += [f"- {url}" for url in references]
        body.append("")

    return Document(
        key_suffix=f"{cve_id}.md",
        title=cve_id,
        body="\n".join(body),
        source_url=f"https://nvd.nist.gov/vuln/detail/{cve_id}",
        upstream_id=cve_id,
        metadata={
            "feed": "nvd",
            "cve_id": cve_id,
            "cvss_score": score,
            "cvss_version": version,
            "severity": severity,
            "published": published,
            "last_modified": modified,
            "cwes": weaknesses,
            "entity_types": ["Vulnerability"],
        },
    )


def documents(
    *,
    api_key: str | None = None,
    keyword: str | None = None,
    cpe_name: str | None = None,
    last_mod_start: str | None = None,
    last_mod_end: str | None = None,
    limit: int | None = None,
    url: str = NVD_CVE_API,
    client: Any = None,
    sleep: float | None = None,
) -> Iterator[Document]:
    """Page through the CVE API and yield a Document per CVE.

    For incremental runs pass ``last_mod_start``/``last_mod_end`` (ISO-8601, and
    NVD caps the window at 120 days). For an OT-focused pull, ``keyword`` with a
    vendor name is the cheapest useful filter.
    """
    delay = sleep if sleep is not None else (SLEEP_WITH_KEY if api_key else SLEEP_WITHOUT_KEY)
    headers = _headers(api_key)
    if not api_key:
        logger.warning(
            "no NVD API key supplied — throttling to %.1fs between pages. "
            "Request one at https://nvd.nist.gov/developers/request-an-api-key",
            delay,
        )

    start_index = 0
    emitted = 0
    total: int | None = None

    while True:
        params: dict[str, Any] = {"resultsPerPage": PAGE_SIZE, "startIndex": start_index}
        if keyword:
            params["keywordSearch"] = keyword
        if cpe_name:
            params["cpeName"] = cpe_name
        if last_mod_start and last_mod_end:
            params["lastModStartDate"] = last_mod_start
            params["lastModEndDate"] = last_mod_end

        payload = fetch_json(url, params=params, headers=headers, client=client)
        vulnerabilities = payload.get("vulnerabilities", [])
        if total is None:
            total = payload.get("totalResults", 0)
            logger.info("NVD reports %s matching CVE records", total)

        if not vulnerabilities:
            break

        for wrapper in vulnerabilities:
            cve = wrapper.get("cve")
            if not cve:
                continue
            yield to_document(cve, source_url=url)
            emitted += 1
            if limit is not None and emitted >= limit:
                return

        start_index += len(vulnerabilities)
        if total is not None and start_index >= total:
            break

        time.sleep(delay)
