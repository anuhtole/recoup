from datetime import date

from recoup.detectors.duplicates import DETECTOR_VERSION, DuplicateConfig, detect_duplicates
from recoup.domain.types import LeakType, Outcome
from tests.factories import txn


def test_same_reference_within_window_is_recoverable() -> None:
    first = txn("2026-06-03", "FIGMA", 48_000, "FIG-202606")
    second = txn("2026-06-04", "FIGMA INC", 48_000, "FIG-202606")

    [finding] = detect_duplicates([first, second])

    assert finding.leak_type is LeakType.DUPLICATE_CHARGE
    assert finding.outcome is Outcome.RECOVERABLE
    assert finding.transaction_ids == tuple(sorted([first.id, second.id]))
    assert finding.amount_minor == 48_000
    assert finding.recover_by == date(2026, 10, 2)
    assert finding.detector_version == DETECTOR_VERSION
    assert "$480.00" in finding.reason and "FIG-202606" in finding.reason


def test_finding_cites_both_transactions_and_the_rule() -> None:
    first = txn("2026-06-03", "SLACK", 43_750, "SLK-1")
    second = txn("2026-06-03", "SLACK", 43_750, "SLK-1", hour=14)

    [finding] = detect_duplicates([first, second])

    kinds = [e.kind for e in finding.evidence]
    assert kinds == ["transaction", "transaction", "rule"]
    assert {e.ref for e in finding.evidence if e.kind == "transaction"} == {first.id, second.id}


def test_missing_reference_needs_review() -> None:
    first = txn("2026-05-27", "UBER TRIP", 8_740)
    second = txn("2026-05-28", "UBER TRIP", 8_740)

    [finding] = detect_duplicates([first, second])

    assert finding.outcome is Outcome.NEEDS_REVIEW


def test_one_reference_missing_needs_review() -> None:
    first = txn("2026-08-14", "ZUNI CAFE", 31_250, "CHK-1")
    second = txn("2026-08-16", "ZUNI CAFE", 31_250)

    [finding] = detect_duplicates([first, second])

    assert finding.outcome is Outcome.NEEDS_REVIEW


def test_different_references_are_separate_purchases() -> None:
    first = txn("2026-04-14", "SOUVLA", 18_640, "CHK-1")
    second = txn("2026-04-15", "SOUVLA", 18_640, "CHK-2")

    assert detect_duplicates([first, second]) == []


def test_outside_window_is_ignored() -> None:
    first = txn("2026-06-01", "GITHUB", 21_000, "GH-1")
    second = txn("2026-06-05", "GITHUB", 21_000, "GH-1")

    assert detect_duplicates([first, second]) == []


def test_window_is_configurable() -> None:
    first = txn("2026-06-01", "GITHUB", 21_000, "GH-1")
    second = txn("2026-06-05", "GITHUB", 21_000, "GH-1")

    assert len(detect_duplicates([first, second], DuplicateConfig(window_days=5))) == 1


def test_below_minimum_amount_is_ignored() -> None:
    first = txn("2026-05-06", "BLUE BOTTLE COFFEE", 725, "R-1")
    second = txn("2026-05-06", "BLUE BOTTLE COFFEE", 725, "R-1", hour=13)

    assert detect_duplicates([first, second]) == []


def test_already_refunded_duplicate_is_ignored() -> None:
    first = txn("2026-06-11", "DELTA AIR LINES", 47_380, "RCPT-1")
    second = txn("2026-06-12", "DELTA AIR LINES", 47_380, "RCPT-1")
    refund = txn("2026-06-16", "DELTA AIR LINES", -47_380, "RCPT-1")

    assert detect_duplicates([first, second, refund]) == []


def test_refund_for_a_different_order_does_not_hide_a_duplicate() -> None:
    first = txn("2026-04-22", "AMZN Mktp US", 38_947, "112-1")
    second = txn("2026-04-23", "AMZN Mktp US", 38_947, "112-1")
    unrelated_return = txn("2026-04-30", "AMZN Mktp US", -38_947, "112-9")

    assert len(detect_duplicates([first, second, unrelated_return])) == 1


def test_refund_before_the_duplicate_does_not_count() -> None:
    old_refund = txn("2026-03-01", "BEST BUY", -129_999, "RCPT-1")
    first = txn("2026-08-25", "BEST BUY", 129_999, "RCPT-1")
    second = txn("2026-08-26", "BEST BUY", 129_999, "RCPT-1")

    assert len(detect_duplicates([old_refund, first, second])) == 1


def test_triple_charge_yields_two_findings() -> None:
    charges = [txn(f"2026-07-0{day}", "WEWORK", 420_000, "WW-1") for day in (1, 2, 3)]

    findings = detect_duplicates(charges)

    assert len(findings) == 2
    assert sum(f.amount_minor for f in findings) == 840_000


def test_different_currencies_never_match() -> None:
    first = txn("2026-06-01", "HOTEL", 50_000, "H-1", currency="USD")
    second = txn("2026-06-01", "HOTEL", 50_000, "H-1", currency="EUR")

    assert detect_duplicates([first, second]) == []


def test_finding_key_is_stable_regardless_of_input_order() -> None:
    first = txn("2026-06-03", "FIGMA", 48_000, "FIG-1")
    second = txn("2026-06-04", "FIGMA", 48_000, "FIG-1")

    [a] = detect_duplicates([first, second])
    [b] = detect_duplicates([second, first])

    assert a.key == b.key
