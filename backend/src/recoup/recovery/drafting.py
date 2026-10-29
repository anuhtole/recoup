"""Recovery request drafts.

The template drafter is deterministic and always available. The Claude drafter
rewrites the body for tone, then code checks it still states the amount and every
reference, and contains no address or link. If not, the template is used.
Recipients are never chosen here: the workflow takes them from the vendor directory.
"""

from dataclasses import dataclass
from typing import Protocol

from pydantic import BaseModel

from recoup.domain.dates import human_date
from recoup.domain.types import LeakType
from recoup.extract.claude import ClaudeStructured, LlmError
from recoup.extract.prompts import DRAFT_PROMPT_VERSION, DRAFT_SYSTEM
from recoup.recovery.facts import CaseFacts

SIGNATURE = "Thanks,\nNorthwind Labs Finance"


@dataclass(frozen=True)
class DraftContent:
    subject: str
    body: str
    drafter: str


class Drafter(Protocol):
    def draft(self, facts: CaseFacts) -> DraftContent: ...


def _lines(facts: CaseFacts) -> str:
    return "\n".join(f"- {e.detail}" for e in facts.evidence_of("transaction"))


def _card(facts: CaseFacts) -> str:
    return f" (card ending {facts.card_last4})" if facts.card_last4 else ""


def _quote(facts: CaseFacts) -> str:
    emails = facts.evidence_of("email")
    return emails[0].detail if emails else ""


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
    return (
        "Charges after cancellation",
        f"{_quote(facts)}\n\nSince then we have been charged {len(facts.transactions)} more "
        f"time(s), {facts.amount} in total:\n\n{_lines(facts)}\n\nPlease refund these charges "
        "and confirm the subscription is closed.",
    )


def _sla_credit(facts: CaseFacts) -> tuple[str, str]:
    contract = facts.evidence_of("contract")
    incidents = "\n".join(f"- {e.detail}" for e in facts.evidence_of("incident"))
    rule = facts.evidence_of("rule")
    reference = facts.references[0] if facts.references else "the affected invoice"
    clause = (
        f"Our agreement ({contract[0].ref}) states:\n{contract[0].detail}\n\n" if contract else ""
    )
    measured = f"{rule[0].detail}\n\n" if rule else ""
    return (
        f"Service credit request for invoice {reference}",
        f"{clause}Your status page reports these incidents:\n{incidents}\n\n{measured}"
        f"We are requesting the service credit of {facts.amount} against invoice {reference}.",
    )


def _dispute(facts: CaseFacts) -> tuple[str, str]:
    first = facts.transactions[0] if facts.transactions else None
    when = f" on {human_date(first.posted_at)}" if first else ""
    return (
        f"Card dispute: {facts.merchant} {facts.amount}{when}",
        f"We dispute {facts.amount} charged by {facts.merchant}{_card(facts)}.\n\n"
        f"Reason: {facts.reason}\n\nTransactions:\n{_lines(facts)}\n\n"
        "Supporting evidence:\n"
        + "\n".join(f"- [{e.kind}] {e.detail}" for e in facts.evidence if e.kind != "transaction"),
    )


_TEMPLATES = {
    LeakType.DUPLICATE_CHARGE: _duplicate,
    LeakType.MISSING_REFUND: _missing_refund,
    LeakType.CHARGED_AFTER_CANCELLATION: _after_cancellation,
    LeakType.SLA_CREDIT: _sla_credit,
}


class TemplateDrafter:
    name = "template/1"

    def draft(self, facts: CaseFacts) -> DraftContent:
        if facts.vendor is None or facts.is_escalation:
            subject, body = _dispute(facts)
            return DraftContent(subject, f"{body}\n\n{SIGNATURE}", self.name)
        subject, body = _TEMPLATES[facts.leak_type](facts)
        greeting = f"Hello {facts.vendor.name} team,"
        return DraftContent(subject, f"{greeting}\n\n{body}\n\n{SIGNATURE}", self.name)


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
