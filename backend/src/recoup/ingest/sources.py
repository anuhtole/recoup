"""Load and ingest the non-ledger sources.

Emails go into the database (they arrive over time and threads matter). The
vendor directory, contracts, and status-page incidents are reference data read
from files.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from pydantic import TypeAdapter
from sqlalchemy import select
from sqlalchemy.orm import Session

from recoup.db.models import EmailRow
from recoup.domain.sources import Contract, Email, Incident, Vendor, email_key
from recoup.domain.vendors import VendorDirectory
from recoup.ingest.loader import IngestResult

_EMAILS = TypeAdapter(list[Email])


@dataclass(frozen=True)
class Sources:
    vendors: VendorDirectory
    contracts: tuple[Contract, ...]
    incidents: tuple[Incident, ...]


_VENDORS = TypeAdapter(list[Vendor])
_CONTRACTS = TypeAdapter(list[Contract])
_INCIDENTS = TypeAdapter(list[Incident])


def _read[T](path: Path, adapter: TypeAdapter[list[T]]) -> list[T]:
    return adapter.validate_json(path.read_bytes()) if path.exists() else []


def load_sources(data_dir: Path) -> Sources:
    return Sources(
        vendors=VendorDirectory(_read(data_dir / "vendors.json", _VENDORS)),
        contracts=tuple(_read(data_dir / "contracts.json", _CONTRACTS)),
        incidents=tuple(_read(data_dir / "incidents.json", _INCIDENTS)),
    )


def load_emails_file(path: Path) -> list[Email]:
    emails = _EMAILS.validate_json(path.read_bytes()) if path.exists() else []
    for email in emails:
        if email.id != email_key(email.message_id):
            raise ValueError(f"Email {email.message_id} has id {email.id}, expected a content key")
    return emails


def ingest_emails(session: Session, emails: Sequence[Email]) -> IngestResult:
    incoming = {email.id: email for email in emails}
    existing = set(session.scalars(select(EmailRow.id).where(EmailRow.id.in_(incoming))))
    rows = [
        EmailRow(**email.model_dump())
        for email_id, email in incoming.items()
        if email_id not in existing
    ]
    session.add_all(rows)
    return IngestResult(inserted=len(rows), skipped=len(incoming) - len(rows))


def row_to_email(row: EmailRow) -> Email:
    return Email(
        id=row.id,
        message_id=row.message_id,
        thread_id=row.thread_id,
        in_reply_to=row.in_reply_to,
        from_addr=row.from_addr,
        to_addr=row.to_addr,
        subject=row.subject,
        sent_at=row.sent_at,
        body=row.body,
    )
