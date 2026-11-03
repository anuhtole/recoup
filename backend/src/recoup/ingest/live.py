"""Sync real data from outside: vendor status pages, the Ramp ledger, and Gmail.

Each pull is recorded whether or not it works. A failed feed keeps its last good
data and never stops the others. Once a vendor's status feed has synced, its real
incidents and published SLA replace any synthetic ones, so the two never mix.
"""

import json
import logging
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass, replace
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
from pydantic import ValidationError
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from recoup.config import Settings
from recoup.db.models import IncidentRow, StateRow, SyncRunRow
from recoup.detectors.outages import PeriodAssessment, assess_periods
from recoup.domain.sources import Incident
from recoup.domain.types import Transaction, transaction_key
from recoup.domain.vendors import VendorDirectory
from recoup.ingest.gmail import SOURCE as GMAIL_SOURCE
from recoup.ingest.gmail import GmailClient, GmailError, vendor_query
from recoup.ingest.loader import ingest_transactions
from recoup.ingest.ramp import SOURCE as RAMP_SOURCE
from recoup.ingest.ramp import RampClient, RampError
from recoup.ingest.sources import Sources, ingest_emails
from recoup.ingest.status_feeds import FEEDS, StatusFeed
from recoup.ingest.statuspage import ParsedFeed, parse_feed

logger = logging.getLogger(__name__)

STATUS_PREFIX = "status:"
_FETCH_TIMEOUT_SECONDS = 20.0
_MAX_FEED_ATTEMPTS = 2

Fetcher = Callable[[StatusFeed], dict[str, Any]]


@dataclass(frozen=True, slots=True)
class FeedResult:
    feed: str
    ok: bool
    incidents_seen: int
    downtime_spans: int
    history_from: str | None
    error: str | None = None


def http_fetcher(client: httpx.Client) -> Fetcher:
    def fetch(feed: StatusFeed) -> dict[str, Any]:
        for attempt in range(_MAX_FEED_ATTEMPTS):
            try:
                response = client.get(feed.url, follow_redirects=True)
                response.raise_for_status()
                payload: dict[str, Any] = response.json()
                return payload
            except httpx.HTTPError:
                if attempt == _MAX_FEED_ATTEMPTS - 1:
                    raise
        raise AssertionError("unreachable")

    return fetch


def snapshot_fetcher(snapshot_dir: Path) -> Fetcher:
    """A recorded copy of the real feeds, so a demo does not depend on venue Wi-Fi."""

    def fetch(feed: StatusFeed) -> dict[str, Any]:
        payload: dict[str, Any] = json.loads((snapshot_dir / f"{feed.key}.json").read_text())
        return payload

    return fetch


def _store_feed(session: Session, feed: StatusFeed, parsed: ParsedFeed) -> None:
    """Replace what the feed still reports; older incidents it no longer returns stay."""
    session.execute(
        delete(IncidentRow).where(
            IncidentRow.feed == feed.key,
            IncidentRow.feed_incident_id.in_(parsed.incident_ids),
        )
    )
    for span in parsed.spans:
        feed_incident_id = span.id.split(":")[2]
        session.add(
            IncidentRow(
                id=span.id,
                feed=feed.key,
                feed_incident_id=feed_incident_id,
                vendor_key=span.vendor_key,
                title=span.title,
                component=span.component or "",
                severity=span.severity,
                started_at=span.started_at,
                ended_at=span.ended_at,
                status_url=span.status_url,
            )
        )
    session.flush()


def sync_status_feeds(
    session: Session,
    fetch: Fetcher,
    *,
    origin: str = "live",
    feeds: Sequence[StatusFeed] = FEEDS,
) -> list[FeedResult]:
    results = []
    for feed in feeds:
        try:
            parsed = parse_feed(feed, fetch(feed))
        except (httpx.HTTPError, ValidationError, ValueError, OSError) as exc:
            logger.warning("status feed %s failed: %s", feed.key, exc)
            result = FeedResult(feed.key, False, 0, 0, None, "Could not read this status feed.")
        else:
            _store_feed(session, feed, parsed)
            result = FeedResult(
                feed.key,
                True,
                len(parsed.incident_ids),
                len(parsed.spans),
                parsed.earliest.date().isoformat() if parsed.earliest else None,
            )
        session.add(
            SyncRunRow(
                source=f"{STATUS_PREFIX}{feed.key}",
                ok=result.ok,
                origin=origin,
                detail=asdict(result),
            )
        )
        results.append(result)
    session.flush()
    return results


