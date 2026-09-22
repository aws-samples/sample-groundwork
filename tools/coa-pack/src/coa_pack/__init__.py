"""coa-pack — install GroundWork vertical packs into Context Ontology Accelerator."""

from .client import CoaClient
from .errors import (
    CoaApiError,
    JobFailedError,
    JobTimeoutError,
    PackError,
    PackValidationError,
)
from .installer import InstallReport, install
from .pack import Pack, discover_packs, load_pack

__version__ = "0.1.0"

__all__ = [
    "CoaApiError",
    "CoaClient",
    "InstallReport",
    "JobFailedError",
    "JobTimeoutError",
    "Pack",
    "PackError",
    "PackValidationError",
    "discover_packs",
    "install",
    "load_pack",
]
