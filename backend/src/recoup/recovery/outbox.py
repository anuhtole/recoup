"""Where approved messages go.

`LocalOutbox` records the message and assigns a Message-ID; nothing leaves the
machine. A Gmail outbox would create the message through the API after the same
human approval, with a send-only scope.
"""

from typing import Protocol

from recoup.db.models import DraftRow


class Outbox(Protocol):
    def send(self, draft: DraftRow) -> str:
        """Deliver the draft and return its Message-ID."""
        ...


class LocalOutbox:
    domain = "northwind.example"

    def send(self, draft: DraftRow) -> str:
        return f"<recoup-draft-{draft.id}.finding-{draft.finding_id}@{self.domain}>"
