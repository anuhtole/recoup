"""The connector against Ramp's published response shapes, served by a mock transport."""

import json
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx
import pytest
from pydantic import SecretStr, TypeAdapter
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from recoup.config import REPO_ROOT, Settings
from recoup.db.models import FindingRow, SyncRunRow, TransactionRow
from recoup.db.session import session_scope
from recoup.domain.sources import Vendor
from recoup.domain.types import LeakType, Outcome
from recoup.ingest.live import sync_ramp
from recoup.ingest.ramp import MAX_ATTEMPTS, RampClient, RampError, RampTransaction, to_transaction
from recoup.ingest.sources import load_sources
from recoup.pipeline.run import run_pipeline
from recoup.services import Services
from recoup.synth.vendors import VENDORS

SINCE = datetime(2026, 4, 1, tzinfo=UTC)
TOKEN_URL = "/developer/v1/token"
BASE = "https://demo-api.ramp.com"


def ramp_txn(id_: str = "t1", value: int = 9_000, **overrides: Any) -> dict[str, Any]:
    # Field names and values follow the example in Ramp's OpenAPI spec.
    return {
        "id": id_,
        "state": "CLEARED",
        "entity_amount": {"currency": "USD", "value": value},
        "merchant_name": "Vanta",
        "merchant_descriptor": "VANTA",
        "settlement_date": "2026-05-03T00:00:00+00:00",
        "accounting_date": "2026-05-03T00:00:00+00:00",
        "user_transaction_time": "2026-04-28T00:00:00+00:00",
        "merchant_data": {"reference": "343165593943"},
        **overrides,
    }


class FakeRamp:
    def __init__(self, pages: list[dict[str, Any]]) -> None:
        self.pages = pages
        self.requests: list[httpx.Request] = []
        self.responses: list[httpx.Response] = []
        self.tokens = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.responses:
            return self.responses.pop(0)
        if request.url.path == TOKEN_URL:
            self.tokens += 1
            return httpx.Response(
                200, json={"access_token": f"tok{self.tokens}", "expires_in": 3600}
            )
        start = request.url.params.get("start")
        return httpx.Response(200, json=self.pages[int(start or 0)])

    def client(self) -> RampClient:
        http = httpx.Client(transport=httpx.MockTransport(self))
        return RampClient("id", "shhh", "sandbox", http=http, sleep=lambda _: None)


def test_maps_a_cleared_charge_in_minor_units() -> None:
    txn, reason = to_transaction(RampTransaction.model_validate(ramp_txn()))

    assert reason is None and txn is not None
    assert (txn.source, txn.external_id, txn.amount_minor, txn.currency) == (
        "ramp",
        "t1",
        9_000,
        "USD",
    )
    assert (txn.merchant, txn.reference) == ("Vanta", "343165593943")
    assert txn.posted_at == datetime(2026, 5, 3, tzinfo=UTC)


def test_a_refund_stays_negative() -> None:
    txn, _ = to_transaction(RampTransaction.model_validate(ramp_txn(value=-9_000)))

    assert txn is not None and not txn.is_debit


@pytest.mark.parametrize(
    ("overrides", "reason"),
    [
        ({"state": "PENDING"}, "not_posted"),
        ({"state": "DECLINED"}, "not_posted"),
        ({"entity_amount": None}, "no_amount"),
        ({"entity_amount": {"currency": "XTS", "value": 5}}, "unsupported_currency"),
        ({"merchant_name": None, "merchant_descriptor": None}, "incomplete"),
    ],
)
def test_transactions_that_never_settled_or_cannot_be_read_are_skipped(
    overrides: dict[str, Any], reason: str
) -> None:
    txn, why = to_transaction(RampTransaction.model_validate(ramp_txn(**overrides)))

    assert txn is None and why == reason


def test_authenticates_with_least_privilege_and_walks_every_page() -> None:
    fake = FakeRamp(
        [
            {
                "data": [ramp_txn("a")],
                "page": {"next": f"{BASE}/developer/v1/transactions?start=1"},
            },
            {"data": [ramp_txn("b"), ramp_txn("c", state="PENDING")], "page": {"next": None}},
        ]
    )
    pull = fake.client().pull(SINCE)

    assert [t.external_id for t in pull.transactions] == ["a", "b"]
    assert pull.skipped == {"not_posted": 1}
    token_request = fake.requests[0]
    assert token_request.url.host == "demo-api.ramp.com"
    assert b"scope=transactions%3Aread" in token_request.content
    assert fake.requests[1].headers["authorization"] == "Bearer tok1"
    assert fake.tokens == 1


def test_never_sends_the_token_to_another_host() -> None:
    fake = FakeRamp([{"data": [], "page": {"next": "https://evil.example/steal"}}])

    with pytest.raises(RampError, match="unexpected host"):
        fake.client().pull(SINCE)
    assert not any(r.url.host == "evil.example" for r in fake.requests)


