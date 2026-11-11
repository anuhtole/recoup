"""Where the money in a set of cases stands: ready to claim, in flight, back, or missed."""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date

from recoup.db.models import FindingRow
from recoup.domain.workflow import STAGE_OF, Stage, Status


@dataclass(frozen=True, slots=True)
class Standing:
    claimable_minor: int
    in_flight_minor: int
    recovered_minor: int
    expired_minor: int
    stage_counts: dict[Stage, int]


def money_standing(rows: Sequence[FindingRow], as_of: date) -> Standing:
    claimable = in_flight = recovered = expired = 0
    stage_counts = dict.fromkeys(Stage, 0)
    for row in rows:
        status = Status(row.status)
        stage_counts[STAGE_OF[status]] += 1
        if status is Status.RECOVERED:
            recovered += row.recovered_minor or 0
        elif status is Status.DISMISSED:
            continue
        elif status is Status.EXPIRED:
            expired += row.amount_minor
        elif STAGE_OF[status] is Stage.WAITING:
            in_flight += row.amount_minor
        elif row.recover_by is not None and row.recover_by < as_of:
            # Never sent and the window has closed: it is missed money, not money still owed.
            expired += row.amount_minor
        else:
            claimable += row.amount_minor
    return Standing(claimable, in_flight, recovered, expired, stage_counts)
