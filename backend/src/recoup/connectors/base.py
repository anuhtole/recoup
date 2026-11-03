"""What every data source looks like to the rest of Recoup.

A connector pulls from one outside system and writes domain rows (transactions,
emails, incidents). Detectors only read those rows, so adding a ledger or a mailbox
means adding a connector, never changing detection.
"""

from dataclasses import dataclass
from typing import Any, Literal, Protocol

from sqlalchemy.orm import Session

Kind = Literal["ledger", "email", "status"]


class ConnectorError(Exception):
    """A sync failure whose message is safe to show a person."""


@dataclass(frozen=True, slots=True)
class SyncOutcome:
    connector: str
    kind: Kind
    ok: bool
    detail: dict[str, Any] | None = None
    error: str | None = None


class Connector(Protocol):
    @property
    def key(self) -> str: ...

    @property
    def kind(self) -> Kind: ...

    @property
    def is_configured(self) -> bool: ...

    def sync(self, session: Session) -> dict[str, Any]:
        """Pull new data into the session. Raises ConnectorError after recording a failure."""
        ...
