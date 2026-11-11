"""Where approved messages go.

`LocalOutbox` records the message and assigns a Message-ID; nothing leaves the
machine. `GmailOutbox` (`recovery/gmail_outbox.py`) sends through the connected
mailbox instead when RECOUP_GMAIL_SEND is on. Either way the outbox is reached only
from `send_draft`, after a person has approved that message.
"""

from typing import Protocol

from recoup.db.models import DraftRow


class OutboxError(Exception):
    """A send that failed, with a message that is safe to show a person.

    `is_ambiguous` means the message may have gone out anyway (the mail service
    stopped answering mid-send), so the draft must not be offered for sending again.
    """

    def __init__(self, message: str, *, is_ambiguous: bool = False) -> None:
        super().__init__(message)
        self.is_ambiguous = is_ambiguous


class Outbox(Protocol):
    def send(self, draft: DraftRow) -> str:
        """Deliver the draft and return its Message-ID. Raises OutboxError on failure."""
        ...


def local_message_id(draft: DraftRow, domain: str) -> str:
    return f"<recoup-draft-{draft.id}.finding-{draft.finding_id}@{domain}>"


class LocalOutbox:
    domain = "northwind.example"

    def send(self, draft: DraftRow) -> str:
        return local_message_id(draft, self.domain)
