"""The scripted demo's start: a clean slate that moves only when the presenter acts.

Clean slate: the ledger (Ramp, staged) is in, nothing has been read from the inbox, no
findings exist, and the clock is at the dataset's start date. The presenter then
connects Gmail (staged: no Google sign-in) and runs a scan, which reads the vendor
emails and runs the real detection pipeline.

The staged connection and the scan flag live in `system_state`, never in process
memory, so they survive the API's --reload and are shared by every worker.
"""

import json
from dataclasses import dataclass
from datetime import UTC, date, datetime, time
from pathlib import Path

from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

from recoup.config import Settings
from recoup.db.models import (
    AuditEventRow,
    DraftRow,
    EmailRow,
    ExtractionRow,
    FindingRow,
    IncidentRow,
    StateRow,
    SyncRunRow,
    TransactionRow,
)
from recoup.db.state import get_as_of, set_as_of
from recoup.demo.history import replay_history
from recoup.ingest.gmail import SOURCE as GMAIL_SOURCE
from recoup.ingest.live import DEMO_SOURCE
from recoup.ingest.loader import ingest_transactions, load_transactions_file
from recoup.ingest.sources import Sources, ingest_emails, load_emails_file
from recoup.pipeline.run import RunSummary, run_pipeline
from recoup.services import Services
from recoup.synth.builder import SOURCE

GMAIL_ADDRESS = "finance@acme.com"
DEFAULT_START = date(2026, 10, 1)
_GMAIL_CONNECTED = "demo.gmail_connected"
_SCANNED = "demo.scanned"
# Ledger rows a reset may delete: the synthetic feed and the fictional status-page invoices.
_DEMO_SOURCES = (SOURCE, DEMO_SOURCE)

# Children before parents, so foreign keys hold at every step.
_TABLES = (
    AuditEventRow,
    DraftRow,
    ExtractionRow,
    FindingRow,
    EmailRow,
    TransactionRow,
    IncidentRow,
    SyncRunRow,
    StateRow,
)
# Tables whose integer ids the UI and tests address; they restart at 1 after a reset.
_SERIAL = ("audit_events", "drafts", "extractions", "findings", "sync_runs")


class NotConnectedError(Exception):
    pass


class NotScannedError(Exception):
    pass


class NotDemoDataError(Exception):
    """The database holds a company's own ledger, which a demo reset must not delete."""


@dataclass(frozen=True, slots=True)
class DemoState:
    scanned: bool
    gmail_connected: bool
    gmail_address: str
    as_of: str
    start_as_of: str


def start_date(data_dir: Path) -> date:
    labels = data_dir / "labels.json"
    if labels.exists():
        value = json.loads(labels.read_text()).get("as_of")
        if value:
            return date.fromisoformat(value)
    return DEFAULT_START


def _flag(session: Session, key: str) -> bool:
    row = session.get(StateRow, key)
    return row is not None and row.value == "true"


def _set_flag(session: Session, key: str, value: bool) -> None:
    row = session.get(StateRow, key)
    if row is None:
        session.add(StateRow(key=key, value="true" if value else "false"))
    else:
        row.value = "true" if value else "false"


def is_staged(settings: Settings) -> bool:
    """The scripted demo: demo mode on generated data."""
    return settings.demo_mode and settings.data_mode == "demo"


def is_staged_database(session: Session, settings: Settings) -> bool:
    """A database the demo's reset has prepared (it carries the scan flag). One built another
    way, such as by `recoup run` or a test's own setup, is not."""
    return is_staged(settings) and session.get(StateRow, _SCANNED) is not None


def require_scanned(session: Session, settings: Settings) -> None:
    """In the scripted demo nothing may detect before the scan: finding ids, counts and the
    clock all assume the scan is what first runs the pipeline.

    Only a database that a reset put at the clean slate is held back. One built another way
    (`recoup run`, a test's own setup) has no scan flag at all and is left alone.
    """
    row = session.get(StateRow, _SCANNED)
    if is_staged(settings) and row is not None and row.value != "true":
        raise NotScannedError("Run the scan from the Agent tab first.")


