"""Recovery request drafts.

The template drafter is deterministic and always available. The Claude drafter
rewrites the body for tone, then code checks it still states the amount and every
reference, and contains no address or link. If not, the template is used.
Recipients are never chosen here: the workflow takes them from the vendor directory.
"""

import re
from dataclasses import dataclass
from datetime import date
from typing import Protocol

from pydantic import BaseModel

from recoup.config import DEFAULT_ORG
from recoup.domain.dates import human_date
from recoup.domain.types import Evidence, LeakType
from recoup.extract.claude import ClaudeStructured, LlmError
from recoup.extract.prompts import DRAFT_PROMPT_VERSION, DRAFT_SYSTEM
from recoup.recovery.facts import CaseFacts


@dataclass(frozen=True)
class DraftContent:
    subject: str
    body: str
    drafter: str


class Drafter(Protocol):
    def draft(self, facts: CaseFacts) -> DraftContent: ...


# Evidence is stored the way detectors word it ("United Airlines wrote on 2026-07-20: "…"",
# "2026-08-03 charged $528.00, contract allows $480.00 (FIG-202608)"). Letters say it the way a
# person would: "On Jul 20, 2026, you wrote", "Aug 3, 2026 · Figma · $528.00".
_QUOTE = re.compile(r'^(.*?) wrote on (\d{4}-\d{2}-\d{2}): "(.*)"$', re.S)
_PRICED = re.compile(
    r"^(\d{4}-\d{2}-\d{2}) charged (\$[\d,]+\.\d{2}), contract allows (\$[\d,]+\.\d{2})"
    r"(?: \(([^)]*)\))?"
)
_UPTIME = re.compile(r"Uptime ([\d.]+)% vs ([\d.]+)% commitment: (\d+)% of the (.+?) invoice")
_INCIDENT = re.compile(
    r"^(.*?):\s*(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}) to (\d{2}):(\d{2}) UTC\.?\s*(https?://\S+)?\.?$"
)


DASH = "\u2013"  # an en dash between two times


def _day(iso: str) -> str:
    return human_date(date.fromisoformat(iso))


def _pct(text: str) -> str:
    """ "99.90" → "99.9%"."""
    return text.rstrip("0").rstrip(".") + "%" if "." in text else f"{text}%"


def _clock(hour: str, minute: str) -> tuple[str, str]:
    h = int(hour)
    return f"{h % 12 or 12}:{minute}", "AM" if h < 12 else "PM"


def _vendor_name(facts: CaseFacts) -> str:
    return facts.vendor.name if facts.vendor else facts.merchant


def _lines(facts: CaseFacts) -> str:
    """One line per charge: "- Jun 3, 2026 · Figma · $480.00 · FIG-202606"."""
    priced = [_PRICED.match(e.detail) for e in facts.evidence_of("transaction")]
    if priced and all(priced):
        out = []
        for m in priced:
            assert m is not None
            ref = f" · {m[4]}" if m[4] and m[4] != "no reference" else ""
            out.append(f"- {_day(m[1])} · {m[2]} charged, {m[3]} allowed{ref}")
        return "\n".join(out)
    name = _vendor_name(facts)
    return "\n".join(
        f"- {human_date(t.posted_at)} · {name} · {t.money.format()}"
        + (f" · {t.reference}" if t.reference else "")
        for t in facts.transactions
        if t.is_debit
    )


def _card(facts: CaseFacts) -> str:
    return f" (card ending {facts.card_last4})" if facts.card_last4 else ""


def _quote(facts: CaseFacts) -> str:
    """The vendor's own words, told back to them: "On Jul 20, 2026, you wrote: “…”"."""
    emails = facts.evidence_of("email")
    if not emails:
        return ""
    m = _QUOTE.match(emails[0].detail)
    return f"On {_day(m[2])}, you wrote: “{m[3]}”" if m else emails[0].detail


def _incident(detail: str) -> str:
    m = _INCIDENT.match(detail.strip())
    if not m:
        return detail
    start, start_half = _clock(m[3], m[4])
    end, end_half = _clock(m[5], m[6])
    span = (
        f"{start}{DASH}{end} {end_half}"
        if start_half == end_half
        else f"{start} {start_half}{DASH}{end} {end_half}"
    )
    link = f" ({m[7]})" if m[7] else ""
    return f"{m[1]}, {_day(m[2])}, {span} UTC{link}"


