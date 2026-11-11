"""Set Recoup up for one company: who it writes as, its vendors, and its contracts.

Everything here is what a person typed or confirmed. Recipients come only from the
vendor directory, so this is the one place they can be set.
"""

from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from recoup.api.deps import ContextDep, SessionDep
from recoup.db.models import EmailRow, TransactionRow
from recoup.domain.merchants import normalize_merchant
from recoup.domain.sources import Contract, Vendor
from recoup.ingest.company import (
    SetupError,
    get_profile,
    remove_contract,
    remove_vendor,
    save_contract,
    save_vendor,
    set_profile,
    stored_contracts,
    stored_vendors,
)

router = APIRouter(prefix="/api")


class CompanyIn(BaseModel):
    name: str = Field(max_length=200)
    card_dispute_address: str = Field(max_length=254)


class VendorIn(BaseModel):
    name: str = Field(max_length=200)
    support_email: str = Field(max_length=254)
    domains: list[str] = Field(min_length=1, max_length=20)
    aliases: list[str] = Field(default_factory=list, max_length=20)
    origin: Literal["user", "discovered"] = "user"


def _bad_input(exc: SetupError) -> HTTPException:
    return HTTPException(status_code=422, detail=str(exc))


@router.get("/company")
def company(session: SessionDep, context: ContextDep) -> dict[str, Any]:
    profile = get_profile(session, context.settings)
    return {
        "name": profile.name,
        "card_dispute_address": profile.card_dispute_address,
        "is_set": profile.is_set,
    }


@router.put("/company")
def update_company(body: CompanyIn, session: SessionDep) -> dict[str, Any]:
    try:
        profile = set_profile(session, body.name, body.card_dispute_address)
    except SetupError as exc:
        raise _bad_input(exc) from exc
    return {
        "name": profile.name,
        "card_dispute_address": profile.card_dispute_address,
        "is_set": True,
    }


def _vendor_out(vendor: Vendor, origin: str) -> dict[str, Any]:
    return {**vendor.model_dump(mode="json"), "origin": origin}


@router.get("/vendors")
def vendors(session: SessionDep, context: ContextDep) -> list[dict[str, Any]]:
    stored = {vendor.key: origin for vendor, origin in stored_vendors(session)}
    directory = context.sources_for(session).vendors
    return [
        _vendor_out(v, stored.get(v.key, "bundled"))
        for v in sorted(directory, key=lambda v: v.name)
    ]


# `:path`, so a merchant like "ADOBE/CREATIVE CLOUD" still reaches this route.
@router.put("/vendors/{merchant:path}")
def put_vendor(merchant: str, body: VendorIn, session: SessionDep) -> dict[str, Any]:
    """Add or replace a vendor. `merchant` is the name as it appears on the ledger."""
    vendor = Vendor(
        key=normalize_merchant(merchant),
        name=body.name,
        support_email=body.support_email,
        domains=tuple(body.domains),
        aliases=tuple(a for a in map(normalize_merchant, body.aliases) if a),
    )
    try:
        saved = save_vendor(session, vendor, body.origin)
    except SetupError as exc:
        raise _bad_input(exc) from exc
    return _vendor_out(saved, body.origin)


@router.delete("/vendors/{key:path}")
def delete_vendor(key: str, session: SessionDep) -> dict[str, bool]:
    if not remove_vendor(session, key):
        raise HTTPException(status_code=404, detail="Only vendors added in Recoup can be removed.")
    return {"removed": True}


@router.get("/contracts")
def contracts(session: SessionDep, context: ContextDep) -> list[dict[str, Any]]:
    stored = {(c.vendor_key, c.plan): (cid, origin) for cid, c, origin in stored_contracts(session)}
    out = []
    for contract in context.sources_for(session).contracts:
        cid, origin = stored.get((contract.vendor_key, contract.plan), (None, "bundled"))
        out.append({"id": cid, "origin": origin, **contract.model_dump(mode="json")})
    return out


@router.post("/contracts")
def add_contract(body: Contract, session: SessionDep, context: ContextDep) -> dict[str, Any]:
    """Store terms a person confirmed, typed or read from a document."""
    directory = context.sources_for(session).vendors
    vendor = directory.for_merchant(body.vendor_key) or directory.for_merchant(
        normalize_merchant(body.vendor_key)
    )
    if vendor is None:
        raise HTTPException(status_code=422, detail="Add the vendor before its contract.")
    # Detectors match contracts on the vendor's own key, never an alias.
    contract = body.model_copy(update={"vendor_key": vendor.key})
    contract_id = save_contract(session, contract, "user")
    return {"id": contract_id, "origin": "user", **contract.model_dump(mode="json")}


@router.delete("/contracts/{contract_id}")
def delete_contract(contract_id: int, session: SessionDep) -> dict[str, bool]:
    if not remove_contract(session, contract_id):
        raise HTTPException(
            status_code=404, detail="Only contracts added in Recoup can be removed."
        )
    return {"removed": True}


@router.get("/setup")
def setup(session: SessionDep, context: ContextDep) -> dict[str, Any]:
    """What this company has connected, and what is still missing, in the order to do it."""
    settings = context.settings
    sources = context.sources_for(session)
    transactions = session.scalar(select(func.count(TransactionRow.id))) or 0
    emails = session.scalar(select(func.count(EmailRow.id))) or 0
    steps = [
        ("company", get_profile(session, settings).is_set, "Name the company drafts are sent for."),
        (
            "ledger",
            transactions > 0,
            "Upload a card or bank export as CSV, or connect Ramp.",
        ),
        ("vendors", len(sources.vendors) > 0, "Confirm who to write to for each vendor."),
        (
            "mail",
            settings.gmail_configured or emails > 0,
            "Connect the finance inbox (read-only) to catch credits vendors promised.",
        ),
        ("contracts", len(sources.contracts) > 0, "Upload contracts to catch SLA and price leaks."),
    ]
    return {
        "data_mode": settings.data_mode,
        "counts": {
            "transactions": transactions,
            "emails": emails,
            "vendors": len(sources.vendors),
            "contracts": len(sources.contracts),
        },
        "connections": {
            "ramp": settings.ramp_configured,
            "gmail": settings.gmail_configured,
            # The OAuth client is set on the server, so the app can offer Connect Gmail.
            "gmail_can_connect": bool(settings.gmail_client_id and settings.gmail_client_secret),
        },
        "steps": [{"key": k, "done": done, "hint": hint} for k, done, hint in steps],
    }
