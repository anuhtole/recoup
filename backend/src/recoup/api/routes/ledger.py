"""Upload a ledger as CSV: preview what Recoup read, then import it.

The file travels as text in a JSON body, so nothing is written until a person has
seen the preview and chosen to import.
"""

from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from recoup.api.deps import ContextDep, SessionDep
from recoup.db.models import SyncRunRow, TransactionRow
from recoup.ingest.csv_ledger import (
    MAX_CSV_BYTES,
    ChargeSign,
    Column,
    DateOrder,
    LedgerFileError,
    LedgerParse,
    parse_ledger,
    source_name,
)
from recoup.ingest.loader import ingest_transactions
from recoup.ingest.overlap import split_overlaps
from recoup.pipeline.run import run_pipeline

router = APIRouter(prefix="/api/ledger")
PREVIEW_ROWS = 8


class LedgerIn(BaseModel):
    filename: str = Field(default="ledger.csv", max_length=200)
    text: str = Field(min_length=1, max_length=MAX_CSV_BYTES)
    # Only needed when exports come from more than one card or bank account without an id
    # column. It is not the filename: two downloads of the same account must share keys.
    account: str = Field(default="", max_length=60)
    # Header per field; an empty string means the file has no such column.
    columns: dict[Column, str] | None = None
    charge_sign: ChargeSign | None = None
    date_order: DateOrder | None = None
    currency: str = Field(default="USD", min_length=3, max_length=3)
    # Import rows another source (Ramp, another upload) already holds. Off: they would
    # be stored twice and look like duplicate charges.
    include_overlaps: bool = False


def _parse(body: LedgerIn) -> LedgerParse:
    try:
        return parse_ledger(
            body.text.encode(),
            source=source_name(body.account),
            columns=body.columns,
            charge_sign=body.charge_sign,
            date_order=body.date_order,
            default_currency=body.currency.upper(),
        )
    except LedgerFileError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _summary(parsed: LedgerParse) -> dict[str, Any]:
    return {
        "headers": list(parsed.headers),
        "columns": parsed.columns,
        "charge_sign": parsed.charge_sign,
        "is_sign_certain": parsed.is_sign_certain,
        "date_order": parsed.date_order,
        "is_date_order_certain": parsed.is_date_order_certain,
        "rows": len(parsed.transactions),
        "skipped": parsed.skipped,
        "problems": [asdict(p) for p in parsed.problems],
        "first_date": parsed.first_date,
        "last_date": parsed.last_date,
        "charges_minor": parsed.charges_minor,
    }


def _already_imported(session: SessionDep, parsed: LedgerParse) -> set[str]:
    ids = [t.id for t in parsed.transactions]
    return set(session.scalars(select(TransactionRow.id).where(TransactionRow.id.in_(ids))))


@router.post("/preview")
def preview(body: LedgerIn, session: SessionDep) -> dict[str, Any]:
    parsed = _parse(body)
    known = _already_imported(session, parsed)
    _, overlapping = split_overlaps(session, [t for t in parsed.transactions if t.id not in known])
    sample = [t.model_dump(mode="json") for t in parsed.transactions[:PREVIEW_ROWS]]
    return {
        **_summary(parsed),
        "already_imported": len(known),
        "on_file_elsewhere": len(overlapping),
        "sample": sample,
    }


@router.post("/import")
def import_ledger(body: LedgerIn, session: SessionDep, context: ContextDep) -> dict[str, Any]:
    parsed = _parse(body)
    if not parsed.transactions:
        raise HTTPException(status_code=422, detail="No rows could be read from that file.")
    known = _already_imported(session, parsed)
    fresh, overlapping = split_overlaps(
        session, [t for t in parsed.transactions if t.id not in known]
    )
    rows = [*fresh, *overlapping] if body.include_overlaps else fresh
    result = ingest_transactions(session, rows)
    skipped_overlaps = 0 if body.include_overlaps else len(overlapping)
    source = parsed.transactions[0].source
    detail = {
        **_summary(parsed),
        "filename": body.filename,
        **asdict(result),
        "already_imported": len(known),
        "skipped_overlaps": skipped_overlaps,
    }
    session.add(SyncRunRow(source=source, ok=True, origin="upload", detail=detail))
    session.flush()
    run = run_pipeline(session, context.settings, context.services, context.sources_for(session))
    return {
        "source": source,
        "inserted": result.inserted,
        "duplicates": len(known) + result.skipped,
        "skipped_overlaps": skipped_overlaps,
        "run": asdict(run),
    }
