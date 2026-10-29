import json
from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from recoup.db.models import TransactionRow
from recoup.db.session import session_scope
from recoup.ingest.loader import ingest_transactions, load_transactions_file, row_to_transaction
from tests.factories import txn


def test_ingest_is_idempotent(session_factory: sessionmaker[Session]) -> None:
    transactions = [txn("2026-06-03", "FIGMA", 48_000, "FIG-1"), txn("2026-06-04", "SLACK", 100)]

    with session_scope(session_factory) as session:
        first = ingest_transactions(session, transactions)
    with session_scope(session_factory) as session:
        second = ingest_transactions(session, transactions)
        count = session.scalar(select(func.count()).select_from(TransactionRow))

    assert (first.inserted, first.skipped) == (2, 0)
    assert (second.inserted, second.skipped) == (0, 2)
    assert count == 2


def test_round_trip_preserves_utc_timestamps(session_factory: sessionmaker[Session]) -> None:
    original = txn("2026-06-03", "FIGMA", 48_000, "FIG-1", hour=23)

    with session_scope(session_factory) as session:
        ingest_transactions(session, [original])
    with session_scope(session_factory) as session:
        row = session.get(TransactionRow, original.id)
        assert row is not None
        restored = row_to_transaction(row)

    assert restored == original


def test_load_rejects_ids_that_do_not_match_their_source_key(tmp_path: Path) -> None:
    record = txn("2026-06-03", "FIGMA", 48_000).model_dump(mode="json")
    record["id"] = "txn_forged"
    path = tmp_path / "transactions.json"
    path.write_text(json.dumps([record]))

    with pytest.raises(ValueError, match="expected"):
        load_transactions_file(path)
