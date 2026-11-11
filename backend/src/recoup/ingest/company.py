"""What one company told Recoup about itself: its profile, vendors, and contracts.

The bundled files are the starting point. Anything a person adds or confirms in Recoup
is stored in the database and wins over the files, so a company can be set up from
the UI without editing JSON.
"""

import re
from dataclasses import dataclass, replace
from typing import Literal

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from recoup.config import DEFAULT_ORG, Settings
from recoup.db.models import ContractRow, StateRow, VendorRow
from recoup.domain.sources import Contract, Vendor
from recoup.domain.vendors import VendorDirectory
from recoup.ingest.sources import Sources

VendorOrigin = Literal["user", "discovered"]
ContractOrigin = Literal["upload", "user"]

# Until a name is saved in Setup, letters are signed with the name the UI shows.
DEFAULT_COMPANY_NAME = DEFAULT_ORG
MAX_NAME_LENGTH = 120
_PROFILE_PREFIX = "company."
# Deliberately plain: one @, a dot in the domain, no spaces or angle brackets.
_ADDRESS = re.compile(r"^[^@\s<>]+@[^@\s<>]+\.[A-Za-z]{2,}$")


class SetupError(ValueError):
    """Input a person can fix. The message is safe to show."""


def check_address(address: str) -> str:
    cleaned = address.strip()
    if not _ADDRESS.match(cleaned):
        raise SetupError(f"{cleaned or 'That'} is not an email address.")
    return cleaned.lower()


@dataclass(frozen=True, slots=True)
class CompanyProfile:
    """Who Recoup writes on behalf of. Drafts are signed "<name> Finance"."""

    name: str
    # Where card disputes go when a vendor is unknown or has refused.
    card_dispute_address: str
    is_set: bool = False


def get_profile(session: Session, settings: Settings) -> CompanyProfile:
    rows = {
        row.key.removeprefix(_PROFILE_PREFIX): row.value
        for row in session.scalars(select(StateRow).where(StateRow.key.startswith(_PROFILE_PREFIX)))
    }
    return CompanyProfile(
        name=rows.get("name", DEFAULT_COMPANY_NAME),
        card_dispute_address=rows.get("card_dispute_address", settings.card_dispute_address),
        is_set="name" in rows,
    )


def _put_state(session: Session, key: str, value: str) -> None:
    row = session.get(StateRow, key)
    if row is None:
        session.add(StateRow(key=key, value=value))
    else:
        row.value = value


def set_profile(session: Session, name: str, card_dispute_address: str) -> CompanyProfile:
    cleaned = " ".join(name.split())
    if not cleaned or len(cleaned) > MAX_NAME_LENGTH:
        raise SetupError(f"The company name must be 1 to {MAX_NAME_LENGTH} characters.")
    profile = CompanyProfile(cleaned, check_address(card_dispute_address), is_set=True)
    _put_state(session, f"{_PROFILE_PREFIX}name", profile.name)
    _put_state(session, f"{_PROFILE_PREFIX}card_dispute_address", profile.card_dispute_address)
    session.flush()
    return profile


def _row_to_vendor(row: VendorRow) -> Vendor:
    return Vendor(
        key=row.key,
        name=row.name,
        support_email=row.support_email,
        domains=tuple(row.domains),
        aliases=tuple(row.aliases),
    )


def stored_vendors(session: Session) -> list[tuple[Vendor, str]]:
    rows = session.scalars(select(VendorRow).order_by(VendorRow.name)).all()
    return [(_row_to_vendor(row), row.origin) for row in rows]


def save_vendor(session: Session, vendor: Vendor, origin: VendorOrigin) -> Vendor:
    """Add or replace a vendor by key, after checking what a person typed."""
    name = " ".join(vendor.name.split())
    if not vendor.key or not name:
        raise SetupError("A vendor needs a name and the merchant name from the ledger.")
    domains = sorted({d.strip().lower().lstrip("@") for d in vendor.domains if d.strip()})
    if not domains:
        raise SetupError("Add at least one email domain the vendor writes from.")
    cleaned = Vendor(
        key=vendor.key,
        name=name,
        support_email=check_address(vendor.support_email),
        domains=tuple(domains),
        aliases=tuple(sorted(set(vendor.aliases) - {vendor.key})),
    )
    row = session.get(VendorRow, cleaned.key) or VendorRow(key=cleaned.key)
    row.name, row.support_email = cleaned.name, cleaned.support_email
    row.domains, row.aliases, row.origin = list(cleaned.domains), list(cleaned.aliases), origin
    session.add(row)
    session.flush()
    return cleaned


def remove_vendor(session: Session, key: str) -> bool:
    if session.get(VendorRow, key) is None:
        return False
    session.execute(delete(VendorRow).where(VendorRow.key == key))
    return True


def stored_contracts(session: Session) -> list[tuple[int, Contract, str]]:
    rows = session.scalars(select(ContractRow).order_by(ContractRow.vendor_key, ContractRow.plan))
    return [(row.id, Contract.model_validate(row.terms), row.origin) for row in rows]


def save_contract(session: Session, contract: Contract, origin: ContractOrigin) -> int:
    """Add or replace the contract for this vendor and plan. Returns its id."""
    row = session.scalar(
        select(ContractRow).where(
            ContractRow.vendor_key == contract.vendor_key, ContractRow.plan == contract.plan
        )
    ) or ContractRow(vendor_key=contract.vendor_key, plan=contract.plan)
    row.terms, row.origin = contract.model_dump(mode="json"), origin
    session.add(row)
    session.flush()
    return row.id


def remove_contract(session: Session, contract_id: int) -> bool:
    if session.get(ContractRow, contract_id) is None:
        return False
    session.execute(delete(ContractRow).where(ContractRow.id == contract_id))
    return True


def company_sources(session: Session, base: Sources) -> Sources:
    """The bundled sources with this company's stored vendors and contracts on top."""
    vendors = [vendor for vendor, _ in stored_vendors(session)]
    contracts = [contract for _, contract, _ in stored_contracts(session)]
    if not vendors and not contracts:
        return base
    vendor_keys = {v.key for v in vendors}
    contract_keys = {(c.vendor_key, c.plan) for c in contracts}
    return replace(
        base,
        vendors=VendorDirectory((*(v for v in base.vendors if v.key not in vendor_keys), *vendors)),
        contracts=(
            *(c for c in base.contracts if (c.vendor_key, c.plan) not in contract_keys),
            *contracts,
        ),
    )
