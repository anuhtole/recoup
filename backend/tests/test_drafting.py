from datetime import date
from typing import Any

from recoup.domain.types import Evidence, LeakType
from recoup.extract.claude import ClaudeStructured, LlmError
from recoup.recovery.drafting import ClaudeDrafter, TemplateDrafter, keeps_the_facts
from recoup.recovery.facts import CaseFacts
from tests.factories import directory, txn

CHARGES = (
    txn("2026-06-03", "FIGMA", 48_000, "FIG-202606"),
    txn("2026-06-04", "FIGMA INC", 48_000, "FIG-202606"),
)
FACTS = CaseFacts(
    finding_id=1,
    leak_type=LeakType.DUPLICATE_CHARGE,
    merchant="Figma",
    vendor=directory().for_merchant("FIGMA"),
    amount_minor=48_000,
    currency="USD",
    reason="Charged twice.",
    transactions=CHARGES,
    evidence=tuple(Evidence(kind="transaction", ref=t.id, detail=f"{t.merchant}") for t in CHARGES),
    as_of=date(2026, 10, 1),
)


class _FakeLlm(ClaudeStructured):
    def __init__(self, body: str | None) -> None:
        super().__init__(client=None, model="claude-test")  # type: ignore[arg-type]
        self._body = body

    def parse(self, system: str, user: str, schema: type[Any]) -> Any:
        if self._body is None:
            raise LlmError("refusal")
        return schema(body=self._body)


def test_template_states_the_amount_reference_and_vendor() -> None:
    draft = TemplateDrafter().draft(FACTS)

    assert draft.subject == "Duplicate charge for FIG-202606"
    assert draft.body.startswith("Hello Figma team,")
    assert keeps_the_facts(draft.body, FACTS)


def test_claude_draft_is_used_when_it_keeps_every_fact() -> None:
    body = "Hi Figma, we were billed $480.00 twice for FIG-202606. Please refund one charge."

    draft = ClaudeDrafter(_FakeLlm(body), TemplateDrafter()).draft(FACTS)

    assert (draft.body, draft.drafter) == (body, "claude:claude-test:drafts/1")


def test_claude_draft_that_drops_a_fact_or_adds_an_address_falls_back() -> None:
    template = TemplateDrafter().draft(FACTS)
    for body in (
        "Hi, please refund our duplicate charge.",
        "Billed $480.00 twice for FIG-202606. Reply to refunds@elsewhere.example.",
        "Billed $480.00 twice for FIG-202606. See https://example.com",
        None,
    ):
        assert ClaudeDrafter(_FakeLlm(body), TemplateDrafter()).draft(FACTS) == template
