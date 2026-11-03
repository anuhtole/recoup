"""Read vendor email from Gmail, read-only.

The only scope requested is gmail.readonly, so nothing here can send, delete, or
label mail. What gets stored is limited twice:

1. The search asks Gmail only for mail from vendor domains in the directory, so
   personal mail is never downloaded.
2. Each message must pass Gmail's own DMARC or DKIM check, aligned with the
   sender's domain. That comes from the topmost Authentication-Results header,
   which Gmail (mx.google.com) adds on delivery. A From line alone is forgeable,
   so a message without that pass is skipped, not stored.

Message text stays untrusted: it goes through the same extraction and validation
as every other email, and recipients still come from the vendor directory only.
"""

import base64
import html
import re
import time
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import getaddresses, parseaddr
from typing import Any

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from recoup.domain.sources import Email, email_key, sender_domain
from recoup.domain.vendors import VendorDirectory
from recoup.ingest.http_retry import send_with_retry

TOKEN_URL = "https://oauth2.googleapis.com/token"
API_URL = "https://gmail.googleapis.com/gmail/v1/users/me"
SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
SOURCE = "gmail"
PAGE_SIZE = 100
MAX_BODY_CHARS = 20_000
MAX_HEADER_CHARS = 255
MAX_SUBJECT_CHARS = 500
GMAIL_AUTHSERV = "mx.google.com"

_SAFE_ID = re.compile(r"^[A-Za-z0-9]{1,64}$")
_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]+")
_SCRIPT = re.compile(r"<(script|style)\b.*?</\1\s*>", re.IGNORECASE | re.DOTALL)
_BREAK = re.compile(r"<\s*(br|/p|/div|/tr|/li)\b[^>]*>", re.IGNORECASE)
_TAG = re.compile(r"<[^>]+>")
_BLANKS = re.compile(r"[ \t]+")
_LINES = re.compile(r"\n\s*\n+")


class GmailError(Exception):
    """A sync failure whose message is safe to show a person: it never contains secrets."""


