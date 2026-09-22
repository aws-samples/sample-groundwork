"""Lambda entry point for scheduled feed refreshes.

Deploy one function per feed on an EventBridge schedule, or one function invoked
with a ``feed`` key. Configuration comes from the environment so the same image
serves every feed:

    FEED_BUCKET      required   destination bucket
    FEED_PREFIX      optional   default "feeds"
    FEED_NAME        optional   default "all"; one of kev | nvd | mitre-ics | all
    ICS_ONLY         optional   "true" to filter to ICS vendors
    NVD_API_KEY      optional   raises the NVD rate limit substantially
    NVD_LIMIT        optional   default 1000, caps documents per NVD run
    NVD_WINDOW_DAYS  optional   if set, pull only CVEs modified in the last N days

Timeout guidance: KEV and ATT&CK finish in well under a minute. NVD without an
API key sleeps ~6.5s per 2,000-record page, so give it 15 minutes and a limit, or
run it on Fargate instead. An event payload key overrides the matching env var.
"""

from __future__ import annotations

import logging
import os
from datetime import UTC, datetime, timedelta
from typing import Any

from . import cisa_kev, mitre_ics, nvd
from .base import ConnectorError, S3DocumentWriter

logger = logging.getLogger()
logger.setLevel(logging.INFO)

VALID_FEEDS = ("kev", "nvd", "mitre-ics")


def _bool_env(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _int_env(name: str, default: int | None) -> int | None:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw)
    except ValueError:
        logger.warning("%s=%r is not an integer, using %r", name, raw, default)
        return default


def _nvd_window(days: int | None) -> tuple[str | None, str | None]:
    """NVD caps a lastModified window at 120 days."""
    if not days:
        return None, None
    if days > 120:
        logger.warning("NVD_WINDOW_DAYS=%d exceeds the 120-day cap; clamping", days)
        days = 120
    end = datetime.now(UTC)
    start = end - timedelta(days=days)
    return (
        start.strftime("%Y-%m-%dT%H:%M:%S.000%z"),
        end.strftime("%Y-%m-%dT%H:%M:%S.000%z"),
    )


def _run_feed(feed: str, bucket: str, prefix: str, event: dict[str, Any]) -> dict[str, Any]:
    ics_only = bool(event.get("icsOnly", _bool_env("ICS_ONLY")))

    if feed == "kev":
        writer = S3DocumentWriter(bucket, f"{prefix}/cisa-kev")
        stats = writer.write_all(cisa_kev.documents(ics_only=ics_only))
        return {"feed": "cisa-kev", **stats}

    if feed == "mitre-ics":
        writer = S3DocumentWriter(bucket, f"{prefix}/mitre-attack-ics")
        stats = writer.write_all(mitre_ics.documents())
        return {"feed": "mitre-attack-ics", **stats}

    if feed == "nvd":
        api_key = os.environ.get("NVD_API_KEY") or None
        limit = event.get("nvdLimit") or _int_env("NVD_LIMIT", 1000)
        window_days = event.get("nvdWindowDays") or _int_env("NVD_WINDOW_DAYS", None)
        start, end = _nvd_window(window_days)
        writer = S3DocumentWriter(bucket, f"{prefix}/nvd")
        stats = writer.write_all(
            nvd.documents(
                api_key=api_key,
                keyword=event.get("nvdKeyword") or os.environ.get("NVD_KEYWORD") or None,
                last_mod_start=start,
                last_mod_end=end,
                limit=limit,
            )
        )
        return {"feed": "nvd", **stats}

    raise ValueError(f"unknown feed {feed!r}; expected one of {', '.join(VALID_FEEDS)} or 'all'")


def handler(event: dict[str, Any] | None, context: Any = None) -> dict[str, Any]:
    """Refresh one feed, or all of them.

    A partial failure is reported rather than raised when running "all", so one
    unreachable upstream does not discard the feeds that did succeed. The response
    carries a non-zero ``failed`` count for an alarm to key off.
    """
    event = event or {}

    bucket = event.get("bucket") or os.environ.get("FEED_BUCKET")
    if not bucket:
        raise ValueError("FEED_BUCKET env var or 'bucket' event key is required")
    prefix = (event.get("prefix") or os.environ.get("FEED_PREFIX") or "feeds").strip("/")
    requested = (event.get("feed") or os.environ.get("FEED_NAME") or "all").strip().lower()

    feeds = list(VALID_FEEDS) if requested == "all" else [requested]

    results: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []

    for feed in feeds:
        try:
            logger.info("running feed %s -> s3://%s/%s", feed, bucket, prefix)
            results.append(_run_feed(feed, bucket, prefix, event))
        except (ConnectorError, ValueError) as exc:
            logger.exception("feed %s failed", feed)
            errors.append({"feed": feed, "error": str(exc)})
            if len(feeds) == 1:
                raise

    response = {
        "bucket": bucket,
        "prefix": prefix,
        "results": results,
        "errors": errors,
        "written": sum(r.get("written", 0) for r in results),
        "skipped": sum(r.get("skipped", 0) for r in results),
        "failed": len(errors),
    }
    logger.info("done: %s", response)
    return response