def _row_to_incident(row: IncidentRow) -> Incident:
    return Incident(
        id=row.id,
        vendor_key=row.vendor_key,
        title=row.title,
        started_at=row.started_at,
        ended_at=row.ended_at,
        status_url=row.status_url,
        component=row.component,
        severity=row.severity,
    )


def _synced_feeds(session: Session, feeds: Sequence[StatusFeed]) -> list[StatusFeed]:
    synced = set(
        session.scalars(select(SyncRunRow.source).where(SyncRunRow.ok.is_(True)).distinct())
    )
    return [f for f in feeds if f"{STATUS_PREFIX}{f.key}" in synced]


def with_live_status(
    session: Session, sources: Sources, feeds: Sequence[StatusFeed] = FEEDS
) -> Sources:
    """The sources to detect against, with real status data where it has been synced."""
    live = _synced_feeds(session, feeds)
    if not live:
        return sources
    keys = {f.contract.vendor_key for f in live}
    names = {f.key for f in live}
    rows = session.scalars(select(IncidentRow).where(IncidentRow.feed.in_(names))).all()
    return replace(
        sources,
        contracts=(
            *(c for c in sources.contracts if c.vendor_key not in keys),
            *(f.contract for f in live),
        ),
        incidents=(
            *(i for i in sources.incidents if i.vendor_key not in keys),
            *(_row_to_incident(r) for r in rows),
        ),
    )


@dataclass(frozen=True, slots=True)
class UptimeCheck:
    feed: str
    period: str
    component: str | None
    uptime_percent: str
    commitment_percent: str
    credit_pct: int
    is_confirmed: bool
    document: str


def _check(feed: StatusFeed, period: PeriodAssessment) -> UptimeCheck:
    target = feed.contract.sla_target_bp or 10_000
    return UptimeCheck(
        feed=feed.key,
        period=period.label,
        component=period.component,
        uptime_percent=f"{period.uptime_bp / 100:.2f}",
        commitment_percent=f"{target / 100:.2f}",
        credit_pct=period.credit_pct,
        is_confirmed=period.is_confirmed,
        document=feed.contract.document,
    )


def uptime_report(
    session: Session, as_of: date, feeds: Sequence[StatusFeed] = FEEDS
) -> list[UptimeCheck]:
    """Every period checked, breach or not, so "no credit owed" is visible too."""
    checks: list[UptimeCheck] = []
    for feed in _synced_feeds(session, feeds):
        rows = session.scalars(select(IncidentRow).where(IncidentRow.feed == feed.key)).all()
        incidents = [_row_to_incident(r) for r in rows]
        checks.extend(_check(feed, p) for p in assess_periods(feed.contract, incidents, as_of))
    return checks


@dataclass(frozen=True, slots=True)
class RampSync:
    environment: str
    pulled: int
    inserted: int
    skipped: dict[str, int]


def sync_ramp(session: Session, settings: Settings, client: RampClient | None = None) -> RampSync:
    """Raises RampError after recording the failure."""
    if not settings.ramp_client_id or settings.ramp_client_secret is None:
        raise RampError(
            "Ramp is not connected. Set RECOUP_RAMP_CLIENT_ID and RECOUP_RAMP_CLIENT_SECRET."
        )
    owned = client is None
    active = client or RampClient(
        settings.ramp_client_id,
        settings.ramp_client_secret.get_secret_value(),
        settings.ramp_env,
    )
    since = datetime.now(UTC) - timedelta(days=settings.ramp_lookback_days)
    try:
        pull = active.pull(since)
    except RampError as exc:
        session.add(
            SyncRunRow(source=RAMP_SOURCE, ok=False, origin="live", detail={"error": str(exc)})
        )
        session.flush()
        raise
    finally:
        if owned:
            active.close()
    result = ingest_transactions(session, pull.transactions)
    sync = RampSync(settings.ramp_env, len(pull.transactions), result.inserted, pull.skipped)
    session.add(SyncRunRow(source=RAMP_SOURCE, ok=True, origin="live", detail=asdict(sync)))
    session.flush()
    return sync


