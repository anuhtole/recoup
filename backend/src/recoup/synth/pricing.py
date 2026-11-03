"""Plant price changes against the order forms and label the overcharges they create.

The subscription ledger reads `PRICE_CHANGES`, so a vendor's charge in those
months is the new amount instead of the usual one.
"""

from datetime import date

from recoup.domain.types import LeakType, Outcome, Transaction
from recoup.synth.builder import LedgerBuilder

_JUL, _AUG, _SEP = date(2026, 7, 1), date(2026, 8, 1), date(2026, 9, 1)

# (merchant, month) -> that month's charge.
PRICE_CHANGES: dict[tuple[str, date], int] = {
    # Locked at $480 through December; raised 10% in July anyway.
    **{("FIGMA", m): 52_800 for m in (_JUL, _AUG, _SEP)},
    # The lock ended in June and the 6.25% rise is inside the 7% cap.
    **{("LINEAR APP", m): 17_000 for m in (_JUL, _AUG, _SEP)},
    # One high month, credited back a week later.
    ("GITHUB", _AUG): 23_100,
}


def plant_pricing(b: LedgerBuilder, subs: dict[tuple[str, date], Transaction]) -> None:
    figma = [subs[("FIGMA", m)] for m in (_JUL, _AUG, _SEP)]
    b.case(
        "price-001",
        "positive",
        figma,
        "Figma raised the seat price 10% in July while the order form locks it through December.",
        Outcome.RECOVERABLE,
        leak_type=LeakType.PRICE_OVERCHARGE,
        amount_minor=3 * (52_800 - 48_000),
    )
    linear = [subs[("LINEAR APP", m)] for m in (_JUL, _AUG, _SEP)]
    b.case(
        "pricen-001",
        "hard_negative",
        linear,
        "Linear raised its price after the lock ended, within the 7% cap the contract allows.",
        leak_type=LeakType.PRICE_OVERCHARGE,
    )
    august = subs[("GITHUB", _AUG)]
    credit = b.add(_AUG.replace(day=20), "GITHUB", -(23_100 - 21_000), "GH-202608-CR")
    b.case(
        "pricen-002",
        "hard_negative",
        [august, credit],
        "GitHub overbilled August but credited the difference a week later.",
        leak_type=LeakType.PRICE_OVERCHARGE,
    )
