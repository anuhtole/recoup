"""Sending an approved request through Gmail, against a mock transport."""

import base64
import json
from email import message_from_bytes
from email.message import Message
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy.orm import Session, sessionmaker

from recoup.api.app import create_app
from recoup.config import Settings
from recoup.db.models import DraftRow
from recoup.ingest.gmail import SCOPE, SEND_SCOPE, GmailClient, consent_scopes
from recoup.ingest.google_oauth import authorization_url, new_pkce
from recoup.ingest.sources import Sources
from recoup.recovery.gmail_outbox import GmailOutbox
from recoup.recovery.outbox import LocalOutbox, OutboxError
from recoup.services import Services, build_services
from tests.conftest import load_and_run

STORED_ID = "<CAF123@mail.gmail.com>"


class FakeGmailSend:
    def __init__(self, send_status: int = 200, stored_id: str | None = STORED_ID) -> None:
        self.send_status, self.stored_id = send_status, stored_id
        self.sent: list[Message] = []
        self.posts = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.url.host == "oauth2.googleapis.com":
            return httpx.Response(200, json={"access_token": "tok"})
        if request.url.path.endswith("/messages/send"):
            self.posts += 1
            if self.send_status != 200:
                return httpx.Response(self.send_status, json={})
            raw = json.loads(request.content)["raw"]
            self.sent.append(message_from_bytes(base64.urlsafe_b64decode(raw)))
            return httpx.Response(200, json={"id": "abc123", "threadId": "t1"})
        headers = [{"name": "Message-ID", "value": self.stored_id}] if self.stored_id else []
        body: dict[str, Any] = {
            "id": "abc123",
            "threadId": "t1",
            "internalDate": "1",
            "payload": {"headers": headers},
        }
        return httpx.Response(200, json=body)

    def client(self) -> GmailClient:
        http = httpx.Client(transport=httpx.MockTransport(self))
        return GmailClient("id", "shhh", "refresh-shhh", http=http, sleep=lambda _: None)

    def outbox(self) -> GmailOutbox:
        return GmailOutbox(self.client)


def _draft(**changes: Any) -> DraftRow:
    fields: dict[str, Any] = {
        "id": 7,
        "finding_id": 3,
        "channel": "vendor_email",
        "to_addr": "billing@figma.com",
        "subject": "Duplicate charge for INV-1042",
        "body": "We were charged $540.00 twice.\n\nThanks,\nNorthwind Labs Finance",
        "drafter": "template",
        "status": "sending",
    }
    return DraftRow(**{**fields, **changes})


def test_an_approved_request_goes_to_the_directory_address_through_gmail() -> None:
    fake = FakeGmailSend()

    message_id = fake.outbox().send(_draft())

    [sent] = fake.sent
    assert (sent["To"], sent["Subject"]) == ("billing@figma.com", "Duplicate charge for INV-1042")
    assert "charged $540.00 twice" in sent.get_payload()
    assert sent["Cc"] is None and sent["Bcc"] is None
    assert message_id == STORED_ID


def test_the_local_message_id_is_kept_when_gmail_does_not_report_one() -> None:
    fake = FakeGmailSend(stored_id=None)

    message_id = fake.outbox().send(_draft())

    assert message_id == fake.sent[0]["Message-ID"]
    assert message_id.startswith("<recoup-draft-7.finding-3@")


@pytest.mark.parametrize(("status", "is_ambiguous"), [(500, True), (503, True), (429, False)])
def test_a_failed_send_is_never_retried(status: int, is_ambiguous: bool) -> None:
    fake = FakeGmailSend(send_status=status)

    with pytest.raises(OutboxError) as failure:
        fake.outbox().send(_draft())

    assert fake.posts == 1
    assert failure.value.is_ambiguous is is_ambiguous
    assert ("Sent folder" in str(failure.value)) is is_ambiguous


def test_a_sent_message_survives_a_broken_lookup_of_its_id() -> None:
    fake = FakeGmailSend()

    def break_lookup(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, content=b"not json")
        return fake(request)

    http = httpx.Client(transport=httpx.MockTransport(break_lookup))
    client = GmailClient("id", "shhh", "refresh-shhh", http=http, sleep=lambda _: None)

    message_id = GmailOutbox(lambda: client).send(_draft())

    assert len(fake.sent) == 1 and message_id.startswith("<recoup-draft-7.finding-3@")


def test_a_refused_send_says_how_to_turn_sending_on() -> None:
    fake = FakeGmailSend(send_status=403)

    with pytest.raises(OutboxError, match="RECOUP_GMAIL_SEND"):
        fake.outbox().send(_draft())


