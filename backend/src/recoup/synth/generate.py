"""Generate six months of a fictional 60-person startup's money trail.

The output is everything Recoup reads, plus an answer key:

- transactions.json: what a card feed would give us.
- emails.json: vendor email (refund promises, refusals, cancellations, injections).
- vendors.json, contracts.json: the vendor directory and SLA terms.
- incidents.json: public status-page incidents.
- labels.json: the answer key. Every planted leak is a `positive` case; every
  tricky look-alike that must NOT be flagged is a `hard_negative` case.

Background spend is generated with a collision guard so it never creates an
accidental, unlabeled duplicate. Same seed, same bytes.
"""

import json
import random
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from recoup.domain.sources import Contract, Email, Incident, Vendor
from recoup.domain.types import Outcome, Transaction
from recoup.synth.builder import LedgerBuilder
from recoup.synth.inbox import plant_inbox
from recoup.synth.outages import plant_outages
from recoup.synth.vendors import CONTRACTS, VENDORS

DEFAULT_SEED = 20261028
DATASET = "northwind-labs-synthetic"
PERIOD_START = date(2026, 4, 1)
PERIOD_END = date(2026, 9, 30)
# The demo clock: the day Recoup "runs" against this dataset.
AS_OF = date(2026, 10, 1)


def _months() -> list[date]:
    return [date(2026, month, 1) for month in range(PERIOD_START.month, PERIOD_END.month + 1)]


_SUBSCRIPTIONS: list[tuple[str, int, int, str]] = [
    ("FIGMA", 48_000, 3, "FIG"),
    ("SLACK TECHNOLOGIES", 43_750, 5, "SLK"),
    ("NOTION LABS", 24_000, 10, "NTN"),
    ("GITHUB", 21_000, 12, "GH"),
    ("LINEAR APP", 16_000, 15, "LIN"),
    ("ZOOM.US", 14_990, 18, "ZM"),
    ("GOOGLE WORKSPACE", 100_800, 1, "GWS"),
    ("WEWORK", 420_000, 1, "WW"),
]


def _subscriptions(b: LedgerBuilder) -> dict[tuple[str, date], Transaction]:
    charges: dict[tuple[str, date], Transaction] = {}
    for month in _months():
        for merchant, amount, day_of_month, prefix in _SUBSCRIPTIONS:
            day = month.replace(day=day_of_month)
            charges[(merchant, month)] = b.add(day, merchant, amount, f"{prefix}-{month:%Y%m}")
        aws_amount = b.rng.randint(320_000, 410_000)
        charges[("AWS", month)] = b.add(
            month.replace(day=2), "AMAZON WEB SERVICES", aws_amount, f"AWS-{month:%Y%m}"
        )
    return charges


def _plant_positives(b: LedgerBuilder, subs: dict[tuple[str, date], Transaction]) -> None:
    def dup_of(original: Transaction, days_later: int, merchant: str | None = None) -> Transaction:
        day = original.posted_at.date() + timedelta(days=days_later)
        return b.add(day, merchant or original.merchant, original.amount_minor, original.reference)

    june, july, aug = date(2026, 6, 1), date(2026, 7, 1), date(2026, 8, 1)
    recoverable = Outcome.RECOVERABLE

    figma = subs[("FIGMA", june)]
    b.case(
        "dup-001",
        "positive",
        [figma, dup_of(figma, 1, "FIGMA INC")],
        "June Figma invoice billed twice under a variant descriptor.",
        recoverable,
    )
    slack = subs[("SLACK TECHNOLOGIES", july)]
    b.case(
        "dup-002",
        "positive",
        [slack, dup_of(slack, 0)],
        "Slack payment retried the same day after a timeout.",
        recoverable,
    )
    aws = subs[("AWS", aug)]
    b.case(
        "dup-003",
        "positive",
        [aws, dup_of(aws, 2)],
        "August AWS invoice charged twice two days apart.",
        recoverable,
    )
    wework = subs[("WEWORK", july)]
    b.case(
        "dup-004",
        "positive",
        [wework, dup_of(wework, 1, "WeWork Inc")],
        "July WeWork membership billed twice.",
        recoverable,
    )

    one_offs = [
        (
            "dup-005",
            date(2026, 4, 22),
            "AMZN Mktp US",
            38_947,
            b.ref("112-", 7),
            1,
            "AMZN MKTP US",
            "Amazon order charged twice.",
        ),
        (
            "dup-006",
            date(2026, 5, 9),
            "UNITED AIRLINES",
            68_420,
            b.ref("016-", 10),
            0,
            None,
            "Same United ticket charged twice at checkout.",
        ),
        (
            "dup-007",
            date(2026, 7, 16),
            "SQ *JOES CATERING",
            185_000,
            "JC-1042",
            2,
            "Joe's Catering LLC",
            "All-hands catering invoice paid twice via two processors.",
        ),
        (
            "dup-008",
            date(2026, 9, 8),
            "MARRIOTT SF UNION SQ",
            51_236,
            b.ref("MAR-"),
            1,
            None,
            "Hotel folio charged at checkout and again the next day.",
        ),
    ]
    for case_id, day, merchant, amount, reference, gap, alt, description in one_offs:
        first = b.add(day, merchant, amount, reference)
        second = b.add(day + timedelta(days=gap), alt or merchant, amount, reference)
        b.case(case_id, "positive", [first, second], description, recoverable)

    review = Outcome.NEEDS_REVIEW
    no_refs = [
        (
            "dup-009",
            date(2026, 5, 27),
            "UBER TRIP",
            8_740,
            None,
            None,
            1,
            "Two identical Uber charges a day apart with no trip reference.",
        ),
        (
            "dup-010",
            date(2026, 6, 19),
            "LYFT RIDE",
            6_420,
            None,
            None,
            0,
            "Two identical Lyft charges the same day, no reference.",
        ),
        (
            "dup-011",
            date(2026, 8, 14),
            "ZUNI CAFE",
            31_250,
            b.ref("CHK-"),
            None,
            2,
            "Same restaurant amount twice; only one charge carries a check number.",
        ),
        (
            "dup-012",
            date(2026, 9, 21),
            "OFFICE DEPOT",
            24_999,
            None,
            None,
            1,
            "Office Depot charged the same amount twice with no order reference.",
        ),
    ]
    for case_id, day, merchant, amount, ref_a, ref_b, gap, description in no_refs:
        first = b.add(day, merchant, amount, ref_a)
        second = b.add(day + timedelta(days=gap), merchant, amount, ref_b)
        b.case(case_id, "positive", [first, second], description, review)


