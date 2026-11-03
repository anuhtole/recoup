from datetime import date

from recoup.detectors.pricing import PricingConfig, allowed_price, detect_price_overcharges
from recoup.domain.sources import Contract
from recoup.domain.types import FindingCandidate, LeakType, Outcome, Transaction
from recoup.recovery.drafting import TemplateDrafter, keeps_the_facts
from recoup.recovery.facts import CaseFacts
from tests.factories import directory, txn

LOCKED = Contract(
    vendor_key="FIGMA",
    plan="Organization",
    document="figma.pdf",
    price_minor=48_000,
    price_locked_until=date(2026, 12, 31),
    price_clause="Fees are fixed at $480.00 per month through December 31, 2026.",
)
CAPPED = LOCKED.model_copy(
    update={"price_locked_until": date(2026, 6, 30), "price_increase_cap_bp": 700}
)
AS_OF = date(2026, 10, 1)


def _detect(
    transactions: list[Transaction], contract: Contract = LOCKED, as_of: date = AS_OF
) -> list[FindingCandidate]:
    return detect_price_overcharges(transactions, [contract], directory(), as_of)


def test_allowed_price_follows_the_lock_and_the_cap() -> None:
    assert allowed_price(LOCKED, date(2026, 9, 1)) == 48_000
    assert allowed_price(CAPPED, date(2026, 6, 30)) == 48_000
    assert allowed_price(CAPPED, date(2026, 7, 1)) == 51_360
    uncapped = CAPPED.model_copy(update={"price_increase_cap_bp": None})
    assert allowed_price(uncapped, date(2026, 7, 1)) is None
    assert allowed_price(LOCKED.model_copy(update={"price_minor": None}), AS_OF) is None


def test_raise_during_the_lock_is_one_growing_case() -> None:
    charges = [
        txn("2026-06-03", "FIGMA", 48_000, "FIG-202606"),
        txn("2026-07-03", "FIGMA", 52_800, "FIG-202607"),
        txn("2026-08-03", "FIGMA INC", 52_800, "FIG-202608"),
    ]

    [finding] = _detect(charges)

    assert (finding.leak_type, finding.outcome) == (LeakType.PRICE_OVERCHARGE, Outcome.RECOVERABLE)
    assert finding.amount_minor == 9_600
    assert finding.transaction_ids == tuple(sorted(c.id for c in charges[1:]))
    assert finding.identity == "FIGMA:Organization"
    assert finding.recover_by == date(2026, 10, 31)
    assert [e.kind for e in finding.evidence] == ["contract", "transaction", "transaction", "rule"]
    assert "$96.00 over in total" in finding.reason

    [grown] = _detect([*charges, txn("2026-09-03", "FIGMA", 52_800, "FIG-202609")])
    assert (grown.key, grown.amount_minor) == (finding.key, 14_400)


def test_raise_within_the_cap_after_the_lock_is_not_flagged() -> None:
    charges = [txn("2026-07-15", "FIGMA", 51_000), txn("2026-08-15", "FIGMA", 51_360)]
    assert _detect(charges, CAPPED) == []


def test_raise_beyond_the_cap_claims_only_the_excess() -> None:
    [finding] = _detect([txn("2026-07-15", "FIGMA", 55_000)], CAPPED)
    assert finding.amount_minor == 55_000 - 51_360


def test_credit_for_the_difference_or_the_whole_charge_clears_it() -> None:
    july = txn("2026-07-03", "FIGMA", 52_800)
    assert _detect([july, txn("2026-07-10", "FIGMA", -4_800)]) == []
    assert _detect([july, txn("2026-07-10", "FIGMA", -52_800)]) == []
    # A credit that predates the charge, or is some other amount, is not a fix.
    assert len(_detect([txn("2026-07-01", "FIGMA", -4_800), july])) == 1
    assert len(_detect([july, txn("2026-07-10", "FIGMA", -1_000)])) == 1


def test_only_the_first_charge_each_month_is_priced() -> None:
    # The second charge is a duplicate; that detector owns it.
    charges = [txn("2026-07-03", "FIGMA", 52_800), txn("2026-07-04", "FIGMA", 52_800)]
    [finding] = _detect(charges)
    assert finding.transaction_ids == (charges[0].id,)


def test_charges_past_the_dispute_window_or_after_as_of_are_left_out() -> None:
    old, recent = txn("2026-04-03", "FIGMA", 52_800), txn("2026-09-03", "FIGMA", 52_800)
    future = txn("2026-10-03", "FIGMA", 52_800)

    [finding] = _detect([old, recent, future])

    assert finding.transaction_ids == (recent.id,)


def test_small_totals_other_vendors_and_currencies_are_ignored() -> None:
    assert _detect([txn("2026-07-03", "FIGMA", 49_000)]) == []
    assert _detect([txn("2026-07-03", "LINEAR APP", 99_000)]) == []
    assert _detect([txn("2026-07-03", "FIGMA", 99_000, currency="EUR")]) == []
    custom = detect_price_overcharges(
        [txn("2026-07-03", "FIGMA", 49_000)],
        [LOCKED],
        directory(),
        AS_OF,
        PricingConfig(min_amount_minor=500),
    )
    assert len(custom) == 1


def test_terms_the_customer_must_confirm_need_review() -> None:
    contract = LOCKED.model_copy(update={"needs_customer_confirmation": True})
    [finding] = _detect([txn("2026-07-03", "FIGMA", 52_800)], contract)
    assert finding.outcome is Outcome.NEEDS_REVIEW
    assert "confirm" in finding.reason


def test_draft_quotes_the_clause_and_lists_each_charge() -> None:
    charge = txn("2026-07-03", "FIGMA", 52_800, "FIG-202607")
    [finding] = _detect([charge])
    facts = CaseFacts(
        finding_id=1,
        leak_type=finding.leak_type,
        merchant="Figma",
        vendor=directory().for_merchant("FIGMA"),
        amount_minor=finding.amount_minor,
        currency=finding.currency,
        reason=finding.reason,
        transactions=(charge,),
        evidence=finding.evidence,
        as_of=AS_OF,
    )

    draft = TemplateDrafter().draft(facts)

    assert draft.subject == "Charges above our contracted price"
    assert LOCKED.price_clause in draft.body
    assert "contract allows $480.00" in draft.body
    assert keeps_the_facts(draft.body, facts)