@pytest.mark.parametrize(
    "changes",
    [
        {"subject": "Refund\r\nBcc: attacker@evil.example"},
        {"to_addr": "billing@figma.com\nBcc: attacker@evil.example"},
        {"to_addr": "billing@figma.com, attacker@evil.example"},
        {"to_addr": "not an address"},
    ],
)
def test_headers_cannot_be_smuggled_through_a_draft(changes: dict[str, str]) -> None:
    fake = FakeGmailSend()

    with pytest.raises(OutboxError):
        fake.outbox().send(_draft(**changes))

    assert fake.posts == 0


def test_card_disputes_stay_in_the_local_outbox() -> None:
    fake = FakeGmailSend()

    message_id = fake.outbox().send(
        _draft(channel="card_dispute", to_addr="disputes@issuer.example")
    )

    assert fake.posts == 0
    assert message_id.startswith("<recoup-draft-7.finding-3@")


def test_the_send_scope_is_requested_only_when_sending_is_turned_on() -> None:
    def scope(can_send: bool) -> list[str]:
        url = authorization_url(
            "cid", "http://127.0.0.1/cb", "st", new_pkce(), consent_scopes(can_send)
        )
        return parse_qs(urlsplit(url).query)["scope"][0].split(" ")

    assert scope(False) == [SCOPE]
    assert scope(True) == [SCOPE, SEND_SCOPE]


def test_services_send_through_gmail_only_when_asked_and_connected(settings: Settings) -> None:
    connected = {
        "gmail_client_id": "id",
        "gmail_client_secret": SecretStr("shhh"),
        "gmail_refresh_token": SecretStr("refresh-shhh"),
    }

    default = build_services(settings.model_copy(update=connected))
    sending = build_services(settings.model_copy(update={**connected, "gmail_send": True}))

    assert isinstance(default.outbox, LocalOutbox)
    assert isinstance(sending.outbox, GmailOutbox)


def test_a_mailbox_connected_after_startup_is_used_for_the_next_send(settings: Settings) -> None:
    live = settings.model_copy(update={"gmail_send": True})
    fake = FakeGmailSend()

    def client() -> GmailClient:
        http = httpx.Client(transport=httpx.MockTransport(fake))
        return GmailClient("id", "shhh", "refresh-shhh", http=http, sleep=lambda _: None)

    outbox = GmailOutbox(client, lambda: live.gmail_send_configured)

    before = outbox.send(_draft())
    live.gmail_client_id, live.gmail_client_secret = "id", SecretStr("shhh")
    live.gmail_refresh_token = SecretStr("refresh-shhh")
    after = outbox.send(_draft())

    assert before.startswith("<recoup-draft-7.finding-3@northwind.example")
    assert (len(fake.sent), after) == (1, STORED_ID)


def test_an_unconfirmed_send_is_never_offered_for_sending_again(
    session_factory: sessionmaker[Session], settings: Settings, services: Services, sources: Sources
) -> None:
    load_and_run(session_factory, settings, services, sources)
    failing = FakeGmailSend(send_status=503)
    with_gmail = Services(
        extractor=services.extractor,
        classifier=services.classifier,
        drafter=services.drafter,
        outbox=failing.outbox(),
    )
    with TestClient(create_app(settings, with_gmail)) as client:
        todo = client.get("/api/findings", params={"stage": "todo"}).json()
        case = next(f for f in todo if f["next_action"]["kind"] == "draft")
        draft = client.post(f"/api/findings/{case['id']}/draft").json()
        is_vendor_email = draft["channel"] == "vendor_email"

        response = client.post(f"/api/drafts/{draft['id']}/send", json={"confirm": True})
        again = client.post(f"/api/drafts/{draft['id']}/send", json={"confirm": True})
        after = client.get(f"/api/findings/{case['id']}").json()
        redraft = client.post(f"/api/findings/{case['id']}/draft").json()

    assert is_vendor_email
    assert response.status_code == 502 and "Sent folder" in response.json()["detail"]
    assert again.status_code == 409 and "may already have gone out" in again.json()["detail"]
    assert failing.posts == 1
    assert after["status"] == "drafted"
    assert redraft["id"] != draft["id"] and redraft["status"] == "draft"


def test_a_send_gmail_refused_can_be_approved_again(
    session_factory: sessionmaker[Session], settings: Settings, services: Services, sources: Sources
) -> None:
    load_and_run(session_factory, settings, services, sources)
    refusing = FakeGmailSend(send_status=403)
    with_gmail = Services(
        extractor=services.extractor,
        classifier=services.classifier,
        drafter=services.drafter,
        outbox=refusing.outbox(),
    )
    with TestClient(create_app(settings, with_gmail)) as client:
        todo = client.get("/api/findings", params={"stage": "todo"}).json()
        case = next(f for f in todo if f["next_action"]["kind"] == "draft")
        draft = client.post(f"/api/findings/{case['id']}/draft").json()

        first = client.post(f"/api/drafts/{draft['id']}/send", json={"confirm": True})
        second = client.post(f"/api/drafts/{draft['id']}/send", json={"confirm": True})

    assert (first.status_code, second.status_code) == (502, 502)
    assert refusing.posts == 2