def _plant_hard_negatives(b: LedgerBuilder, subs: dict[tuple[str, date], Transaction]) -> None:
    distinct_refs = [
        ("neg-001", date(2026, 4, 14), "SOUVLA", 18_640, 1, "Two team lunches, different checks."),
        (
            "neg-002",
            date(2026, 6, 24),
            "AMZN Mktp US",
            12_999,
            0,
            "Two separate Amazon orders for the same monitor.",
        ),
        (
            "neg-003",
            date(2026, 7, 28),
            "UNITED AIRLINES",
            54_310,
            0,
            "Two employees booked the same fare; different ticket numbers.",
        ),
        ("neg-004", date(2026, 9, 2), "STAPLES", 8_915, 2, "Two separate supply runs."),
    ]
    for case_id, day, merchant, amount, gap, description in distinct_refs:
        first = b.add(day, merchant, amount, b.ref("ORD-"))
        second = b.add(day + timedelta(days=gap), merchant, amount, b.ref("ORD-"))
        b.case(case_id, "hard_negative", [first, second], description)

    notion = subs[("NOTION LABS", date(2026, 5, 1))]
    notion_dup = b.add(
        notion.posted_at.date() + timedelta(days=1),
        notion.merchant,
        notion.amount_minor,
        notion.reference,
    )
    notion_refund = b.add(
        notion.posted_at.date() + timedelta(days=4),
        notion.merchant,
        -notion.amount_minor,
        notion.reference,
    )
    b.case(
        "neg-005",
        "hard_negative",
        [notion, notion_dup, notion_refund],
        "Notion double charge that the vendor already refunded.",
    )

    refunded = [
        ("neg-006", date(2026, 6, 11), "DELTA AIR LINES", 47_380, "Delta refunded the duplicate."),
        ("neg-007", date(2026, 8, 25), "BEST BUY", 129_999, "Best Buy reversed the extra charge."),
    ]
    for case_id, day, merchant, amount, description in refunded:
        reference = b.ref("RCPT-")
        first = b.add(day, merchant, amount, reference)
        second = b.add(day + timedelta(days=1), merchant, amount, reference)
        credit = b.add(day + timedelta(days=5), merchant, -amount, reference)
        b.case(case_id, "hard_negative", [first, second, credit], description)

    small = [
        ("neg-008", date(2026, 5, 6), "BLUE BOTTLE COFFEE", 725, "Coffee twice, below threshold."),
        ("neg-009", date(2026, 7, 9), "PHILZ COFFEE", 650, "Coffee twice, below threshold."),
        ("neg-010", date(2026, 8, 4), "WALGREENS", 1_899, "Small duplicate, below threshold."),
    ]
    for case_id, day, merchant, amount, description in small:
        reference = b.ref("R-")
        first = b.add(day, merchant, amount, reference)
        second = b.add(day, merchant, amount, reference)
        b.case(case_id, "hard_negative", [first, second], description)

    splits = [
        (
            "neg-011",
            date(2026, 4, 29),
            "MARRIOTT SF UNION SQ",
            32_000,
            18_450,
            "Room and event space on the same folio, charged separately.",
        ),
        (
            "neg-012",
            date(2026, 6, 2),
            "SQ *JOES CATERING",
            60_000,
            125_000,
            "Catering deposit and balance.",
        ),
        (
            "neg-013",
            date(2026, 9, 15),
            "AMZN Mktp US",
            4_599,
            23_410,
            "Two different Amazon orders the same day.",
        ),
    ]
    for case_id, day, merchant, first_amount, second_amount, description in splits:
        reference = b.ref("INV-")
        first = b.add(day, merchant, first_amount, reference)
        second = b.add(day, merchant, second_amount, reference)
        b.case(case_id, "hard_negative", [first, second], description)


