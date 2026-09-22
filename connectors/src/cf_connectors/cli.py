"""Connector CLI.

    # Use a globally-unique bucket you own, e.g. groundwork-feeds-<account-id>-<region>.
    # S3 names are global; a short generic name can be squatted by another account.
    cf-connect kev      --bucket <your-unique-feeds-bucket> --ics-only
    cf-connect nvd      --bucket <your-unique-feeds-bucket> --keyword siemens --limit 500
    cf-connect mitre-ics --bucket <your-unique-feeds-bucket>
    cf-connect all      --bucket <your-unique-feeds-bucket> --ics-only --dry-run

Output lands under s3://<bucket>/<prefix>/<feed>/, which is what you register as
a COA DOCUMENTS source. Register the parent prefix once and every feed shows up
under it.
"""

from __future__ import annotations

import logging
import os
import sys

import click

from . import cisa_kev, mitre_ics, nvd
from .base import ConnectorError, S3DocumentWriter

DEFAULT_PREFIX = "feeds"


def _setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(levelname)-7s %(name)s: %(message)s",
    )


def _writer(bucket: str, prefix: str, feed: str, dry_run: bool) -> S3DocumentWriter:
    return S3DocumentWriter(bucket, f"{prefix}/{feed}", dry_run=dry_run)


def _report(feed: str, stats: dict[str, int], bucket: str, prefix: str, dry_run: bool) -> None:
    verb = "would write" if dry_run else "wrote"
    click.echo(
        f"  {feed}: {verb} {stats['written']}, skipped {stats['skipped']} unchanged "
        f"-> s3://{bucket}/{prefix}/{feed}/"
    )


bucket_option = click.option("--bucket", required=True, help="Destination S3 bucket.")
prefix_option = click.option(
    "--prefix", default=DEFAULT_PREFIX, show_default=True, help="Key prefix within the bucket."
)
dry_run_option = click.option(
    "--dry-run", is_flag=True, help="Fetch and render, but write nothing. Needs no AWS credentials."
)
verbose_option = click.option("--verbose", "-v", is_flag=True, help="Debug logging.")


@click.group(context_settings={"help_option_names": ["-h", "--help"]})
def main() -> None:
    """Fetch public threat feeds and land them as documents for COA to ingest."""


@main.command()
@bucket_option
@prefix_option
@click.option("--ics-only", is_flag=True, help="Only entries from recognised ICS/OT vendors.")
@click.option("--limit", type=int, help="Stop after N documents.")
@dry_run_option
@verbose_option
def kev(bucket, prefix, ics_only, limit, dry_run, verbose):
    """CISA Known Exploited Vulnerabilities catalog."""
    _setup_logging(verbose)
    writer = _writer(bucket, prefix, "cisa-kev", dry_run)
    try:
        stats = writer.write_all(
            cisa_kev.documents(ics_only=ics_only, limit=limit)
        )
    except ConnectorError as exc:
        click.secho(f"✗ {exc}", fg="red", err=True)
        sys.exit(1)
    _report("cisa-kev", stats, bucket, prefix, dry_run)


@main.command()
@bucket_option
@prefix_option
@click.option(
    "--api-key",
    envvar="NVD_API_KEY",
    help="NVD API key (or set $NVD_API_KEY). Without one, requests are throttled to "
    "one page every ~6.5s.",
)
@click.option("--keyword", help="keywordSearch filter, e.g. a vendor name.")
@click.option("--cpe-name", help="cpeName filter, e.g. cpe:2.3:o:siemens:...")
@click.option("--last-mod-start", help="ISO-8601 start of a lastModified window (max 120 days).")
@click.option("--last-mod-end", help="ISO-8601 end of a lastModified window.")
@click.option("--limit", type=int, help="Stop after N documents.")
@dry_run_option
@verbose_option
def nvd_cmd(
    bucket, prefix, api_key, keyword, cpe_name, last_mod_start, last_mod_end, limit, dry_run, verbose
):
    """NVD CVE records (API 2.0)."""
    _setup_logging(verbose)
    if bool(last_mod_start) != bool(last_mod_end):
        click.secho(
            "✗ --last-mod-start and --last-mod-end must be given together", fg="red", err=True
        )
        sys.exit(2)
    if not api_key:
        click.secho(
            "⚠ no NVD API key — this will be slow. "
            "Request one at https://nvd.nist.gov/developers/request-an-api-key",
            fg="yellow",
        )
    writer = _writer(bucket, prefix, "nvd", dry_run)
    try:
        stats = writer.write_all(
            nvd.documents(
                api_key=api_key,
                keyword=keyword,
                cpe_name=cpe_name,
                last_mod_start=last_mod_start,
                last_mod_end=last_mod_end,
                limit=limit,
            )
        )
    except ConnectorError as exc:
        click.secho(f"✗ {exc}", fg="red", err=True)
        sys.exit(1)
    _report("nvd", stats, bucket, prefix, dry_run)


main.add_command(nvd_cmd, name="nvd")


@main.command(name="mitre-ics")
@bucket_option
@prefix_option
@click.option("--limit", type=int, help="Stop after N documents.")
@dry_run_option
@verbose_option
def mitre_ics_cmd(bucket, prefix, limit, dry_run, verbose):
    """MITRE ATT&CK for ICS techniques, groups, and malware."""
    _setup_logging(verbose)
    writer = _writer(bucket, prefix, "mitre-attack-ics", dry_run)
    try:
        stats = writer.write_all(mitre_ics.documents(limit=limit))
    except ConnectorError as exc:
        click.secho(f"✗ {exc}", fg="red", err=True)
        sys.exit(1)
    _report("mitre-attack-ics", stats, bucket, prefix, dry_run)


@main.command(name="all")
@bucket_option
@prefix_option
@click.option("--ics-only", is_flag=True, help="Apply ICS vendor filtering where supported.")
@click.option("--nvd-keyword", help="keywordSearch for the NVD pull.")
@click.option("--nvd-limit", type=int, default=1000, show_default=True, help="Cap NVD documents.")
@click.option("--api-key", envvar="NVD_API_KEY", help="NVD API key.")
@dry_run_option
@verbose_option
def run_all(bucket, prefix, ics_only, nvd_keyword, nvd_limit, api_key, dry_run, verbose):
    """Run every feed.

    KEV and ATT&CK first because they are cheap and complete; NVD last because it
    is the slow one and is capped by default.
    """
    _setup_logging(verbose)
    click.echo(f"{'[dry run] ' if dry_run else ''}writing to s3://{bucket}/{prefix}/")
    failures = 0

    for feed, generator in (
        ("cisa-kev", lambda: cisa_kev.documents(ics_only=ics_only)),
        ("mitre-attack-ics", lambda: mitre_ics.documents()),
        (
            "nvd",
            lambda: nvd.documents(api_key=api_key, keyword=nvd_keyword, limit=nvd_limit),
        ),
    ):
        try:
            writer = _writer(bucket, prefix, feed, dry_run)
            stats = writer.write_all(generator())
            _report(feed, stats, bucket, prefix, dry_run)
        except ConnectorError as exc:
            failures += 1
            click.secho(f"  {feed}: ✗ {exc}", fg="red", err=True)

    if failures:
        click.secho(f"✗ {failures} feed(s) failed", fg="red", err=True)
        sys.exit(1)
    click.secho("✓ all feeds complete", fg="green")


if __name__ == "__main__":  # pragma: no cover
    main()
