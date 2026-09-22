"""Shared connector plumbing.

Why these connectors exist: COA supports exactly three source shapes —
GLUE_DATABASE, JDBC_DATABASE, and DOCUMENTS — and has no plugin model. A REST
feed cannot be registered as a COA source directly. The cheapest correct path is
to land normalised documents in S3 and register that prefix as a DOCUMENTS source,
which is what everything here does.

Output format is Markdown with a YAML frontmatter block. Two reasons:

* COA's document pipeline runs LLM-based information extraction to build the
  knowledge graph, so prose that names entities and relationships explicitly
  extracts far better than raw JSON.
* The frontmatter carries provenance (source URL, fetch time, upstream id) so a
  fact in the graph can be traced back to the feed record that produced it.

Documents deliberately use the vocabulary from the matching pack ontology
(Vulnerability, OTAsset, ThreatGroup, exploits, affectsAsset). Extraction maps
onto the ontology far more reliably when the source text already speaks it.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlencode

import httpx

logger = logging.getLogger(__name__)

USER_AGENT = "GroundWork-Connector/0.1 (+https://groundwork.io)"
DEFAULT_TIMEOUT = 60.0
MAX_RETRIES = 5


class ConnectorError(Exception):
    """Any connector failure worth surfacing to the caller."""


@dataclass
class Document:
    """One normalised document destined for S3."""

    key_suffix: str
    """Path within the feed prefix, e.g. ``CVE-2024-1234.md``."""

    title: str
    body: str
    """Markdown body, without frontmatter — ``render`` adds it."""

    source_url: str
    upstream_id: str
    metadata: dict[str, Any] = field(default_factory=dict)
    fetched_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())

    def render(self) -> str:
        """Frontmatter + body."""
        front: dict[str, Any] = {
            "title": self.title,
            "upstream_id": self.upstream_id,
            "source_url": self.source_url,
            "fetched_at": self.fetched_at,
            **self.metadata,
        }
        lines = ["---"]
        for key, value in front.items():
            if value is None:
                continue
            if isinstance(value, list):
                if not value:
                    continue
                lines.append(f"{key}:")
                lines.extend(f"  - {item}" for item in value)
            elif isinstance(value, bool):
                lines.append(f"{key}: {str(value).lower()}")
            else:
                text = str(value)
                needs_quote = any(ch in text for ch in ':#"\n') or text.strip() != text
                lines.append(f'{key}: "{text}"' if needs_quote else f"{key}: {text}")
        lines.append("---")
        lines.append("")
        return "\n".join(lines) + self.body.rstrip() + "\n"

    def content_hash(self) -> str:
        """Stable hash of the rendered body, excluding ``fetched_at``.

        Used to skip S3 writes when nothing changed, so a nightly run does not
        churn the DOCUMENTS source and trigger pointless re-extraction — which
        costs Bedrock tokens per document.
        """
        stable = {
            "title": self.title,
            "upstream_id": self.upstream_id,
            "source_url": self.source_url,
            "metadata": self.metadata,
            "body": self.body,
        }
        payload = json.dumps(stable, sort_keys=True, default=str).encode("utf-8")
        return hashlib.sha256(payload).hexdigest()


def fetch_json(
    url: str,
    *,
    params: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = DEFAULT_TIMEOUT,
    client: httpx.Client | None = None,
) -> Any:
    """GET JSON with retry on 429 and 5xx.

    NVD in particular rate-limits aggressively without an API key and answers
    429 rather than blocking, so honouring Retry-After is not optional.
    """
    request_headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    if headers:
        request_headers.update(headers)

    full_url = f"{url}?{urlencode(params)}" if params else url
    owns_client = client is None
    http = client or httpx.Client(timeout=timeout, follow_redirects=True)

    try:
        backoff = 2.0
        last_error: str = ""
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = http.get(full_url, headers=request_headers)
            except httpx.HTTPError as exc:
                last_error = f"{type(exc).__name__}: {exc}"
                logger.warning("fetch %s attempt %d failed: %s", url, attempt, last_error)
                if attempt == MAX_RETRIES:
                    break
                time.sleep(backoff)
                backoff = min(backoff * 2, 60.0)
                continue

            if response.status_code == 200:
                try:
                    return response.json()
                except ValueError as exc:
                    raise ConnectorError(f"{url} returned non-JSON: {exc}") from exc

            if response.status_code == 429 or response.status_code >= 500:
                retry_after = response.headers.get("Retry-After")
                delay = float(retry_after) if retry_after and retry_after.isdigit() else backoff
                last_error = f"HTTP {response.status_code}"
                logger.warning(
                    "fetch %s attempt %d got %s, retrying in %.0fs",
                    url,
                    attempt,
                    response.status_code,
                    delay,
                )
                if attempt == MAX_RETRIES:
                    break
                time.sleep(delay)
                backoff = min(backoff * 2, 60.0)
                continue

            raise ConnectorError(
                f"{url} returned HTTP {response.status_code}: {response.text[:300]}"
            )

        raise ConnectorError(f"{url} failed after {MAX_RETRIES} attempts ({last_error})")
    finally:
        if owns_client:
            http.close()


class S3DocumentWriter:
    """Writes rendered documents to an S3 prefix, skipping unchanged content.

    The hash sidecar is a plain object next to the document rather than object
    metadata, so a change can be detected with one GET and no HeadObject dance.
    """

    def __init__(self, bucket: str, prefix: str, *, s3_client: Any = None, dry_run: bool = False):
        self.bucket = bucket
        self.prefix = prefix.strip("/")
        self.dry_run = dry_run
        self._written = 0
        self._skipped = 0
        if s3_client is not None:
            self._s3 = s3_client
        elif dry_run:
            self._s3 = None
        else:
            import boto3  # imported lazily so tests and --dry-run need no AWS

            self._s3 = boto3.client("s3")

    @property
    def written(self) -> int:
        return self._written

    @property
    def skipped(self) -> int:
        return self._skipped

    def _existing_hash(self, hash_key: str) -> str | None:
        if self._s3 is None:
            return None
        try:
            response = self._s3.get_object(Bucket=self.bucket, Key=hash_key)
            return response["Body"].read().decode("utf-8").strip()
        except Exception:
            # Missing sidecar, or no permission to read it. Either way, write.
            return None

    def write(self, document: Document) -> bool:
        """Write unless the content hash matches. Returns True if written."""
        key = f"{self.prefix}/{document.key_suffix}".lstrip("/")
        hash_key = f"{key}.sha256"
        digest = document.content_hash()

        if self._existing_hash(hash_key) == digest:
            self._skipped += 1
            return False

        if self.dry_run or self._s3 is None:
            logger.info("[dry-run] would write s3://%s/%s", self.bucket, key)
            self._written += 1
            return True

        self._s3.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=document.render().encode("utf-8"),
            ContentType="text/markdown; charset=utf-8",
        )
        self._s3.put_object(
            Bucket=self.bucket,
            Key=hash_key,
            Body=digest.encode("utf-8"),
            ContentType="text/plain",
        )
        self._written += 1
        return True

    def write_all(self, documents: Iterator[Document]) -> dict[str, int]:
        for document in documents:
            self.write(document)
        return {"written": self._written, "skipped": self._skipped}


def markdown_table(headers: list[str], rows: list[list[str]]) -> str:
    """Small helper — extraction handles tabular facts well when they're tables."""
    if not rows:
        return ""
    out = ["| " + " | ".join(headers) + " |"]
    out.append("| " + " | ".join("---" for _ in headers) + " |")
    for row in rows:
        cells = [str(cell).replace("|", "\\|") if cell is not None else "" for cell in row]
        out.append("| " + " | ".join(cells) + " |")
    return "\n".join(out)
