"""GroundWork feed connectors.

COA supports exactly three source shapes — GLUE_DATABASE, JDBC_DATABASE, and
DOCUMENTS — with no plugin model, so a REST feed cannot be a COA source directly.
These connectors normalise public feeds into Markdown documents in S3, which you
then register once as a DOCUMENTS source.
"""

from . import cisa_kev, mitre_ics, nvd
from .base import ConnectorError, Document, S3DocumentWriter

__version__ = "0.1.0"

__all__ = [
    "ConnectorError",
    "Document",
    "S3DocumentWriter",
    "cisa_kev",
    "mitre_ics",
    "nvd",
]