GMAIL_CURSOR = "gmail:synced_through"
# Gmail's after: filter has whole-second precision and mail can arrive late.
_GMAIL_OVERLAP = timedelta(days=1)


@dataclass(frozen=True, slots=True)
class GmailSync:
    query_from: str
    fetched: int
    inserted: int
    skipped: dict[str, int]
    is_truncated: bool


def _gmail_since(session: Session, settings: Settings, now: datetime) -> datetime:
    row = session.get(StateRow, GMAIL_CURSOR)
    if row is None:
        return now - timedelta(days=settings.gmail_lookback_days)
    return datetime.fromisoformat(row.value) - _GMAIL_OVERLAP


def _set_gmail_cursor(session: Session, value: datetime) -> None:
    row = session.get(StateRow, GMAIL_CURSOR)
    if row is None:
        session.add(StateRow(key=GMAIL_CURSOR, value=value.isoformat()))
    else:
        row.value = value.isoformat()


def sync_gmail(
    session: Session,
    settings: Settings,
    vendors: VendorDirectory,
    client: GmailClient | None = None,
) -> GmailSync:
    """Read new vendor mail into the inbox. Raises GmailError after recording the failure."""
    if (
        not settings.gmail_client_id
        or settings.gmail_client_secret is None
        or settings.gmail_refresh_token is None
    ):
        raise GmailError("Gmail is not connected. Run `recoup connect gmail` first.")
    owned = client is None
    active = client or GmailClient(
        settings.gmail_client_id,
        settings.gmail_client_secret.get_secret_value(),
        settings.gmail_refresh_token.get_secret_value(),
    )
    now = datetime.now(UTC)
    since = _gmail_since(session, settings, now)
    try:
        pull = active.pull(vendor_query(vendors, since), settings.gmail_max_messages, vendors)
    except GmailError as exc:
        session.add(
            SyncRunRow(source=GMAIL_SOURCE, ok=False, origin="live", detail={"error": str(exc)})
        )
        session.flush()
        raise
    finally:
        if owned:
            active.close()
    result = ingest_emails(session, pull.emails)
    # A truncated pull missed older mail, so the next one starts from the same place.
    if not pull.is_truncated:
        _set_gmail_cursor(session, now)
    sync = GmailSync(
        since.isoformat(), pull.fetched, result.inserted, pull.skipped, pull.is_truncated
    )
    session.add(SyncRunRow(source=GMAIL_SOURCE, ok=True, origin="live", detail=asdict(sync)))
    session.flush()
    return sync


DEMO_SOURCE = "demo-invoices"


def demo_invoices() -> list[Transaction]:
    """Northwind's fictional Atlassian bills, so real outages have an invoice to price against.

    The outages are real; these charges are not. Their source says so.
    """
    invoices = []
    for descriptor, amount, slug in (
        ("ATLASSIAN JIRA", 180_000, "JIRA"),
        ("ATLASSIAN CONFLUENCE", 110_000, "CONF"),
    ):
        for month in range(4, 10):
            external_id = f"{slug}-2026{month:02d}"
            invoices.append(
                Transaction(
                    id=transaction_key(DEMO_SOURCE, external_id),
                    source=DEMO_SOURCE,
                    external_id=external_id,
                    posted_at=datetime(2026, month, 2, 12, tzinfo=UTC),
                    merchant=descriptor,
                    amount_minor=amount,
                    currency="USD",
                    reference=f"ATL-{external_id}",
                )
            )
    return invoices