def _measured(detail: str) -> str:
    """ "Uptime 99.57% vs 99.90% commitment: 10% of the August 2026 invoice." in plain words."""
    m = _UPTIME.search(detail)
    if not m:
        return detail
    month = m[4].split(" ")[0]
    return (
        f"Uptime was {_pct(m[1])} in {m[4]}, below the {_pct(m[2])} commitment, so the credit "
        f"is {m[3]}% of the {month} invoice."
    )


def _times(n: int) -> str:
    return "once more" if n == 1 else f"{n} more times"


def _duplicate(facts: CaseFacts) -> tuple[str, str]:
    reference = facts.references[0] if facts.references else "the same purchase"
    return (
        f"Duplicate charge for {reference}",
        f"We were charged {facts.amount} twice for {reference}{_card(facts)}:\n\n"
        f"{_lines(facts)}\n\nPlease refund the duplicate charge of {facts.amount} and let us "
        "know once it has been issued.",
    )


def _missing_refund(facts: CaseFacts) -> tuple[str, str]:
    reference = facts.references[0] if facts.references else "our account"
    return (
        f"Refund not received for {reference}",
        f"{_quote(facts)}\n\nAs of {human_date(facts.as_of)}, no refund or credit of "
        f"{facts.amount} has posted to our card{_card(facts)}. The original charge:\n\n"
        f"{_lines(facts)}\n\n"
        "Please issue it, or send us the refund reference so we can trace it with our bank.",
    )


def _after_cancellation(facts: CaseFacts) -> tuple[str, str]:
    charges = sum(1 for t in facts.transactions if t.is_debit)
    return (
        "Charges after cancellation",
        f"{_quote(facts)}\n\nSince then we have been charged {_times(charges)}, "
        f"{facts.amount} in total:\n\n{_lines(facts)}\n\nPlease refund these charges "
        "and confirm the subscription is closed.",
    )


def _sla_credit(facts: CaseFacts) -> tuple[str, str]:
    contract = facts.evidence_of("contract")
    incidents = "\n".join(f"- {_incident(e.detail)}" for e in facts.evidence_of("incident"))
    rule = facts.evidence_of("rule")
    reference = facts.references[0] if facts.references else "the affected invoice"
    # A link means public terms, which may not be what this customer signed.
    source = "Your published SLA" if contract and "://" in contract[0].ref else "Our agreement"
    clause = f"{source} ({contract[0].ref}) states:\n{contract[0].detail}\n\n" if contract else ""
    measured = f"{_measured(rule[0].detail)}\n\n" if rule else ""
    return (
        f"Service credit request for invoice {reference}",
        f"{clause}Your status page reports these incidents:\n{incidents}\n\n{measured}"
        f"We are requesting the service credit of {facts.amount} against invoice {reference}.",
    )


def _price_overcharge(facts: CaseFacts) -> tuple[str, str]:
    contract = facts.evidence_of("contract")
    clause = (
        f"Our agreement ({contract[0].ref}) states:\n{contract[0].detail}\n\n" if contract else ""
    )
    return (
        "Charges above our contracted price",
        f"{clause}These charges came in above that price:\n\n{_lines(facts)}\n\n"
        f"The difference is {facts.amount} in total. Please credit it to our card"
        f"{_card(facts)} and bill the contracted price going forward.",
    )


def _dispute_reason(facts: CaseFacts) -> str:
    """Why we dispute, in plain words for a card issuer: no rule ids, no notes to the reviewer."""
    charges = [t for t in facts.transactions if t.is_debit]
    if facts.leak_type is LeakType.DUPLICATE_CHARGE and len(charges) >= 2:
        first, second = charges[0].posted_at, charges[1].posted_at
        days = (
            f"on {human_date(first)}"
            if first.date() == second.date()
            else f"on {first:%b} {first.day} and {human_date(second)}"
            if first.year == second.year
            else f"on {human_date(first)} and {human_date(second)}"
        )
        purchase = f" for {facts.references[0]}" if facts.references else ""
        return f"We were charged {facts.amount} twice{purchase}, {days}."
    # Other reasons are already plain sentences; drop anything addressed to the reviewer.
    sentences = re.split(r"(?<=\.)\s+", facts.reason.strip())
    keep = [s for s in sentences if not re.search(r"confirm|a person|before (we|you)", s, re.I)]
    return " ".join(keep) or facts.reason


