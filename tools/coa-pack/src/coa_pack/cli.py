"""Command line interface.

    coa-pack validate ./packs/ot-security
    coa-pack list ./packs
    coa-pack install ./packs/ot-security --namespace otsec \
        --base-url https://abc.execute-api.us-east-1.amazonaws.com/prod \
        --create-namespace --owner you@example.com

``validate`` is fully offline, so it runs in CI without an AWS account.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import click

from .client import CoaClient
from .errors import PackError, PackValidationError
from .installer import install as run_install
from .pack import discover_packs, load_pack

TOKEN_ENV = "COA_TOKEN"  # nosec B105 - environment variable NAME, not a secret value
BASE_URL_ENV = "COA_BASE_URL"


def _echo_err(message: str) -> None:
    click.secho(message, fg="red", err=True)


@click.group(context_settings={"help_option_names": ["-h", "--help"]})
@click.version_option(package_name="coa-pack")
def main() -> None:
    """Install GroundWork vertical packs into a Context Ontology Accelerator namespace."""


@main.command()
@click.argument("pack_path", type=click.Path(exists=True, file_okay=False, path_type=Path))
def validate(pack_path: Path) -> None:
    """Validate a pack directory offline. No AWS credentials needed."""
    try:
        pack = load_pack(pack_path)
    except PackValidationError as exc:
        _echo_err(f"✗ {pack_path.name} is invalid")
        for pointer, message in exc.findings:
            _echo_err(f"  {pointer}: {message}")
        sys.exit(1)
    except PackError as exc:
        _echo_err(f"✗ {exc}")
        sys.exit(1)

    click.secho(f"✓ {pack.name} v{pack.version}", fg="green")
    click.echo(f"  ontology   {pack.ontology.filename} -> {pack.ontology.ontology_iri}")
    click.echo(
        f"             {pack.ontology.class_count} classes, "
        f"{pack.ontology.object_property_count} object properties, "
        f"{pack.ontology.size_bytes:,} bytes"
    )
    click.echo(f"             upload as {pack.ontology.content_type}, "
               f"ingest format '{pack.ontology.ingest_format}'")
    if pack.metric_names:
        click.echo(f"  metrics    {len(pack.metric_names)}: {', '.join(pack.metric_names)}")
    else:
        click.echo("  metrics    none")
    click.echo(f"  sources    {len(pack.sources)}")
    click.echo(f"  grants     {len(pack.grants)}")


@main.command(name="list")
@click.argument(
    "packs_root",
    type=click.Path(exists=True, file_okay=False, path_type=Path),
    default="packs",
)
def list_packs(packs_root: Path) -> None:
    """List packs under a directory and whether each validates."""
    paths = discover_packs(packs_root)
    if not paths:
        click.echo(f"no packs found in {packs_root}")
        return

    failures = 0
    for path in paths:
        try:
            pack = load_pack(path)
        except PackError as exc:
            failures += 1
            click.secho(f"✗ {path.name}", fg="red")
            first = exc.findings[0] if isinstance(exc, PackValidationError) else None
            click.echo(f"    {first[0]}: {first[1]}" if first else f"    {exc}")
            continue
        click.secho(f"✓ {path.name}", fg="green", nl=False)
        click.echo(
            f"  v{pack.version}  "
            f"{pack.ontology.class_count} classes, {len(pack.metric_names)} metrics"
        )

    if failures:
        sys.exit(1)


@main.command()
@click.argument("pack_path", type=click.Path(exists=True, file_okay=False, path_type=Path))
@click.option("--namespace", required=True, help="Target COA namespace name.")
@click.option(
    "--base-url",
    envvar=BASE_URL_ENV,
    help=f"COA API Gateway invoke URL including stage. Or set ${BASE_URL_ENV}.",
)
@click.option(
    "--token",
    envvar=TOKEN_ENV,
    help=f"OIDC bearer token. Or set ${TOKEN_ENV}. COA has no M2M credentials, "
    "so this must be a real user's token.",
)
@click.option("--create-namespace", is_flag=True, help="Create the namespace if absent.")
@click.option("--owner", help="Owner email. Required with --create-namespace.")
@click.option("--dry-run", is_flag=True, help="Validate and print the plan without calling COA.")
@click.option("--quiet", is_flag=True, help="Only print the final summary.")
@click.option(
    "--ingest-timeout", default=900.0, show_default=True, help="Seconds to wait for ontology ingest."
)
@click.option(
    "--import-timeout", default=600.0, show_default=True, help="Seconds to wait for metric import."
)
def install(
    pack_path: Path,
    namespace: str,
    base_url: str | None,
    token: str | None,
    create_namespace: bool,
    owner: str | None,
    dry_run: bool,
    quiet: bool,
    ingest_timeout: float,
    import_timeout: float,
) -> None:
    """Install a pack into a COA namespace."""
    try:
        pack = load_pack(pack_path)
    except PackValidationError as exc:
        _echo_err(f"✗ {pack_path.name} is invalid — not installing")
        for pointer, message in exc.findings:
            _echo_err(f"  {pointer}: {message}")
        sys.exit(1)

    if create_namespace and not owner:
        _echo_err("--owner is required with --create-namespace")
        sys.exit(2)

    reporter = (lambda _: None) if quiet else (lambda line: click.echo(line))

    if dry_run:
        click.echo(f"installing {pack.name} v{pack.version} into '{namespace}' (dry run)")
        report = run_install(
            client=None,  # type: ignore[arg-type]  # unused on the dry-run path
            pack=pack,
            namespace=namespace,
            owner=owner,
            create_namespace=create_namespace,
            dry_run=True,
            report=reporter,
        )
        click.echo("")
        for line in report.summary_lines():
            click.echo(f"  {line}")
        return

    if not base_url:
        _echo_err(f"--base-url is required (or set ${BASE_URL_ENV})")
        sys.exit(2)
    if not token:
        _echo_err(
            f"--token is required (or set ${TOKEN_ENV}). Obtain one with the OIDC "
            "Authorization Code + PKCE flow; see COA's authentication-setup docs."
        )
        sys.exit(2)

    click.echo(f"installing {pack.name} v{pack.version} into '{namespace}'")
    try:
        with CoaClient(base_url, token) as client:
            report = run_install(
                client=client,
                pack=pack,
                namespace=namespace,
                owner=owner,
                create_namespace=create_namespace,
                report=reporter,
                ingest_timeout=ingest_timeout,
                import_timeout=import_timeout,
            )
    except PackError as exc:
        _echo_err(f"✗ install failed: {exc}")
        sys.exit(1)

    click.echo("")
    click.secho("✓ installed", fg="green")
    for line in report.summary_lines():
        click.echo(f"  {line}")


if __name__ == "__main__":  # pragma: no cover
    main()
