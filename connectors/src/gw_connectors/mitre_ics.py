"""MITRE ATT&CK for ICS.

Source: the attack-stix-data repository, which is MITRE's published STIX 2.1
bundle for the ICS matrix.

Unlike NVD and KEV — which yield only vulnerabilities — this feed produces three
entity types that map directly onto the OT Security pack ontology:

    attack-pattern  -> ICSTechnique      (with attackId from the ATT&CK external ref)
    intrusion-set   -> ThreatGroup       (VOLTZITE, KAMACITE, ELECTRUM, ...)
    malware / tool  -> Malware           (PIPEDREAM, INDUSTROYER2, ...)

Relationship objects in the bundle give us the edges: ``uses`` between an
intrusion-set and an attack-pattern becomes ``usesTechnique``; between an
intrusion-set and malware it becomes ``deploysMalware``. Emitting those edges as
prose in the group document is what lets extraction reconstruct them.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from typing import Any

from .base import Document, fetch_json, markdown_table

logger = logging.getLogger(__name__)

ICS_ATTACK_URL = (
    "https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/"
    "ics-attack/ics-attack.json"
)

_WANTED_TYPES = frozenset({"attack-pattern", "intrusion-set", "malware", "tool"})


def _attack_id(obj: dict[str, Any]) -> str | None:
    """Pull the Txxxx / Gxxxx / Sxxxx id out of external_references."""
    for ref in obj.get("external_references", []):
        if ref.get("source_name") in ("mitre-attack", "mitre-ics-attack"):
            return ref.get("external_id")
    return None


def _attack_url(obj: dict[str, Any]) -> str | None:
    for ref in obj.get("external_references", []):
        if ref.get("source_name") in ("mitre-attack", "mitre-ics-attack"):
            return ref.get("url")
    return None


def _is_deprecated(obj: dict[str, Any]) -> bool:
    return bool(obj.get("revoked")) or bool(obj.get("x_mitre_deprecated"))


def _tactics(obj: dict[str, Any]) -> list[str]:
    return [
        phase.get("phase_name", "")
        for phase in obj.get("kill_chain_phases", [])
        if phase.get("kill_chain_name") in ("mitre-ics-attack", "mitre-attack")
    ]


def fetch_bundle(*, url: str = ICS_ATTACK_URL, client: Any = None) -> dict[str, Any]:
    bundle = fetch_json(url, client=client)
    if not isinstance(bundle, dict) or "objects" not in bundle:
        raise ValueError("ATT&CK bundle did not contain an 'objects' array")
    return bundle


def _index(bundle: dict[str, Any]) -> tuple[dict[str, dict], list[dict]]:
    """Split the bundle into an id->object map and the relationship list."""
    objects: dict[str, dict] = {}
    relationships: list[dict] = []
    for obj in bundle.get("objects", []):
        obj_type = obj.get("type")
        if obj_type == "relationship":
            relationships.append(obj)
        elif obj_type in _WANTED_TYPES and not _is_deprecated(obj):
            objects[obj["id"]] = obj
    return objects, relationships


def technique_document(obj: dict[str, Any]) -> Document:
    attack_id = _attack_id(obj) or obj["id"]
    name = obj.get("name", attack_id)
    description = obj.get("description", "")
    tactics = _tactics(obj)
    platforms = obj.get("x_mitre_platforms", []) or []
    assets = obj.get("x_mitre_asset_refs", []) or []

    body = [
        f"# {attack_id} — {name}",
        "",
        f"**{name}** ({attack_id}) is an ICS technique in the MITRE ATT&CK for ICS matrix.",
        "",
    ]
    if description:
        body += ["## Description", "", description, ""]

    facts = [
        ["ATT&CK ID", attack_id],
        ["Technique name", name],
        ["Tactics", ", ".join(tactics) if tactics else "—"],
        ["Platforms", ", ".join(platforms) if platforms else "—"],
    ]
    body += ["## Facts", "", markdown_table(["Property", "Value"], facts), ""]

    if assets:
        body += [
            "## Targeted asset types",
            "",
            "This technique targets the following ICS asset types:",
            "",
        ]
        body += [f"- {asset}" for asset in assets]
        body.append("")

    return Document(
        key_suffix=f"techniques/{attack_id}.md",
        title=f"{attack_id} — {name}",
        body="\n".join(body),
        source_url=_attack_url(obj) or ICS_ATTACK_URL,
        upstream_id=attack_id,
        metadata={
            "feed": "mitre-attack-ics",
            "attack_id": attack_id,
            "stix_type": "attack-pattern",
            "tactics": tactics,
            "platforms": platforms,
            "entity_types": ["ICSTechnique"],
        },
    )


def group_document(
    obj: dict[str, Any],
    *,
    techniques: list[tuple[str, str]],
    malware: list[str],
) -> Document:
    """Threat group document, including its technique and malware edges.

    The relationship prose here is the point: ``usesTechnique`` and
    ``deploysMalware`` are ontology object properties, and stating them in
    sentences is what allows extraction to rebuild the edges rather than
    producing three disconnected entities.
    """
    attack_id = _attack_id(obj) or obj["id"]
    name = obj.get("name", attack_id)
    description = obj.get("description", "")
    aliases = [a for a in obj.get("aliases", []) if a != name]

    body = [
        f"# {attack_id} — {name}",
        "",
        f"**{name}** ({attack_id}) is a threat group tracked in MITRE ATT&CK for ICS.",
    ]
    if aliases:
        body.append(f" It is also known as {', '.join(aliases)}.")
    body += ["", ]

    if description:
        body += ["## Description", "", description, ""]

    if techniques:
        body += [
            "## Techniques used",
            "",
            f"{name} uses the following ICS techniques:",
            "",
            markdown_table(
                ["ATT&CK ID", "Technique"],
                [[tid, tname] for tid, tname in sorted(techniques)],
            ),
            "",
        ]

    if malware:
        body += [
            "## Malware deployed",
            "",
            f"{name} deploys the following malware:",
            "",
        ]
        body += [f"- {item}" for item in sorted(malware)]
        body.append("")

    return Document(
        key_suffix=f"groups/{attack_id}.md",
        title=f"{attack_id} — {name}",
        body="\n".join(body),
        source_url=_attack_url(obj) or ICS_ATTACK_URL,
        upstream_id=attack_id,
        metadata={
            "feed": "mitre-attack-ics",
            "attack_id": attack_id,
            "stix_type": "intrusion-set",
            "group_name": name,
            "aliases": aliases,
            "technique_count": len(techniques),
            "entity_types": ["ThreatGroup"],
        },
    )


def malware_document(obj: dict[str, Any], *, used_by: list[str]) -> Document:
    attack_id = _attack_id(obj) or obj["id"]
    name = obj.get("name", attack_id)
    description = obj.get("description", "")
    platforms = obj.get("x_mitre_platforms", []) or []

    body = [
        f"# {attack_id} — {name}",
        "",
        f"**{name}** ({attack_id}) is malware tracked in MITRE ATT&CK for ICS.",
        "",
    ]
    if description:
        body += ["## Description", "", description, ""]
    if used_by:
        body += [
            "## Attribution",
            "",
            f"{name} is deployed by the following threat groups: {', '.join(sorted(used_by))}.",
            "",
        ]
    if platforms:
        body += ["## Platforms", "", ", ".join(platforms), ""]

    return Document(
        key_suffix=f"malware/{attack_id}.md",
        title=f"{attack_id} — {name}",
        body="\n".join(body),
        source_url=_attack_url(obj) or ICS_ATTACK_URL,
        upstream_id=attack_id,
        metadata={
            "feed": "mitre-attack-ics",
            "attack_id": attack_id,
            "stix_type": obj.get("type", "malware"),
            "platforms": platforms,
            "entity_types": ["Malware"],
        },
    )


def documents(
    *,
    url: str = ICS_ATTACK_URL,
    limit: int | None = None,
    client: Any = None,
) -> Iterator[Document]:
    """Yield technique, group, and malware documents from the ICS bundle."""
    bundle = fetch_bundle(url=url, client=client)
    objects, relationships = _index(bundle)

    techniques = {i: o for i, o in objects.items() if o["type"] == "attack-pattern"}
    groups = {i: o for i, o in objects.items() if o["type"] == "intrusion-set"}
    malware = {i: o for i, o in objects.items() if o["type"] in ("malware", "tool")}

    logger.info(
        "ATT&CK ICS bundle: %d techniques, %d groups, %d malware, %d relationships",
        len(techniques),
        len(groups),
        len(malware),
        len(relationships),
    )

    # group -> techniques, group -> malware, malware -> groups
    group_techniques: dict[str, list[tuple[str, str]]] = {}
    group_malware: dict[str, list[str]] = {}
    malware_groups: dict[str, list[str]] = {}

    for rel in relationships:
        if rel.get("relationship_type") != "uses":
            continue
        source = rel.get("source_ref", "")
        target = rel.get("target_ref", "")
        if source not in groups:
            continue
        group_id = source
        if target in techniques:
            technique = techniques[target]
            group_techniques.setdefault(group_id, []).append(
                (_attack_id(technique) or target, technique.get("name", ""))
            )
        elif target in malware:
            item = malware[target]
            name = item.get("name", "")
            group_malware.setdefault(group_id, []).append(name)
            malware_groups.setdefault(target, []).append(groups[group_id].get("name", ""))

    emitted = 0

    def _bump() -> bool:
        nonlocal emitted
        emitted += 1
        return limit is not None and emitted >= limit

    for obj in techniques.values():
        yield technique_document(obj)
        if _bump():
            return

    for group_id, obj in groups.items():
        yield group_document(
            obj,
            techniques=group_techniques.get(group_id, []),
            malware=group_malware.get(group_id, []),
        )
        if _bump():
            return

    for malware_id, obj in malware.items():
        yield malware_document(obj, used_by=malware_groups.get(malware_id, []))
        if _bump():
            return