def _evidence_line(e: Evidence) -> str | None:
    if e.kind == "email":
        m = _QUOTE.match(e.detail)
        return f"- Email from {m[1]}, {_day(m[2])}: “{m[3]}”" if m else f"- {e.detail}"
    if e.kind == "contract":
        return f"- Contract ({e.ref}): {e.detail}"
    if e.kind == "incident":
        return f"- Status page: {_incident(e.detail)}"
    if e.kind == "note":
        return f"- {e.detail}"
    return None  # rule rows are how Recoup reasons, not evidence for the issuer


def _dispute(facts: CaseFacts) -> tuple[str, str]:
    first = next((t for t in facts.transactions if t.is_debit), None)
    when = f" on {human_date(first.posted_at)}" if first else ""
    merchant = _vendor_name(facts)
    lines = [line for e in facts.evidence if (line := _evidence_line(e))]
    evidence = "\n\nSupporting evidence:\n" + "\n".join(lines) if lines else ""
    return (
        f"Card dispute: {merchant} {facts.amount}{when}",
        f"We dispute {facts.amount} charged by {merchant}{_card(facts)}.\n\n"
        f"Reason: {_dispute_reason(facts)}\n\nTransactions:\n{_lines(facts)}{evidence}",
    )


_TEMPLATES = {
    LeakType.DUPLICATE_CHARGE: _duplicate,
    LeakType.MISSING_REFUND: _missing_refund,
    LeakType.CHARGED_AFTER_CANCELLATION: _after_cancellation,
    LeakType.SLA_CREDIT: _sla_credit,
    LeakType.PRICE_OVERCHARGE: _price_overcharge,
}


@dataclass(frozen=True)
class TemplateDrafter:
    """Signs every letter with the org's name (Settings.org_name), the same name the app shows."""

    org: str = DEFAULT_ORG
    name = "template/1"

    @property
    def signature(self) -> str:
        return f"Thanks,\n{self.org} Finance"

    def draft(self, facts: CaseFacts) -> DraftContent:
        if facts.vendor is None or facts.is_escalation:
            subject, body = _dispute(facts)
            return DraftContent(subject, f"{body}\n\n{self.signature}", self.name)
        subject, body = _TEMPLATES[facts.leak_type](facts)
        greeting = f"Hello {facts.vendor.name} team,"
        return DraftContent(subject, f"{greeting}\n\n{body}\n\n{self.signature}", self.name)


class _DraftBody(BaseModel):
    body: str


def keeps_the_facts(body: str, facts: CaseFacts) -> bool:
    """A rewritten draft must still state the amount and every reference, and add no
    address or link that a person might not notice."""
    if facts.amount not in body:
        return False
    if any(reference not in body for reference in facts.references):
        return False
    return "@" not in body and "http" not in body.lower()


@dataclass
class ClaudeDrafter:
    llm: ClaudeStructured
    fallback: TemplateDrafter

    @property
    def name(self) -> str:
        return f"claude:{self.llm.model}:{DRAFT_PROMPT_VERSION}"

    def draft(self, facts: CaseFacts) -> DraftContent:
        template = self.fallback.draft(facts)
        if facts.vendor is None or facts.is_escalation:
            return template  # dispute packets stay factual and structured
        prompt = (
            f"Vendor: {facts.vendor.name}\nAmount owed: {facts.amount}\n"
            f"References: {', '.join(facts.references) or 'none'}\n\n"
            f"Facts (every amount, date and reference must survive):\n{template.body}"
        )
        try:
            body = self.llm.parse(DRAFT_SYSTEM, prompt, _DraftBody).body.strip()
        except LlmError:
            return template
        if not keeps_the_facts(body, facts):
            return template
        return DraftContent(template.subject, body, self.name)
