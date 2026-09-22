"""Pack model and offline validation.

A GroundWork vertical pack is a directory:

    packs/<name>/
      pack.yaml           metadata + which files to load
      ontology.ttl        OWL classes and object properties
      metrics.osi.yaml    governed metrics, OSI v1.0
      sources.yaml        optional source registration templates
      seed/               optional fixtures (SQL, documents)

Validation here is deliberately strict and entirely offline, so a pack author
gets feedback in milliseconds instead of after a half-finished install. Every
rule below mirrors a constraint COA actually enforces server-side; the source
of that constraint is cited in a comment so the two can be kept in sync.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml
from rdflib import OWL, RDF, Graph

from .errors import PackValidationError

# Content types COA's presigned-upload endpoint accepts. Anything else is a 400.
# Source: packages/ontology-engine/src/coa_ontology/catalog/routers/ontologies.py
ACCEPTED_CONTENT_TYPES = frozenset(
    {
        "text/turtle",
        "application/rdf+xml",
        "application/ld+json",
        "application/owl+xml",
        "application/octet-stream",
    }
)

# Extension -> (upload Content-Type, ingest `format` value, rdflib parser name).
# The ingest format strings are the ones COA maps in
# packages/ontology-engine/src/coa_ontology/catalog/ingest.py::_RDFLIB_FORMATS.
_EXTENSION_MAP: dict[str, tuple[str, str, str]] = {
    ".ttl": ("text/turtle", "turtle", "turtle"),
    ".n3": ("text/turtle", "turtle", "turtle"),
    ".nt": ("text/turtle", "turtle", "turtle"),
    ".rdf": ("application/rdf+xml", "rdf-xml", "xml"),
    ".xml": ("application/rdf+xml", "rdf-xml", "xml"),
    ".owl": ("application/owl+xml", "rdf-xml", "xml"),
    ".jsonld": ("application/ld+json", "json-ld", "json-ld"),
    ".json": ("application/ld+json", "json-ld", "json-ld"),
}

# COA pins the presigned PUT at 100 MB.
MAX_ONTOLOGY_BYTES = 100 * 1024 * 1024

# ImportOsi rejects inline content over 5 MB.
MAX_INLINE_OSI_BYTES = 5 * 1024 * 1024

OSI_SPEC_VERSION = "1.0"

# osi_parser.py maps these three and nothing else.
VALID_OSI_DIALECTS = frozenset({"ANSI_SQL", "SNOWFLAKE", "DATABRICKS"})

VALID_ONTOLOGY_TYPES = frozenset({"foundational", "induced", "user_created"})


@dataclass(frozen=True)
class OntologyFile:
    """A resolved ontology artifact, ready to upload."""

    path: Path
    content_type: str
    ingest_format: str
    rdflib_format: str
    ontology_iri: str
    class_count: int
    object_property_count: int

    @property
    def filename(self) -> str:
        return self.path.name

    @property
    def size_bytes(self) -> int:
        return self.path.stat().st_size


@dataclass(frozen=True)
class Pack:
    """A validated vertical pack."""

    root: Path
    name: str
    version: str
    description: str
    ontology: OntologyFile
    ontology_title: str
    ontology_type: str
    metrics_path: Path | None
    metric_names: tuple[str, ...]
    sources: tuple[dict[str, Any], ...]
    grants: tuple[dict[str, Any], ...]
    default_namespace: str | None

    @property
    def metrics_yaml(self) -> str | None:
        """The OSI YAML to POST to import-osi.

        Packs author per-metric COA fields under a readable ``x_coa:`` mapping,
        but COA's osi_parser only reads a metric's data_source_id/source_table
        from ``custom_extensions: [{vendor_name: COA, data: {...}}]`` — an
        ``x_coa`` key is silently ignored, so the metric imports with no source
        binding and never resolves at query time. Translate ``x_coa`` into the
        wire shape COA expects at emit time, leaving the on-disk pack readable.
        Files with no ``x_coa`` (already in custom_extensions form) pass through
        unchanged.
        """
        if self.metrics_path is None:
            return None
        raw = self.metrics_path.read_text(encoding="utf-8")
        if "x_coa:" not in raw:
            return raw
        return _translate_x_coa_to_custom_extensions(raw)


def _translate_x_coa_to_custom_extensions(raw: str) -> str:
    """Rewrite each metric's ``x_coa`` mapping into COA's ``custom_extensions``.

    COA's osi_parser (packages/metric-service/src/coa_metrics/osi_parser.py)
    reads per-metric vendor data ONLY from
    ``custom_extensions: [{vendor_name: "COA", data: {...}}]``. The pack's
    readable ``x_coa: {...}`` shorthand is otherwise dropped, leaving the metric
    with no data_source_id/source_table binding. This emit-time translation is
    lossless for the fields COA consumes and leaves any metric already using
    ``custom_extensions`` untouched.
    """
    try:
        doc = yaml.safe_load(raw)
    except yaml.YAMLError:
        # If it does not parse we cannot safely rewrite it; hand back the raw
        # text and let COA's parser surface the error verbatim.
        return raw
    if not isinstance(doc, dict):
        return raw
    metrics = doc.get("metrics")
    if not isinstance(metrics, list):
        return raw

    changed = False
    for metric in metrics:
        if not isinstance(metric, dict) or "x_coa" not in metric:
            continue
        data = metric.pop("x_coa")
        if metric.get("custom_extensions"):
            # Author supplied both — keep the explicit custom_extensions and drop
            # the redundant x_coa rather than fight over precedence.
            changed = True
            continue
        metric["custom_extensions"] = [{"vendor_name": "COA", "data": data}]
        changed = True

    if not changed:
        return raw
    return yaml.safe_dump(doc, sort_keys=False, width=100, allow_unicode=True)


def _classify_ontology(path: Path, findings: list[tuple[str, str]]) -> OntologyFile | None:
    """Parse the ontology and extract what COA will need at ingest time."""
    suffix = path.suffix.lower()
    mapping = _EXTENSION_MAP.get(suffix)
    if mapping is None:
        findings.append(
            (
                f"$.ontology ({path.name})",
                f"unsupported extension '{suffix}'. COA accepts RDF only: "
                f"{', '.join(sorted(_EXTENSION_MAP))}",
            )
        )
        return None

    content_type, ingest_format, rdflib_format = mapping

    size = path.stat().st_size
    if size > MAX_ONTOLOGY_BYTES:
        findings.append(
            (
                f"$.ontology ({path.name})",
                f"file is {size / 1024 / 1024:.1f} MB; COA pins uploads at 100 MB",
            )
        )
        return None

    graph = Graph()
    try:
        graph.parse(str(path), format=rdflib_format)
    except Exception as exc:  # rdflib raises a wide variety of parse errors
        findings.append(
            (
                f"$.ontology ({path.name})",
                f"not valid {rdflib_format}: {type(exc).__name__}: {exc}",
            )
        )
        return None

    # COA derives the ontology id from an owl:Ontology subject when the caller
    # does not supply `ontologyId`, and errors outright if neither is present
    # (catalog/ingest.py). We always declare one so the IRI is stable across
    # reinstalls rather than being minted as urn:ontology:upload-<random>.
    ontology_subjects = list(graph.subjects(RDF.type, OWL.Ontology))
    if not ontology_subjects:
        findings.append(
            (
                f"$.ontology ({path.name})",
                "no owl:Ontology subject declared. COA needs a derivable ontology id; "
                "without one the IRI is randomly minted and reinstalls create duplicates. "
                "Add: <https://example.org/my-ontology> a owl:Ontology .",
            )
        )
        return None
    if len(ontology_subjects) > 1:
        findings.append(
            (
                f"$.ontology ({path.name})",
                f"{len(ontology_subjects)} owl:Ontology subjects declared; expected exactly one",
            )
        )
        return None

    classes = set(graph.subjects(RDF.type, OWL.Class))
    object_properties = set(graph.subjects(RDF.type, OWL.ObjectProperty))

    if not classes:
        findings.append(
            (f"$.ontology ({path.name})", "declares no owl:Class — nothing for COA to ground on")
        )
        return None

    return OntologyFile(
        path=path,
        content_type=content_type,
        ingest_format=ingest_format,
        rdflib_format=rdflib_format,
        ontology_iri=str(ontology_subjects[0]),
        class_count=len(classes),
        object_property_count=len(object_properties),
    )


def _validate_osi(path: Path, findings: list[tuple[str, str]]) -> tuple[str, ...]:
    """Validate an OSI v1.0 file against the rules COA's osi_parser enforces.

    Mirrors packages/metric-service/src/coa_metrics/osi_parser.py. Findings use
    the same ``$.metrics[0].expression.dialects`` JSON-pointer style COA returns,
    so a failure here reads the same as a failure from the server.
    """
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        findings.append((f"$ ({path.name})", f"invalid YAML: {exc}"))
        return ()

    if not isinstance(raw, dict):
        findings.append((f"$ ({path.name})", "top level must be a mapping"))
        return ()

    size = path.stat().st_size
    if size > MAX_INLINE_OSI_BYTES:
        findings.append(
            (
                f"$ ({path.name})",
                f"file is {size / 1024 / 1024:.1f} MB; inline ImportOsi content is capped at 5 MB. "
                "Use the S3 upload-url path for a file this large.",
            )
        )

    spec_version = raw.get("osi_spec_version")
    if spec_version is None:
        findings.append(("$.osi_spec_version", "required"))
    elif str(spec_version) != OSI_SPEC_VERSION:
        findings.append(
            ("$.osi_spec_version", f"must be '{OSI_SPEC_VERSION}', got '{spec_version}'")
        )

    datasets = raw.get("datasets")
    if datasets is not None:
        if not isinstance(datasets, list):
            findings.append(("$.datasets", "must be a list when present"))
        else:
            for i, dataset in enumerate(datasets):
                if not isinstance(dataset, dict):
                    findings.append((f"$.datasets[{i}]", "must be a mapping"))
                elif not dataset.get("name"):
                    findings.append((f"$.datasets[{i}].name", "required"))

    metrics = raw.get("metrics")
    if not isinstance(metrics, list) or not metrics:
        findings.append(("$.metrics", "required, and must contain at least one metric"))
        return ()

    names: list[str] = []
    seen: set[str] = set()
    for i, metric in enumerate(metrics):
        base = f"$.metrics[{i}]"
        if not isinstance(metric, dict):
            findings.append((base, "must be a mapping"))
            continue

        name = metric.get("name")
        if not name:
            findings.append((f"{base}.name", "required"))
        else:
            names.append(str(name))
            if name in seen:
                findings.append((f"{base}.name", f"duplicate metric name '{name}'"))
            seen.add(name)

        if not metric.get("description"):
            findings.append((f"{base}.description", "required"))

        expression = metric.get("expression")
        if not isinstance(expression, dict):
            findings.append((f"{base}.expression", "required, must be a mapping"))
            continue

        dialects = expression.get("dialects")
        if not isinstance(dialects, list) or not dialects:
            findings.append(
                (f"{base}.expression.dialects", "required, must contain at least one entry")
            )
            continue

        for j, entry in enumerate(dialects):
            dbase = f"{base}.expression.dialects[{j}]"
            if not isinstance(entry, dict):
                findings.append((dbase, "must be a mapping"))
                continue
            dialect = entry.get("dialect")
            if not dialect:
                findings.append((f"{dbase}.dialect", "required"))
            elif dialect not in VALID_OSI_DIALECTS:
                findings.append(
                    (
                        f"{dbase}.dialect",
                        f"unknown dialect '{dialect}'; COA maps only "
                        f"{', '.join(sorted(VALID_OSI_DIALECTS))}",
                    )
                )
            if not entry.get("expression"):
                findings.append((f"{dbase}.expression", "required"))

        # ai_context is a structured object in OSI v1.0, not a free string.
        # Authors coming from prose-style metric docs get this wrong constantly.
        ai_context = metric.get("ai_context")
        if ai_context is not None and not isinstance(ai_context, dict):
            findings.append(
                (
                    f"{base}.ai_context",
                    "must be a mapping with synonyms/instructions/examples, not a string",
                )
            )

    return tuple(names)


def load_pack(root: Path) -> Pack:
    """Load and validate a pack directory. Raises PackValidationError."""
    root = root.resolve()
    findings: list[tuple[str, str]] = []

    if not root.is_dir():
        raise PackValidationError([("$", f"not a directory: {root}")])

    manifest_path = root / "pack.yaml"
    if not manifest_path.is_file():
        raise PackValidationError([("$", f"missing pack.yaml in {root}")])

    try:
        manifest = yaml.safe_load(manifest_path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as exc:
        raise PackValidationError([("$ (pack.yaml)", f"invalid YAML: {exc}")]) from exc

    if not isinstance(manifest, dict):
        raise PackValidationError([("$ (pack.yaml)", "top level must be a mapping")])

    for required in ("name", "version", "description"):
        if not manifest.get(required):
            findings.append((f"$.{required} (pack.yaml)", "required"))

    ontology_rel = manifest.get("ontology")
    ontology: OntologyFile | None = None
    if not ontology_rel:
        findings.append(("$.ontology (pack.yaml)", "required — path to the OWL file"))
    else:
        ontology_path = root / str(ontology_rel)
        if not ontology_path.is_file():
            findings.append((f"$.ontology (pack.yaml)", f"file not found: {ontology_rel}"))
        else:
            ontology = _classify_ontology(ontology_path, findings)

    ontology_type = str(manifest.get("ontology_type", "user_created"))
    if ontology_type not in VALID_ONTOLOGY_TYPES:
        findings.append(
            (
                "$.ontology_type (pack.yaml)",
                f"must be one of {', '.join(sorted(VALID_ONTOLOGY_TYPES))}",
            )
        )

    metrics_rel = manifest.get("metrics")
    metrics_path: Path | None = None
    metric_names: tuple[str, ...] = ()
    if metrics_rel:
        candidate = root / str(metrics_rel)
        if not candidate.is_file():
            findings.append((f"$.metrics (pack.yaml)", f"file not found: {metrics_rel}"))
        else:
            metrics_path = candidate
            metric_names = _validate_osi(candidate, findings)

    sources_rel = manifest.get("sources")
    sources: tuple[dict[str, Any], ...] = ()
    if sources_rel:
        candidate = root / str(sources_rel)
        if not candidate.is_file():
            findings.append((f"$.sources (pack.yaml)", f"file not found: {sources_rel}"))
        else:
            try:
                loaded = yaml.safe_load(candidate.read_text(encoding="utf-8")) or {}
            except yaml.YAMLError as exc:
                findings.append((f"$ ({candidate.name})", f"invalid YAML: {exc}"))
                loaded = {}
            entries = loaded.get("sources", []) if isinstance(loaded, dict) else []
            if not isinstance(entries, list):
                findings.append((f"$.sources ({candidate.name})", "must be a list"))
            else:
                for i, entry in enumerate(entries):
                    if not isinstance(entry, dict):
                        findings.append((f"$.sources[{i}] ({candidate.name})", "must be a mapping"))
                        continue
                    source_type = entry.get("sourceType")
                    if source_type not in ("DATABASE", "DOCUMENTS"):
                        findings.append(
                            (
                                f"$.sources[{i}].sourceType ({candidate.name})",
                                "must be DATABASE or DOCUMENTS — COA has no other source types",
                            )
                        )
                    has_db = "databaseSource" in entry
                    has_doc = "documentSource" in entry
                    if has_db == has_doc:
                        findings.append(
                            (
                                f"$.sources[{i}] ({candidate.name})",
                                "exactly one of databaseSource / documentSource is required",
                            )
                        )
                sources = tuple(e for e in entries if isinstance(e, dict))

    grants_raw = manifest.get("grants") or []
    grants: tuple[dict[str, Any], ...] = ()
    if grants_raw:
        if not isinstance(grants_raw, list):
            findings.append(("$.grants (pack.yaml)", "must be a list"))
        else:
            for i, grant in enumerate(grants_raw):
                if not isinstance(grant, dict):
                    findings.append((f"$.grants[{i}] (pack.yaml)", "must be a mapping"))
                    continue
                for required in ("principalType", "principalId", "role"):
                    if not grant.get(required):
                        findings.append((f"$.grants[{i}].{required} (pack.yaml)", "required"))
                ptype = grant.get("principalType")
                if ptype and ptype not in ("USER", "GROUP", "AGENT"):
                    findings.append(
                        (
                            f"$.grants[{i}].principalType (pack.yaml)",
                            "must be USER, GROUP or AGENT",
                        )
                    )
            grants = tuple(g for g in grants_raw if isinstance(g, dict))

    if findings:
        raise PackValidationError(findings)

    assert ontology is not None  # guaranteed: any failure above raised

    return Pack(
        root=root,
        name=str(manifest["name"]),
        version=str(manifest["version"]),
        description=str(manifest["description"]),
        ontology=ontology,
        ontology_title=str(manifest.get("ontology_title", manifest["description"])),
        ontology_type=ontology_type,
        metrics_path=metrics_path,
        metric_names=metric_names,
        sources=sources,
        grants=grants,
        default_namespace=(
            str(manifest["default_namespace"]) if manifest.get("default_namespace") else None
        ),
    )


def discover_packs(packs_root: Path) -> list[Path]:
    """Every immediate subdirectory of ``packs_root`` that has a pack.yaml."""
    if not packs_root.is_dir():
        return []
    return sorted(p for p in packs_root.iterdir() if (p / "pack.yaml").is_file())
