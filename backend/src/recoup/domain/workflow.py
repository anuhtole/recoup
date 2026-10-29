"""Recovery workflow states. Outcome says what a finding *is*; status says where recovery stands."""

from enum import StrEnum


class Status(StrEnum):
    OPEN = "open"
    DRAFTED = "drafted"
    SENT = "sent"
    VENDOR_AGREED = "vendor_agreed"
    INFO_REQUESTED = "info_requested"
    VENDOR_DECLINED = "vendor_declined"
    RECOVERED = "recovered"
    DISMISSED = "dismissed"
    # The claim window closed before anyone asked. Kept visible: it is the cost of not asking.
    EXPIRED = "expired"


class Stage(StrEnum):
    """How the queue groups statuses."""

    TODO = "todo"
    WAITING = "waiting"
    DONE = "done"


STAGE_OF: dict[Status, Stage] = {
    Status.OPEN: Stage.TODO,
    Status.DRAFTED: Stage.TODO,
    Status.INFO_REQUESTED: Stage.TODO,
    Status.VENDOR_DECLINED: Stage.TODO,
    Status.SENT: Stage.WAITING,
    Status.VENDOR_AGREED: Stage.WAITING,
    Status.RECOVERED: Stage.DONE,
    Status.DISMISSED: Stage.DONE,
    Status.EXPIRED: Stage.DONE,
}

CLOSED = {Status.RECOVERED, Status.DISMISSED, Status.EXPIRED}

# Statuses from which a recovery request may be drafted.
DRAFTABLE = {Status.OPEN, Status.DRAFTED, Status.INFO_REQUESTED, Status.VENDOR_DECLINED}
# Statuses in which a posted credit closes the case.
AWAITING_MONEY = {Status.SENT, Status.VENDOR_AGREED, Status.INFO_REQUESTED}
