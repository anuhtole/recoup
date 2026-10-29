"""The detection clock. Settings override it; the demo advances it; otherwise it is today."""

from datetime import UTC, date, datetime

from sqlalchemy.orm import Session

from recoup.config import Settings
from recoup.db.models import StateRow

_CLOCK = "as_of"


def get_as_of(session: Session, settings: Settings) -> date:
    if settings.as_of is not None:
        return settings.as_of
    row = session.get(StateRow, _CLOCK)
    return date.fromisoformat(row.value) if row else datetime.now(UTC).date()


def set_as_of(session: Session, value: date) -> None:
    row = session.get(StateRow, _CLOCK)
    if row is None:
        session.add(StateRow(key=_CLOCK, value=value.isoformat()))
    else:
        row.value = value.isoformat()