def test_honours_retry_after_on_a_rate_limit() -> None:
    fake = FakeRamp([{"data": [ramp_txn()], "page": {}}])
    waits: list[float] = []
    fake.responses = [httpx.Response(429, headers={"Retry-After": "7"})]
    http = httpx.Client(transport=httpx.MockTransport(fake))
    client = RampClient("id", "shhh", http=http, sleep=waits.append)

    assert len(client.pull(SINCE).transactions) == 1
    assert waits == [7.0]


def test_gives_up_with_a_clear_message_when_ramp_stays_down() -> None:
    fake = FakeRamp([])
    fake.responses = [httpx.Response(503)] * MAX_ATTEMPTS

    with pytest.raises(RampError, match="kept returning 503"):
        fake.client().pull(SINCE)


def test_an_expired_token_is_refreshed_once() -> None:
    fake = FakeRamp([{"data": [ramp_txn()], "page": {}}])
    client = fake.client()
    client._token = "stale"
    fake.responses = [httpx.Response(401)]

    assert len(client.pull(SINCE).transactions) == 1
    assert fake.tokens == 1


def test_bad_credentials_explain_themselves_without_leaking_the_secret() -> None:
    fake = FakeRamp([])
    fake.responses = [httpx.Response(401, json={"error": "invalid_client"})]

    with pytest.raises(RampError) as error:
        fake.client().pull(SINCE)
    assert "credentials" in str(error.value) and "shhh" not in str(error.value)


def test_missing_scope_is_named() -> None:
    fake = FakeRamp([])
    fake.responses = [
        httpx.Response(200, json={"access_token": "t"}),
        httpx.Response(403),
    ]

    with pytest.raises(RampError, match=r"transactions:read"):
        fake.client().pull(SINCE)


def test_malformed_response_is_a_sync_error_not_a_crash() -> None:
    fake = FakeRamp([{"data": [{"state": "CLEARED"}], "page": {}}])

    with pytest.raises(RampError, match="could not read"):
        fake.client().pull(SINCE)


def _duplicate_pages() -> list[dict[str, Any]]:
    recent = datetime.now(UTC) - timedelta(days=20)
    next_day = (recent + timedelta(days=1)).isoformat()
    charge = {
        "merchant_name": "Figma",
        "merchant_descriptor": "FIGMA",
        "merchant_data": {"reference": "FIG-1"},
    }
    return [
        {
            "data": [
                ramp_txn("d1", 48_000, settlement_date=recent.isoformat(), **charge),
                ramp_txn("d2", 48_000, settlement_date=next_day, **charge),
            ],
            "page": {},
        }
    ]


def test_ramp_ledger_flows_through_detection_and_resync_is_idempotent(
    session_factory: sessionmaker[Session], settings: Settings, services: Services
) -> None:
    configured = settings.model_copy(update={"as_of": date.today()})
    sources = load_sources(REPO_ROOT / "data" / "live")
    with session_scope(session_factory) as session:
        first = sync_ramp_with(session, configured, FakeRamp(_duplicate_pages()))
        second = sync_ramp_with(session, configured, FakeRamp(_duplicate_pages()))
        run_pipeline(session, configured, services, sources)
        again = run_pipeline(session, configured, services, sources)
        finding = session.scalars(select(FindingRow)).one()
        rows = session.scalars(select(TransactionRow)).all()

        assert (first.inserted, second.inserted, len(rows)) == (2, 0, 2)
        assert {r.source for r in rows} == {"ramp"}
        assert (finding.leak_type, finding.outcome) == (
            LeakType.DUPLICATE_CHARGE,
            Outcome.RECOVERABLE,
        )
        assert (finding.merchant, finding.amount_minor) == ("Figma", 48_000)
        assert (again.created, again.updated) == (0, 0)


def sync_ramp_with(session: Session, settings: Settings, fake: FakeRamp) -> Any:
    ready = settings.model_copy(
        update={"ramp_client_id": "id", "ramp_client_secret": SecretStr("shhh")}
    )
    return sync_ramp(session, ready, fake.client())


def test_a_failed_sync_is_recorded_without_the_secret(
    session_factory: sessionmaker[Session], settings: Settings
) -> None:
    fake = FakeRamp([])
    fake.responses = [httpx.Response(401)]
    with session_scope(session_factory) as session:
        with pytest.raises(RampError):
            sync_ramp_with(session, settings, fake)
        run = session.scalars(select(SyncRunRow)).one()

    assert not run.ok and "shhh" not in json.dumps(run.detail)


def test_unconfigured_ramp_says_what_to_set(
    session_factory: sessionmaker[Session], settings: Settings
) -> None:
    with (
        session_scope(session_factory) as session,
        pytest.raises(RampError, match="RECOUP_RAMP_CLIENT_ID"),
    ):
        sync_ramp(session, settings)


def test_live_vendor_directory_matches_the_code() -> None:
    path = REPO_ROOT / "data" / "live" / "vendors.json"
    assert tuple(TypeAdapter(list[Vendor]).validate_json(path.read_bytes())) == VENDORS