def gmail_connected(session: Session) -> bool:
    return _flag(session, _GMAIL_CONNECTED)


def _restart_ids(session: Session) -> None:
    """SQLite reuses ids once a table is empty (the schema has no AUTOINCREMENT). Postgres
    keeps its sequences, so restart them; otherwise finding ids would differ per reset."""
    if session.get_bind().dialect.name != "postgresql":
        return
    for table in _SERIAL:
        session.execute(text(f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), 1, false)"))


def reset_demo(session: Session, settings: Settings) -> int:
    """Back to the clean slate in one transaction. Returns the ledger rows loaded.

    Refuses when the ledger holds rows from a real connector or upload.

    Rows are deleted, never the database file, so a running server's engine and its
    pooled connections stay valid; requests in flight wait on SQLite's lock.
    """
    own_rows = session.scalar(
        select(func.count())
        .select_from(TransactionRow)
        .where(TransactionRow.source.notin_(_DEMO_SOURCES))
    )
    if own_rows:
        raise NotDemoDataError(
            f"This database holds {own_rows} ledger rows that are not demo data, so the demo "
            "reset was refused. Point RECOUP_DATABASE_URL at a separate database for the demo."
        )
    for table in _TABLES:
        session.execute(delete(table))
    session.flush()
    _restart_ids(session)
    ledger = ingest_transactions(
        session, load_transactions_file(settings.data_dir / "transactions.json")
    )
    set_as_of(session, start_date(settings.data_dir))
    _set_flag(session, _GMAIL_CONNECTED, False)
    _set_flag(session, _SCANNED, False)
    session.flush()
    return ledger.inserted


def stamp_found_dates(session: Session, settings: Settings) -> int:
    """Date findings by the demo clock, not the wall clock. Returns how many moved.

    A finding's `created_at` defaults to now, which is weeks after the demo's dates, so
    "flagged Oct 1, credited Oct 7" would read as a credit before the claim existed.
    Anything created after the clock's day is restamped to noon on that day.
    """
    as_of = get_as_of(session, settings)
    end_of_day = datetime.combine(as_of, time.max, tzinfo=UTC)
    rows = session.scalars(select(FindingRow).where(FindingRow.created_at > end_of_day)).all()
    for row in rows:
        row.created_at = datetime.combine(as_of, time(12), tzinfo=UTC)
    session.flush()
    return len(rows)


def connect_gmail(session: Session) -> None:
    _set_flag(session, _GMAIL_CONNECTED, True)
    session.flush()


def scan(session: Session, settings: Settings, services: Services, sources: Sources) -> RunSummary:
    """Read the vendor emails and run detection. A second scan creates nothing new."""
    if not gmail_connected(session):
        raise NotConnectedError("Connect Gmail before scanning.")
    emails = load_emails_file(settings.data_dir / "emails.json")
    inserted = ingest_emails(session, emails)
    session.flush()
    summary = run_pipeline(session, settings, services, sources)
    stamp_found_dates(session, settings)
    # Off unless RECOUP_DEMO_HISTORY=true; the function checks the flag itself.
    replay_history(session, settings, services, sources)
    session.add(
        SyncRunRow(
            source=GMAIL_SOURCE,
            ok=True,
            origin="demo",
            detail={
                "query_from": GMAIL_ADDRESS,
                "fetched": len(emails),
                "inserted": inserted.inserted,
                "skipped": {"already_stored": inserted.skipped},
                "is_truncated": False,
                "staged": True,
            },
            finished_at=datetime.now(UTC),
        )
    )
    _set_flag(session, _SCANNED, True)
    session.flush()
    return summary


def demo_state(session: Session, settings: Settings) -> DemoState:
    return DemoState(
        scanned=_flag(session, _SCANNED),
        gmail_connected=gmail_connected(session),
        gmail_address=GMAIL_ADDRESS,
        as_of=get_as_of(session, settings).isoformat(),
        start_as_of=start_date(settings.data_dir).isoformat(),
    )
