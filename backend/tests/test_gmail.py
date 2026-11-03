"""The Gmail connector against Gmail API response shapes, served by a mock transport."""

import base64
import json
import stat
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from recoup.config import Settings
from recoup.db.models import EmailRow, StateRow, SyncRunRow
from recoup.db.session import session_scope
from recoup.domain.vendors import VendorDirectory
from recoup.ingest.gmail import (
    SCOPE,
    GmailClient,
    GmailError,
    GmailMessage,
    is_authenticated,
    message_text,
    to_email,
    vendor_query,
)
from recoup.ingest.google_oauth import (
    REFRESH_TOKEN_VAR,
    authorization_url,
    connect_gmail,
    new_pkce,
    write_env_var,
)
from recoup.ingest.live import GMAIL_CURSOR, GmailSync, sync_gmail
from recoup.ingest.sources import Sources
from recoup.synth.vendors import VENDORS

DIRECTORY = VendorDirectory(VENDORS)
GMAIL_PASS = (
    "mx.google.com; dkim=pass header.i=@figma.com header.s=s1 header.b=abc; "
    "spf=pass smtp.mailfrom=billing@figma.com; dmarc=pass (p=REJECT) header.from=figma.com"
)


def b64(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode()).decode().rstrip("=")


def gmail_message(
    id_: str = "m1",
    *,
    sender: str = "Figma Billing <billing@figma.com>",
    auth: list[str] | None = None,
    body: str = "We will issue a credit of $120.00 to your account within 10 days.",
    message_id: str | None = "<credit-1@figma.com>",
    parts: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    headers = [
        *({"name": "Authentication-Results", "value": a} for a in (auth or [GMAIL_PASS])),
        {"name": "From", "value": sender},
        {"name": "To", "value": "Dana <ap@northwind.example>"},
        {"name": "Subject", "value": "Re: duplicate charge"},
        {"name": "In-Reply-To", "value": "<case-7@recoup.example>"},
    ]
    if message_id is not None:
        headers.append({"name": "Message-ID", "value": message_id})
    default_parts = [
        {"mimeType": "text/plain", "body": {"data": b64(body)}},
        {"mimeType": "text/html", "body": {"data": b64(f"<p>{body}</p>")}},
    ]
    payload = {
        "mimeType": "multipart/alternative",
        "headers": headers,
        "parts": default_parts if parts is None else parts,
    }
    return {"id": id_, "threadId": "t1", "internalDate": "1780000000000", "payload": payload}


def parse(raw: dict[str, Any]) -> GmailMessage:
    return GmailMessage.model_validate(raw)


class FakeGmail:
    def __init__(self, messages: list[dict[str, Any]], page_size: int = 100) -> None:
        self.messages = {m["id"]: m for m in messages}
        self.page_size = page_size
        self.requests: list[httpx.Request] = []
        self.responses: list[httpx.Response] = []
        self.tokens = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.responses:
            return self.responses.pop(0)
        if request.url.host == "oauth2.googleapis.com":
            self.tokens += 1
            return httpx.Response(200, json={"access_token": f"tok{self.tokens}"})
        path = request.url.path.removeprefix("/gmail/v1/users/me")
        if path == "/messages":
            ids = list(self.messages)
            start = int(request.url.params.get("pageToken") or 0)
            page = ids[start : start + self.page_size]
            body: dict[str, Any] = {"messages": [{"id": i, "threadId": "t1"} for i in page]}
            if start + self.page_size < len(ids):
                body["nextPageToken"] = str(start + self.page_size)
            return httpx.Response(200, json=body)
        return httpx.Response(200, json=self.messages[path.removeprefix("/messages/")])

    def client(self) -> GmailClient:
        http = httpx.Client(transport=httpx.MockTransport(self))
        return GmailClient("id", "shhh", "refresh-shhh", http=http, sleep=lambda _: None)

    def queries(self) -> list[str]:
        return [str(r.url.params["q"]) for r in self.requests if r.url.path.endswith("/messages")]


@pytest.fixture
def connected(settings: Settings) -> Settings:
    return settings.model_copy(
        update={
            "gmail_client_id": "id",
            "gmail_client_secret": SecretStr("shhh"),
            "gmail_refresh_token": SecretStr("refresh-shhh"),
        }
    )


def sync_with(session: Session, settings: Settings, sources: Sources, fake: FakeGmail) -> GmailSync:
    return sync_gmail(session, settings, sources.vendors, fake.client())


# Sender authentication


def test_gmails_aligned_dmarc_pass_verifies_the_sender() -> None:
    assert is_authenticated([GMAIL_PASS], "figma.com")


def test_dkim_from_a_parent_domain_aligns_with_a_subdomain_sender() -> None:
    result = "mx.google.com; dkim=pass header.d=figma.com; dmarc=fail header.from=mail.figma.com"
    assert is_authenticated([result], "mail.figma.com")


def test_a_pass_for_some_other_domain_does_not_count() -> None:
    # A bulk sender signing as itself proves nothing about the From line.
    result = "mx.google.com; dkim=pass header.d=sendgrid.net; dmarc=fail header.from=figma.com"
    assert not is_authenticated([result], "figma.com")


def test_a_lookalike_domain_does_not_align() -> None:
    result = "mx.google.com; dmarc=pass header.from=evilfigma.com"
    assert not is_authenticated([result], "figma.com")


def test_a_forged_pass_below_gmails_own_verdict_is_ignored() -> None:
    gmail = "mx.google.com; dkim=none; spf=softfail; dmarc=fail header.from=figma.com"
    assert not is_authenticated([gmail, GMAIL_PASS], "figma.com")


def test_only_gmail_can_vouch_for_a_sender() -> None:
    forged = GMAIL_PASS.replace("mx.google.com", "mx.evil.example")
    assert not is_authenticated([forged], "figma.com")
    assert not is_authenticated([], "figma.com")


# Message parsing


def test_maps_a_verified_vendor_message() -> None:
    email, reason = to_email(parse(gmail_message()), DIRECTORY)

    assert reason is None and email is not None
    assert email.from_addr == "billing@figma.com"
    assert email.to_addr == "ap@northwind.example"
    assert email.message_id == "<credit-1@figma.com>"
    assert email.in_reply_to == "<case-7@recoup.example>"
    assert email.thread_id == "gmail:t1"
    assert email.sent_at == datetime.fromtimestamp(1_780_000_000, UTC)
    assert email.body.startswith("We will issue a credit of $120.00")


@pytest.mark.parametrize(
    ("raw", "reason"),
    [
        (gmail_message(sender="Mom <mom@family.example>"), "not_a_vendor"),
        (gmail_message(auth=["mx.google.com; dkim=fail; dmarc=fail"]), "unverified_sender"),
        (gmail_message(message_id=None), "incomplete"),
        (gmail_message(message_id="<" + "x" * 300 + ">"), "incomplete"),
        (gmail_message(sender="undisclosed"), "incomplete"),
        (gmail_message(parts=[]), "no_text"),
    ],
)
def test_skips_what_it_cannot_trust_or_read(raw: dict[str, Any], reason: str) -> None:
    assert to_email(parse(raw), DIRECTORY) == (None, reason)


def test_html_only_mail_is_read_as_text_without_scripts() -> None:
    markup = "<style>p{}</style><p>Credit&nbsp;of <b>$40</b></p><script>alert(1)</script>"
    message = parse(gmail_message(parts=[{"mimeType": "text/html", "body": {"data": b64(markup)}}]))

    assert message_text(message.payload) == "Credit\xa0of $40"


def test_attachments_are_never_read() -> None:
    parts = [
        {"mimeType": "text/plain", "filename": "invoice.txt", "body": {"data": b64("secret")}},
        {"mimeType": "text/plain", "body": {"data": b64("Thanks, refund sent.")}},
    ]
    assert message_text(parse(gmail_message(parts=parts)).payload) == "Thanks, refund sent."


def test_unexpected_ids_are_rejected() -> None:
    with pytest.raises(ValueError):
        parse(gmail_message(id_="../../drafts"))


def test_the_search_asks_only_for_vendor_domains() -> None:
    after = datetime(2026, 5, 1, tzinfo=UTC)
    query = vendor_query(DIRECTORY, after)

    assert query.startswith("from:(") and "figma.com" in query and "notion.so" in query
    assert query.endswith(f"after:{int(after.timestamp())}")


# Sync


def test_sync_stores_verified_vendor_mail_and_resync_is_idempotent(
    session_factory: sessionmaker[Session], connected: Settings, sources: Sources
) -> None:
    fake = FakeGmail([gmail_message("m1"), gmail_message("m2", sender="mom@family.example")])
    with session_scope(session_factory) as session:
        first = sync_with(session, connected, sources, fake)
    with session_scope(session_factory) as session:
        second = sync_with(session, connected, sources, fake)
        stored = session.scalars(select(EmailRow).where(EmailRow.thread_id == "gmail:t1")).all()
        runs = session.scalars(select(SyncRunRow).where(SyncRunRow.source == "gmail")).all()

    assert (first.fetched, first.inserted, first.skipped) == (2, 1, {"not_a_vendor": 1})
    assert (second.inserted, len(stored)) == (0, 1)
    assert [r.ok for r in runs] == [True, True]


def test_the_next_sync_starts_from_the_last_one_with_overlap(
    session_factory: sessionmaker[Session], connected: Settings, sources: Sources
) -> None:
    fake = FakeGmail([gmail_message()])
    with session_scope(session_factory) as session:
        sync_with(session, connected, sources, fake)
    with session_scope(session_factory) as session:
        row = session.get(StateRow, GMAIL_CURSOR)
        assert row is not None
        cursor = datetime.fromisoformat(row.value)
        sync_with(session, connected, sources, fake)

    first, second = (int(q.rsplit("after:", 1)[1]) for q in fake.queries())
    assert datetime.now(UTC) - datetime.fromtimestamp(first, UTC) > timedelta(days=170)
    assert second == int((cursor - timedelta(days=1)).timestamp())


def test_a_truncated_sync_does_not_move_the_cursor(
    session_factory: sessionmaker[Session], connected: Settings, sources: Sources
) -> None:
    capped = connected.model_copy(update={"gmail_max_messages": 2})
    messages = [gmail_message(f"m{i}", message_id=f"<{i}@figma.com>") for i in range(3)]
    fake = FakeGmail(messages, page_size=1)
    with session_scope(session_factory) as session:
        sync = sync_with(session, capped, sources, fake)
        cursor = session.get(StateRow, GMAIL_CURSOR)

    assert (sync.fetched, sync.inserted, sync.is_truncated) == (2, 2, True)
    assert cursor is None


def test_an_expired_access_token_is_refreshed_once(
    session_factory: sessionmaker[Session], connected: Settings, sources: Sources
) -> None:
    fake = FakeGmail([])
    fake.responses = [httpx.Response(200, json={"access_token": "old"}), httpx.Response(401)]
    with session_scope(session_factory) as session:
        sync_with(session, connected, sources, fake)

    assert fake.tokens == 1
    assert fake.requests[-1].headers["Authorization"] == "Bearer tok1"


def test_revoked_access_is_recorded_and_says_how_to_fix_it_without_secrets(
    session_factory: sessionmaker[Session], connected: Settings, sources: Sources
) -> None:
    fake = FakeGmail([])
    fake.responses = [httpx.Response(400, json={"error": "invalid_grant"})]
    with session_scope(session_factory) as session:
        with pytest.raises(GmailError, match="recoup connect gmail") as raised:
            sync_with(session, connected, sources, fake)
        run = session.scalars(select(SyncRunRow)).one()

    assert not run.ok
    assert "shhh" not in json.dumps(run.detail) and "shhh" not in str(raised.value)


def test_a_disabled_api_is_explained() -> None:
    fake = FakeGmail([])
    fake.responses = [httpx.Response(200, json={"access_token": "t"}), httpx.Response(403)]
    with pytest.raises(GmailError, match="Gmail API is enabled"):
        fake.client().list_ids("from:(figma.com)", 10)


def test_a_malformed_message_is_a_sync_error_not_a_crash() -> None:
    fake = FakeGmail([{"id": "m1", "threadId": "t1", "payload": {}}])
    with pytest.raises(GmailError, match="could not read"):
        fake.client().pull("q", 10, DIRECTORY)


def test_unconfigured_gmail_says_what_to_run(
    session_factory: sessionmaker[Session], settings: Settings, sources: Sources
) -> None:
    with (
        session_scope(session_factory) as session,
        pytest.raises(GmailError, match="recoup connect gmail"),
    ):
        sync_gmail(session, settings, sources.vendors)


# Consent


def test_consent_asks_for_read_only_access_with_pkce() -> None:
    pkce = new_pkce()
    url = urlsplit(authorization_url("cid", "http://127.0.0.1:5000/callback", "st", pkce))
    query = {k: v[0] for k, v in parse_qs(url.query).items()}

    assert query["scope"] == SCOPE == "https://www.googleapis.com/auth/gmail.readonly"
    assert query["code_challenge_method"] == "S256"
    assert query["code_challenge"] == pkce.challenge != pkce.verifier
    assert (query["access_type"], query["prompt"], query["state"]) == ("offline", "consent", "st")


def test_saving_the_token_keeps_other_settings_and_locks_the_file(tmp_path: Path) -> None:
    env = tmp_path / ".env"
    env.write_text(f"ANTHROPIC_API_KEY=keep\n{REFRESH_TOKEN_VAR}=old\n")
    write_env_var(env, REFRESH_TOKEN_VAR, "new")

    assert env.read_text() == f"ANTHROPIC_API_KEY=keep\n{REFRESH_TOKEN_VAR}=new\n"
    assert stat.S_IMODE(env.stat().st_mode) == 0o600


def _browser(answer: dict[str, str], *, keep_state: bool = True) -> Any:
    """Stands in for the person approving on Google, which then redirects to the callback."""

    def open_browser(url: str) -> None:
        query = {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}
        params = {"state": query["state"], **answer} if keep_state else answer
        target = f"{query['redirect_uri']}?{httpx.QueryParams(params)}"
        threading.Thread(target=lambda: httpx.get(target, timeout=5), daemon=True).start()

    return open_browser


def _token_endpoint(seen: list[httpx.Request]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"access_token": "a", "refresh_token": "r3fresh"})

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_connect_saves_the_refresh_token_from_the_redirect(tmp_path: Path) -> None:
    env, seen = tmp_path / ".env", list[httpx.Request]()
    browser = _browser({"code": "c0de"})
    connect_gmail(
        "cid", "csecret", env, open_browser=browser, timeout=5, http=_token_endpoint(seen)
    )

    assert env.read_text() == f"{REFRESH_TOKEN_VAR}=r3fresh\n"
    form = parse_qs(seen[0].content.decode())
    assert form["code"] == ["c0de"] and form["grant_type"] == ["authorization_code"]
    assert len(form["code_verifier"][0]) >= 43


def test_connect_rejects_a_redirect_it_did_not_ask_for(tmp_path: Path) -> None:
    env, seen = tmp_path / ".env", list[httpx.Request]()
    browser = _browser({"code": "c0de", "state": "forged"}, keep_state=False)
    with pytest.raises(GmailError, match="did not match"):
        connect_gmail(
            "cid", "csecret", env, open_browser=browser, timeout=5, http=_token_endpoint(seen)
        )

    assert not env.exists() and not seen


def test_connect_reports_a_declined_consent(tmp_path: Path) -> None:
    env = tmp_path / ".env"
    with pytest.raises(GmailError, match="access_denied"):
        connect_gmail(
            "cid", "csecret", env, open_browser=_browser({"error": "access_denied"}), timeout=5
        )

    assert not env.exists()


def test_connect_times_out_cleanly(tmp_path: Path) -> None:
    with pytest.raises(GmailError, match="Timed out"):
        connect_gmail("cid", "csecret", tmp_path / ".env", open_browser=lambda _: None, timeout=0.2)