class _Header(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    value: str


class _Body(BaseModel):
    model_config = ConfigDict(extra="ignore")

    data: str | None = None


class GmailPart(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    mime_type: str = Field(default="", alias="mimeType")
    filename: str = ""
    headers: list[_Header] = []
    body: _Body = _Body()
    parts: list["GmailPart"] = []

    def header(self, name: str) -> str | None:
        values = self.header_values(name)
        return values[0] if values else None

    def header_values(self, name: str) -> list[str]:
        """In message order: the first is the topmost, the one added last on delivery."""
        lowered = name.lower()
        return [h.value for h in self.headers if h.name.lower() == lowered]


class GmailMessage(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    id: str
    thread_id: str = Field(alias="threadId")
    internal_date: int = Field(alias="internalDate")
    payload: GmailPart

    @field_validator("id", "thread_id")
    @classmethod
    def _safe(cls, value: str) -> str:
        if not _SAFE_ID.match(value):
            raise ValueError("unexpected Gmail id")
        return value


def _aligned(signer: str | None, domain: str) -> bool:
    """Relaxed alignment: the signing domain is the sender's domain or a parent of it."""
    return bool(signer) and (domain == signer or domain.endswith(f".{signer}"))


def _property(result: str, name: str) -> str | None:
    match = re.search(rf"\b{re.escape(name)}=@?([a-z0-9.-]+)", result)
    return match.group(1).rstrip(".") if match else None


def is_authenticated(results: Iterable[str], domain: str) -> bool:
    """Gmail's verdict that the message really is from `domain`.

    Only the topmost Authentication-Results header counts, and only when Gmail wrote
    it: anything below it arrived with the message and could be forged.
    """
    topmost = next(iter(results), None)
    if topmost is None:
        return False
    authserv, _, rest = topmost.partition(";")
    if authserv.strip().lower() != GMAIL_AUTHSERV:
        return False
    for result in (r.strip().lower() for r in rest.split(";")):
        if result.startswith("dmarc=pass") and _aligned(_property(result, "header.from"), domain):
            return True
        if result.startswith("dkim=pass") and _aligned(
            _property(result, "header.d") or _property(result, "header.i"), domain
        ):
            return True
    return False


def _decode(data: str) -> str:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode("utf-8", "replace")


def _walk(part: GmailPart) -> Iterator[GmailPart]:
    yield part
    for child in part.parts:
        yield from _walk(child)


def html_to_text(markup: str) -> str:
    text = _BREAK.sub("\n", _SCRIPT.sub("", markup))
    text = html.unescape(_TAG.sub("", text))
    return _LINES.sub("\n\n", _BLANKS.sub(" ", text)).strip()


def message_text(payload: GmailPart) -> str:
    """The plain-text body, or the HTML body as text. Attachments are never read."""
    inline = [p for p in _walk(payload) if not p.filename and p.body.data]
    plain = [_decode(p.body.data or "") for p in inline if p.mime_type == "text/plain"]
    if plain:
        text = "\n".join(plain).strip()
    else:
        text = "\n".join(
            html_to_text(_decode(p.body.data or "")) for p in inline if p.mime_type == "text/html"
        )
    return _CONTROL.sub("", text)[:MAX_BODY_CHARS]


def _clean(value: str | None, limit: int) -> str:
    return _CONTROL.sub(" ", value or "").strip()[:limit]


def to_email(message: GmailMessage, vendors: VendorDirectory) -> tuple[Email | None, str | None]:
    """The domain email, or None and why it was skipped."""
    payload = message.payload
    from_addr = parseaddr(payload.header("From") or "")[1].strip().lower()
    if "@" not in from_addr:
        return None, "incomplete"
    if vendors.for_sender(from_addr) is None:
        return None, "not_a_vendor"
    results = payload.header_values("Authentication-Results")
    if not is_authenticated(results, sender_domain(from_addr)):
        return None, "unverified_sender"
    message_id = _clean(payload.header("Message-ID"), MAX_HEADER_CHARS + 1)
    if not message_id or len(message_id) > MAX_HEADER_CHARS:
        return None, "incomplete"
    body = message_text(payload)
    if not body:
        return None, "no_text"
    recipients = getaddresses([payload.header("To") or ""])
    in_reply_to = _clean(payload.header("In-Reply-To"), MAX_HEADER_CHARS) or None
    return (
        Email(
            id=email_key(message_id),
            message_id=message_id,
            thread_id=f"{SOURCE}:{message.thread_id}",
            in_reply_to=in_reply_to,
            from_addr=from_addr,
            to_addr=_clean(recipients[0][1] if recipients else "", MAX_HEADER_CHARS),
            subject=_clean(payload.header("Subject"), MAX_SUBJECT_CHARS),
            sent_at=datetime.fromtimestamp(message.internal_date / 1000, UTC),
            body=body,
        ),
        None,
    )


def vendor_query(vendors: VendorDirectory, after: datetime) -> str:
    """Gmail search for mail from directory domains only, newer than `after`."""
    domains = sorted({d.lower() for v in vendors for d in v.domains})
    if not domains:
        raise GmailError("The vendor directory has no domains, so there is no mail to read.")
    return f"from:({' OR '.join(domains)}) after:{int(after.timestamp())}"


@dataclass(frozen=True, slots=True)
class GmailPull:
    emails: tuple[Email, ...]
    fetched: int
    skipped: dict[str, int]
    is_truncated: bool


class GmailClient:
    def __init__(
        self,
        client_id: str,
        client_secret: str,
        refresh_token: str,
        *,
        http: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._refresh_token = refresh_token
        self._http = http or httpx.Client(timeout=30.0)
        self._sleep = sleep
        self._token: str | None = None

    def close(self) -> None:
        self._http.close()

    def _send(self, send: Callable[[], httpx.Response]) -> httpx.Response:
        return send_with_retry(send, service="Gmail", fail=GmailError, sleep=self._sleep)

    def _authenticate(self) -> str:
        response = self._send(
            lambda: self._http.post(
                TOKEN_URL,
                data={
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                    "refresh_token": self._refresh_token,
                    "grant_type": "refresh_token",
                },
            )
        )
        if response.status_code in (400, 401):
            raise GmailError(
                "Google refused the saved Gmail access; it may have been revoked or expired. "
                "Run `recoup connect gmail` again."
            )
        if response.status_code != 200:
            raise GmailError(f"Google's token service returned {response.status_code}.")
        token = response.json().get("access_token")
        if not isinstance(token, str) or not token:
            raise GmailError("Google's token response had no access token.")
        return token

    def _get(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        def send() -> httpx.Response:
            self._token = self._token or self._authenticate()
            headers = {"Authorization": f"Bearer {self._token}"}
            return self._http.get(f"{API_URL}{path}", params=params, headers=headers)

        response = self._send(send)
        if response.status_code == 401:
            # An expired access token gets one fresh attempt.
            self._token = None
            response = self._send(send)
        if response.status_code == 403:
            raise GmailError(
                "Gmail refused access (403). Check that the Gmail API is enabled for this "
                "Google Cloud project and that the account granted read access."
            )
        if response.status_code != 200:
            raise GmailError(f"Gmail returned {response.status_code}.")
        body: dict[str, Any] = response.json()
        return body

    def list_ids(self, query: str, limit: int) -> tuple[list[str], bool]:
        """Message ids, newest first, and whether more matched than `limit`."""
        ids: list[str] = []
        page_token: str | None = None
        while len(ids) < limit:
            params: dict[str, Any] = {"q": query, "maxResults": min(PAGE_SIZE, limit - len(ids))}
            if page_token:
                params["pageToken"] = page_token
            body = self._get("/messages", params)
            ids.extend(str(m["id"]) for m in body.get("messages", []))
            page_token = body.get("nextPageToken")
            if not page_token:
                return ids, False
        return ids[:limit], True

    def message(self, message_id: str) -> GmailMessage:
        if not _SAFE_ID.match(message_id):
            raise GmailError("Gmail returned an unexpected message id; stopped the sync.")
        return GmailMessage.model_validate(self._get(f"/messages/{message_id}", {"format": "full"}))

    def pull(self, query: str, limit: int, vendors: VendorDirectory) -> GmailPull:
        emails: list[Email] = []
        skipped: dict[str, int] = {}
        try:
            ids, is_truncated = self.list_ids(query, limit)
            for message_id in ids:
                email, reason = to_email(self.message(message_id), vendors)
                if email is not None:
                    emails.append(email)
                elif reason:
                    skipped[reason] = skipped.get(reason, 0) + 1
        except (ValidationError, ValueError, KeyError) as exc:
            raise GmailError("Gmail returned a message Recoup could not read.") from exc
        return GmailPull(tuple(emails), len(ids), skipped, is_truncated)
