"""CISA Known Exploited Vulnerabilities catalog.

Feed: https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json

The whole catalog is a single JSON document, no pagination and no key required,
which makes this the cheapest of the three feeds to run. It is also the highest
signal: KEV membership means confirmed exploitation in the wild, which the
OT Security pack's ``exploitedInWild`` property and ``kev_exposure_count`` metric
both key off.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from typing import Any

from .base import Document, fetch_json, markdown_table

logger = logging.getLogger(__name__)

KEV_FEED_URL = (
    "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
)

# Vendors whose products are predominantly ICS/OT. Used only to tag documents so
# the OT Security namespace can filter; it is a convenience, not a safety control.
ICS_VENDOR_HINTS = frozenset(
    {
        "siemens",
        "schneider electric",
        "rockwell automation",
        "rockwell",
        "honeywell",
        "abb",
        "emerson",
        "yokogawa",
        "mitsubishi electric",
        "omron",
        "ge",
        "general electric",
        "advantech",
        "moxa",
        "phoenix contact",
        "wago",
        "beckhoff",
        "codesys",
        "unitronics",
        "delta electronics",
        "hitachi energy",
    }
)


def is_ics_vendor(vendor: str) -> bool:
    normalised = (vendor or "").strip().lower()
    return any(hint in normalised for hint in ICS_VENDOR_HINTS)


def fetch_catalog(*, url: str = KEV_FEED_URL, client: Any = None) -> dict[str, Any]:
    payload = fetch_json(url, client=client)
    if not isinstance(payload, dict) or "vulnerabilities" not in payload:
        raise ValueError("KEV feed did not contain a 'vulnerabilities' array")
    return payload


def to_document(entry: dict[str, Any], *, source_url: str = KEV_FEED_URL) -> Document:
    """Render one KEV entry as a Markdown document.

    Prose is written in the OT Security ontology's vocabulary — "vulnerability",
    "affects", "exploited in the wild" — so LLM extraction lands on the intended
    classes and properties rather than inventing parallel ones.
    """
    cve_id = entry.get("cveID", "UNKNOWN")
    vendor = entry.get("vendorProject", "")
    product = entry.get("product", "")
    name = entry.get("vulnerabilityName", "")
    description = entry.get("shortDescription", "")
    action = entry.get("requiredAction", "")
    date_added = entry.get("dateAdded", "")
    due_date = entry.get("dueDate", "")
    ransomware = entry.get("knownRansomwareCampaignUse", "Unknown")
    cwes = entry.get("cwes") or []

    ics = is_ics_vendor(vendor)

    heading = name or "Known Exploited Vulnerability"
    added_phrase = date_added or "an unrecorded date"
    product_phrase = product or "an unspecified product"
    vendor_phrase = vendor or "an unspecified vendor"

    body_parts = [
        f"# {cve_id} — {heading}",
        "",
        f"**{cve_id}** is a vulnerability that is **exploited in the wild**. It is listed "
        f"in CISA's Known Exploited Vulnerabilities catalog, added on {added_phrase}.",
        "",
        f"The vulnerability affects **{product_phrase}** from **{vendor_phrase}**.",
        "",
    ]

    if description:
        body_parts += ["## Description", "", description, ""]

    if action:
        body_parts += [
            "## Required mitigation",
            "",
            f"{action}",
            "",
        ]
        if due_date:
            body_parts += [
                f"Federal civilian agencies must complete this action by {due_date}.",
                "",
            ]

    facts = [
        ["CVE ID", cve_id],
        ["Vendor", vendor or "—"],
        ["Product", product or "—"],
        ["Exploited in the wild", "Yes"],
        ["Date added to KEV", date_added or "—"],
        ["Remediation due date", due_date or "—"],
        ["Known ransomware campaign use", ransomware],
        ["ICS/OT vendor", "Yes" if ics else "No"],
    ]
    if cwes:
        facts.append(["CWE", ", ".join(cwes)])

    body_parts += ["## Facts", "", markdown_table(["Property", "Value"], facts), ""]

    if ics:
        body_parts += [
            "## OT relevance",
            "",
            f"{vendor} is an industrial control systems vendor, so assets running "
            f"{product or 'this product'} are likely to reside in the OT network. "
            "Exposure should be assessed against Purdue zoning and network reachability, "
            "not only against patch status.",
            "",
        ]

    return Document(
        key_suffix=f"{cve_id}.md",
        title=f"{cve_id} — {name}" if name else cve_id,
        body="\n".join(body_parts),
        source_url=source_url,
        upstream_id=cve_id,
        metadata={
            "feed": "cisa-kev",
            "cve_id": cve_id,
            "vendor": vendor,
            "product": product,
            "exploited_in_wild": True,
            "date_added": date_added,
            "due_date": due_date,
            "ransomware_use": ransomware,
            "ics_vendor": ics,
            "entity_types": ["Vulnerability"],
        },
    )


def documents(
    *,
    url: str = KEV_FEED_URL,
    ics_only: bool = False,
    limit: int | None = None,
    client: Any = None,
) -> Iterator[Document]:
    """Yield a Document per KEV entry.

    ``ics_only`` filters to recognised ICS vendors, which cuts a ~1,400-entry
    catalog down to the couple of hundred that matter for an OT namespace and
    correspondingly cuts extraction cost.
    """
    catalog = fetch_catalog(url=url, client=client)
    entries = catalog.get("vulnerabilities", [])
    logger.info("KEV catalog: %d entries (version %s)", len(entries), catalog.get("catalogVersion"))

    emitted = 0
    for entry in entries:
        if ics_only and not is_ics_vendor(entry.get("vendorProject", "")):
            continue
        yield to_document(entry, source_url=url)
        emitted += 1
        if limit is not None and emitted >= limit:
            break
