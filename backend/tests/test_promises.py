from datetime import UTC, date, datetime, timedelta

from recoup.detectors.promises import PromiseConfig, detect_broken_promises
from recoup.domain.sources import Promise, PromiseKind
from recoup.domain.types import FindingCandidate, LeakType, Outcome, Transaction
from tests.factories import directory, txn

AS_OF = date(2026, 10, 1)


def _promise(
    day: str = "2026-07-20",
    amount: int | None = 61_240,
    reference: str | None = "016-1",
    kind: PromiseKind = "refund",
    due_in: int = 13,
    effective: str | None = None,
) -> Promise:
    promised_at = datetime.fromisoformat(f"{day}T10:00:00+00:00")
    return Promise(
        email_id="eml_test",
        vendor_key="UNITED AIRLINES",
        vendor_name="United Airlines",
        kind=kind,
        amount_minor=amount,
        currency="USD",
        reference=reference,
        promised_at=promised_at,
        due_by=promised_at.date() + timedelta(days=due_in),
        effective_on=date.fromisoformat(effective) if effective else None,
        quote="A refund of $612.40 has been processed.",
    )


def _detect(
    transactions: list[Transaction], promise: Promise, as_of: date = AS_OF
) -> list[FindingCandidate]:
    return detect_broken_promises(transactions, [promise], directory(), as_of, PromiseConfig())


FLIGHT = txn("2026-07-14", "UNITED AIRLINES", 61_240, "016-1")


def test_past_due_promise_with_no_credit_is_recoverable() -> None:
    [finding] = _detect([FLIGHT], _promise())

    assert (finding.leak_type, finding.outcome) == (LeakType.MISSING_REFUND, Outcome.RECOVERABLE)
    assert finding.transaction_ids == (FLIGHT.id,)
    assert finding.source_refs == ("eml_test",)
    assert [e.kind for e in finding.evidence] == ["email", "transaction", "rule"]


def test_kept_promise_is_not_flagged() -> None:
    credit = txn("2026-07-25", "UNITED AIRLINES", -61_240, "016-1")

    assert _detect([FLIGHT, credit], _promise()) == []


def test_credit_for_a_different_booking_does_not_count() -> None:
    other = txn("2026-07-25", "UNITED AIRLINES", -61_240, "016-2")

    assert len(_detect([FLIGHT, other], _promise())) == 1


def test_promise_not_yet_due_is_pending() -> None:
    assert _detect([FLIGHT], _promise(), as_of=date(2026, 7, 30)) == []


def test_promise_without_amount_needs_review_at_the_charge_amount() -> None:
    [finding] = _detect([FLIGHT], _promise(amount=None))

    assert finding.outcome == Outcome.NEEDS_REVIEW
    assert finding.amount_minor == FLIGHT.amount_minor


def test_promise_that_links_to_no_charge_is_ignored() -> None:
    assert _detect([FLIGHT], _promise(amount=None, reference=None)) == []
    assert _detect([], _promise()) == []


def test_charges_after_cancellation_are_recoverable() -> None:
    charges = [txn(f"2026-{m:02d}-20", "UNITED AIRLINES", 15_000, f"S-{m}") for m in (6, 7, 8)]
    cancel = _promise(day="2026-06-24", kind="cancellation", amount=None, effective="2026-06-24")

    [finding] = _detect(charges, cancel)

    assert finding.leak_type == LeakType.CHARGED_AFTER_CANCELLATION
    assert finding.amount_minor == 30_000
    assert finding.transaction_ids == tuple(sorted(c.id for c in charges[1:]))


def test_cancellation_followed_by_no_charges_is_clean() -> None:
    before = txn("2026-06-05", "UNITED AIRLINES", 9_600, "S-6")
    cancel = _promise(day="2026-06-08", kind="cancellation", amount=None, effective="2026-06-08")

    assert _detect([before], cancel) == []


def test_timestamps_are_compared_in_utc() -> None:
    late_evening = txn("2026-07-25", "UNITED AIRLINES", -61_240, "016-1", hour=23)

    assert late_evening.posted_at.tzinfo == UTC
    assert _detect([FLIGHT, late_evening], _promise()) == []
