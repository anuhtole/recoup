"""Load a dataset directory (ledger, inbox, answer-key clock) into the database."""

import json
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from sqlalchemy.orm import Session

from recoup.db.models import StateRow
from recoup.db.state import set_as_of
from recoup.ingest.loader import ingest_transactions, load_transactions_file
from recoup.ingest.sources import ingest_emails, load_emails_file


@dataclass(frozen=True, slots=True)
class DatasetIngest:
    transactions_inserted: int
    emails_inserted: int
    as_of: str | None


def ingest_dataset(session: Session, data_dir: Path) -> DatasetIngest:
    txns = ingest_transactions(session, load_transactions_file(data_dir / "transactions.json"))
    emails = ingest_emails(session, load_emails_file(data_dir / "emails.json"))

    # A synthetic dataset carries its own "today"; set it once so the demo clock starts there.
    as_of: str | None = None
    labels = data_dir / "labels.json"
    if labels.exists() and session.get(StateRow, "as_of") is None:
        as_of = json.loads(labels.read_text()).get("as_of")
        if as_of:
            set_as_of(session, date.fromisoformat(as_of))
    return DatasetIngest(txns.inserted, emails.inserted, as_of)