_RESTAURANTS = ["TARTINE MANUFACTORY", "SOUVLA", "NOPALITO", "ZUNI CAFE", "SUPER DUPER BURGERS"]
_COFFEE = ["BLUE BOTTLE COFFEE", "PHILZ COFFEE", "SIGHTGLASS COFFEE"]


def _background(b: LedgerBuilder) -> None:
    day = PERIOD_START
    while day <= PERIOD_END:
        weekday = day.weekday() < 5
        if weekday and b.rng.random() < 0.8:
            coffee = b.rng.choice(_COFFEE)
            b.add_background(day, coffee, b.rng.choice([550, 650, 725, 850]))
        if weekday and b.rng.random() < 0.5:
            reference = b.ref("CHK-") if b.rng.random() < 0.8 else None
            b.add_background(
                day, b.rng.choice(_RESTAURANTS), b.rng.randint(2_500, 42_000), reference
            )
        if b.rng.random() < 0.45:
            b.add_background(day, "UBER TRIP", b.rng.randint(1_800, 6_500))
        if b.rng.random() < 0.3:
            order = b.add_background(
                day, "AMZN Mktp US", b.rng.randint(1_500, 60_000), b.ref("112-", 7)
            )
            if b.rng.random() < 0.08:
                b.add(
                    day + timedelta(days=b.rng.randint(5, 20)),
                    order.merchant,
                    -order.amount_minor,
                    order.reference,
                )
        if b.rng.random() < 0.06:
            b.add_background(
                day, "UNITED AIRLINES", b.rng.randint(30_000, 90_000), b.ref("016-", 10)
            )
        if b.rng.random() < 0.05:
            b.add_background(
                day, "MARRIOTT SF UNION SQ", b.rng.randint(18_000, 60_000), b.ref("MAR-")
            )
        if weekday and b.rng.random() < 0.08:
            b.add_background(day, "STAPLES", b.rng.randint(1_200, 15_000), b.ref("ORD-"))
        day += timedelta(days=1)


@dataclass(frozen=True)
class World:
    """Everything Recoup can read about Northwind, plus the answer key."""

    transactions: list[Transaction]
    emails: list[Email]
    vendors: tuple[Vendor, ...]
    contracts: tuple[Contract, ...]
    incidents: list[Incident]
    labels: dict[str, Any]


def generate_world(seed: int = DEFAULT_SEED) -> World:
    b = LedgerBuilder(rng=random.Random(seed))
    subscriptions = _subscriptions(b)
    _plant_positives(b, subscriptions)
    _plant_hard_negatives(b, subscriptions)
    inbox = plant_inbox(b, subscriptions, seed)
    incidents = plant_outages(b, subscriptions)
    _background(b)

    transactions = sorted(b.transactions, key=lambda t: (t.posted_at, t.external_id))
    labels = {
        "dataset": DATASET,
        "seed": seed,
        "company": "Northwind Labs (fictional, 60 employees)",
        "period": {"start": PERIOD_START.isoformat(), "end": PERIOD_END.isoformat()},
        "as_of": AS_OF.isoformat(),
        "transaction_count": len(transactions),
        "cases": b.cases,
        "emails": inbox.labels,
    }
    return World(transactions, inbox.emails, VENDORS, CONTRACTS, incidents, labels)


def generate(seed: int = DEFAULT_SEED) -> tuple[list[Transaction], dict[str, Any]]:
    world = generate_world(seed)
    return world.transactions, world.labels


def _dump(models: Sequence[BaseModel]) -> str:
    return json.dumps([m.model_dump(mode="json") for m in models], indent=2, sort_keys=True) + "\n"


def write_dataset(out_dir: Path, seed: int = DEFAULT_SEED) -> dict[str, Path]:
    world = generate_world(seed)
    out_dir.mkdir(parents=True, exist_ok=True)
    contents = {
        "transactions": _dump(world.transactions),
        "emails": _dump(world.emails),
        "vendors": _dump(world.vendors),
        "contracts": _dump(world.contracts),
        "incidents": _dump(world.incidents),
        "labels": json.dumps(world.labels, indent=2, sort_keys=True) + "\n",
    }
    paths = {name: out_dir / f"{name}.json" for name in contents}
    for name, text in contents.items():
        paths[name].write_text(text)
    return paths
