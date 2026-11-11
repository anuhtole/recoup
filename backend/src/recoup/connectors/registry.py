"""The connectors Recoup ships with, and running them together."""

from collections.abc import Sequence
from dataclasses import asdict, dataclass
from typing import Any

import httpx
from sqlalchemy.orm import Session

from recoup.config import Settings
from recoup.connectors.base import Connector, ConnectorError, Kind, SyncOutcome
from recoup.ingest.company import company_sources
from recoup.ingest.gmail import GmailError
from recoup.ingest.live import Fetcher, http_fetcher, sync_gmail, sync_ramp, sync_status_feeds
from recoup.ingest.ramp import RampError
from recoup.ingest.sources import Sources

_STATUS_TIMEOUT_SECONDS = 20.0


@dataclass(frozen=True)
class RampConnector:
    settings: Settings
    key: str = "ramp"
    kind: Kind = "ledger"

    @property
    def is_configured(self) -> bool:
        return self.settings.ramp_configured

    def sync(self, session: Session) -> dict[str, Any]:
        try:
            return asdict(sync_ramp(session, self.settings))
        except RampError as exc:
            raise ConnectorError(str(exc)) from exc


@dataclass(frozen=True)
class GmailConnector:
    settings: Settings
    sources: Sources
    key: str = "gmail"
    kind: Kind = "email"

    @property
    def is_configured(self) -> bool:
        return self.settings.gmail_configured

    def sync(self, session: Session) -> dict[str, Any]:
        try:
            vendors = company_sources(session, self.sources).vendors
            return asdict(sync_gmail(session, self.settings, vendors))
        except GmailError as exc:
            raise ConnectorError(str(exc)) from exc


@dataclass(frozen=True)
class StatusPagesConnector:
    """Public vendor status pages: no credentials, so always on."""

    fetch: Fetcher | None = None
    origin: str = "live"
    key: str = "status_pages"
    kind: Kind = "status"

    @property
    def is_configured(self) -> bool:
        return True

    def sync(self, session: Session) -> dict[str, Any]:
        if self.fetch is not None:
            feeds = sync_status_feeds(session, self.fetch, origin=self.origin)
        else:
            with httpx.Client(timeout=_STATUS_TIMEOUT_SECONDS) as client:
                feeds = sync_status_feeds(session, http_fetcher(client), origin=self.origin)
        # A failed feed is recorded and keeps its last good data; it never fails the rest.
        return {
            "feeds_ok": sum(f.ok for f in feeds),
            "feeds_failed": [f.feed for f in feeds if not f.ok],
        }


def build_connectors(settings: Settings, sources: Sources) -> tuple[Connector, ...]:
    """Ledger first, then mail, then status pages: later detection reads all three."""
    return (
        RampConnector(settings),
        GmailConnector(settings, sources),
        StatusPagesConnector(),
    )


def sync_all(session: Session, connectors: Sequence[Connector]) -> list[SyncOutcome]:
    """Run every configured connector. One failing never stops the others."""
    outcomes: list[SyncOutcome] = []
    for connector in connectors:
        if not connector.is_configured:
            continue
        try:
            detail = connector.sync(session)
        except ConnectorError as exc:
            outcomes.append(SyncOutcome(connector.key, connector.kind, False, error=str(exc)))
            continue
        outcomes.append(SyncOutcome(connector.key, connector.kind, True, detail=detail))
    return outcomes
