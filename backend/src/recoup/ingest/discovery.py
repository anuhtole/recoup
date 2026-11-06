"""Suggest vendors from what a company already has: merchants on its ledger that the
directory does not know yet, with the mail domains that look like theirs.

These are only suggestions. A person confirms the name, domains and support address
before a vendor is saved, so a recipient never comes from mail alone.
"""

from collections import defaultdict
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from recoup.db.models import EmailRow, TransactionRow
from recoup.domain.merchants import display_merchant
from recoup.domain.sources import sender_domain
from recoup.domain.vendors import VendorDirectory

MAX_SUGGESTIONS = 25
MAX_SENDERS = 3
# Shorter tokens ("AWS" aside) match too many unrelated domains.
MIN_TOKEN_LENGTH = 3


@dataclass(frozen=True, slots=True)
class VendorSuggestion:
    merchant: str  # as it appears on the ledger
    key: str
    name: str
    charges: int
    spend_minor: int
    domains: tuple[str, ...]
    senders: tuple[str, ...]


def _mail_senders(session: Session) -> dict[str, set[str]]:
    by_domain: dict[str, set[str]] = defaultdict(set)
    for address in session.scalars(select(EmailRow.from_addr).distinct()):
        by_domain[sender_domain(address)].add(address.strip().lower())
    return by_domain


def _label(domain: str) -> str:
    """The name part of a domain: "billing.figma.com" -> "figma"."""
    parts = domain.split(".")
    return parts[-2] if len(parts) >= 2 else parts[0]


def _matching_domains(key: str, by_domain: dict[str, set[str]]) -> list[str]:
    tokens = [t.lower() for t in key.split() if len(t) >= MIN_TOKEN_LENGTH]
    if not tokens:
        return []
    return sorted(d for d in by_domain if _label(d).startswith(tokens[0]))


def suggest_vendors(session: Session, vendors: VendorDirectory) -> list[VendorSuggestion]:
    rows = session.execute(
        select(
            TransactionRow.merchant_norm,
            func.max(TransactionRow.merchant),
            func.count(TransactionRow.id),
            func.sum(TransactionRow.amount_minor),
        )
        .where(TransactionRow.amount_minor > 0)
        .group_by(TransactionRow.merchant_norm)
        .order_by(func.sum(TransactionRow.amount_minor).desc())
    ).all()
    by_domain = _mail_senders(session)
    suggestions: list[VendorSuggestion] = []
    for key, merchant, charges, spend in rows:
        if not key or vendors.for_merchant(key) is not None:
            continue
        domains = _matching_domains(key, by_domain)
        senders = sorted({a for d in domains for a in by_domain[d]})[:MAX_SENDERS]
        suggestions.append(
            VendorSuggestion(
                merchant=merchant,
                key=key,
                name=display_merchant(merchant),
                charges=charges,
                spend_minor=spend or 0,
                domains=tuple(domains),
                senders=tuple(senders),
            )
        )
        if len(suggestions) == MAX_SUGGESTIONS:
            break
    return suggestions
