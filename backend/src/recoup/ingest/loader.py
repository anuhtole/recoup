"""Idempotent transaction ingest.

Every transaction is validated against the domain schema before it touches the
database, and keyed by (source, external_id) so re-running ingest is a no-op.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from pydantic import TypeAdapter
from sqlalchemy import select
from sqlalchemy.orm import Session

from recoup.db.models import TransactionRow
from recoup.domain.merchants import normalize_merchant
from recoup.domain.types import Transaction, transaction_key

_TRANSACTIONS = TypeAdapter(list[Transaction])


@dataclass(frozen=True, slots=True)
class IngestResult:
    inserted: int
    skipped: int


def load_transactions_file(path: Path) -> list[Transaction]:
    transactions = _TRANSACTIONS.validate_json(path.read_bytes())
    for txn in transactions:
        expected = transaction_key(txn.source, txn.external_id)
        if txn.id != expected:
            raise ValueError(f"Transaction {txn.external_id} has id {txn.id}, expected {expected}")
    return transactions


def ingest_transactions(session: Session, transactions: Sequence[Transaction]) -> IngestResult:
    incoming = {txn.id: txn for txn in transactions}
    existing = set(
        session.scalars(select(TransactionRow.id).where(TransactionRow.id.in_(incoming)))
    )
    new_rows = [
        TransactionRow(
            id=txn.id,
            source=txn.source,
            external_id=txn.external_id,
            posted_at=txn.posted_at,
            merchant=txn.merchant,
            merchant_norm=normalize_merchant(txn.merchant),
            amount_minor=txn.amount_minor,
            currency=txn.currency,
            reference=txn.reference,
            card_last4=txn.card_last4,
        )
        for txn_id, txn in incoming.items()
        if txn_id not in existing
    ]
    session.add_all(new_rows)
    return IngestResult(inserted=len(new_rows), skipped=len(incoming) - len(new_rows))


def row_to_transaction(row: TransactionRow) -> Transaction:
    return Transaction(
        id=row.id,
        source=row.source,
        external_id=row.external_id,
        posted_at=row.posted_at,
        merchant=row.merchant,
        amount_minor=row.amount_minor,
        currency=row.currency,
        reference=row.reference,
        card_last4=row.card_last4,
    )
