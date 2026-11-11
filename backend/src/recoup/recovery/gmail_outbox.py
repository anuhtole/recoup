"""Send an approved request from the company's own Gmail.

Reached only from `send_draft`, so only after a person approved this exact message.
The recipient is the address the workflow took from the vendor directory; this
module adds no recipients and refuses anything that is not one plain address.
Card dispute packets are not email to a vendor, so they stay in the local outbox.
"""

import base64
import logging
from collections.abc import Callable
from email.message import EmailMessage
from email.utils import parseaddr

from recoup.config import Settings
from recoup.db.models import DraftRow
from recoup.ingest.gmail import GmailClient, GmailError, GmailSendUnconfirmed
from recoup.recovery.outbox import LocalOutbox, OutboxError, local_message_id

MESSAGE_ID_DOMAIN = "mail.recoup.local"
logger = logging.getLogger(__name__)
_HEADER_BREAKS = ("\r", "\n")


def _single_address(value: str) -> str:
    _, address = parseaddr(value)
    is_plain = address == value.strip() and "@" in address and " " not in address
    if not is_plain or any(c in value for c in (*_HEADER_BREAKS, ",", ";")):
        raise OutboxError("The recipient is not a single email address, so nothing was sent.")
    return address


def build_message(draft: DraftRow) -> EmailMessage:
    """The message exactly as approved: one recipient, the subject, the body."""
    if any(c in draft.subject for c in _HEADER_BREAKS):
        raise OutboxError("The subject has a line break in it, so nothing was sent.")
    message = EmailMessage()
    message["To"] = _single_address(draft.to_addr)
    message["Subject"] = draft.subject
    message["Message-ID"] = local_message_id(draft, MESSAGE_ID_DOMAIN)
    message.set_content(draft.body)
    return message


class GmailOutbox:
    """Gmail when sending is on and the mailbox is connected, the local outbox otherwise.

    Both are checked at send time, so a mailbox connected while the app runs is used
    for the very next approval.
    """

    def __init__(
        self,
        client_factory: Callable[[], GmailClient],
        is_enabled: Callable[[], bool] = lambda: True,
    ) -> None:
        self._client_factory = client_factory
        self._is_enabled = is_enabled
        self._local = LocalOutbox()

    def send(self, draft: DraftRow) -> str:
        if draft.channel != "vendor_email" or not self._is_enabled():
            return self._local.send(draft)
        message = build_message(draft)
        raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
        client = self._client_factory()
        try:
            return self._deliver(client, raw) or str(message["Message-ID"])
        finally:
            client.close()

    @staticmethod
    def _deliver(client: GmailClient, raw: str) -> str | None:
        try:
            gmail_id = client.send_message(raw)
        except GmailSendUnconfirmed as exc:
            raise OutboxError(str(exc), is_ambiguous=True) from exc
        except GmailError as exc:
            raise OutboxError(str(exc)) from exc
        try:
            return client.message_id_header(gmail_id)
        except Exception:
            # The message is sent; only the lookup failed. Keep the id we wrote on it.
            logger.warning("sent through Gmail, but could not read back its Message-ID")
            return None


def gmail_outbox(settings: Settings) -> GmailOutbox:
    """Reads the live settings on every send, never a copy taken at startup."""

    def client() -> GmailClient:
        if (
            not settings.gmail_client_id
            or settings.gmail_client_secret is None
            or settings.gmail_refresh_token is None
        ):
            raise OutboxError("Gmail is not connected, so nothing was sent.")
        return GmailClient(
            settings.gmail_client_id,
            settings.gmail_client_secret.get_secret_value(),
            settings.gmail_refresh_token.get_secret_value(),
        )

    return GmailOutbox(client, lambda: settings.gmail_send_configured)
