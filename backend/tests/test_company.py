"""Setting Recoup up for a company that brings only its own data."""

from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from recoup.api.app import create_app
from recoup.config import Settings
from recoup.db.session import session_scope
from recoup.domain.sources import Email, email_key
from recoup.ingest.sources import ingest_emails
from recoup.services import Services

LEDGER = """Date,Merchant,Amount,Card Last 4
2026-09-02,FIGMA INC,45.00,4242
2026-09-03,FIGMA INC,45.00,4242
2026-09-10,LINEAR APP,96.00,4242
2026-10-02,FIGMA INC,45.00,4242
"""
FIGMA = {"name": "Figma", "support_email": "billing@figma.com", "domains": ["figma.com"]}


@pytest.fixture
def fresh(
    engine: Engine, database_url: str, tmp_path: Path, services: Services
) -> Iterator[TestClient]:
    data_dir = tmp_path / "company"
    data_dir.mkdir()
    settings = Settings(database_url=database_url, data_dir=data_dir, demo_mode=False, llm="off")
    with TestClient(create_app(settings, services)) as client:
        yield client


def _steps(client: TestClient) -> dict[str, bool]:
    return {s["key"]: s["done"] for s in client.get("/api/setup").json()["steps"]}


def _import(client: TestClient, text: str = LEDGER) -> dict[str, Any]:
    response = client.post("/api/ledger/import", json={"filename": "amex.csv", "text": text})
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def test_a_new_company_starts_with_nothing_done(fresh: TestClient) -> None:
    setup = fresh.get("/api/setup").json()

    assert setup["data_mode"] == "live"
    assert not any(_steps(fresh).values())
    assert setup["counts"] == {"transactions": 0, "emails": 0, "vendors": 0, "contracts": 0}


def test_company_profile_is_validated_and_signs_drafts(fresh: TestClient) -> None:
    bad = fresh.put("/api/company", json={"name": "Acme", "card_dispute_address": "nope"})
    assert bad.status_code == 422

    saved = fresh.put(
        "/api/company", json={"name": " Acme  Corp ", "card_dispute_address": "AP@acme.io"}
    )
    assert saved.json() == {
        "name": "Acme Corp",
        "card_dispute_address": "ap@acme.io",
        "is_set": True,
    }
    assert _steps(fresh)["company"]

    _import(fresh)
    fresh.put("/api/vendors/FIGMA INC", json=FIGMA)
    duplicate = next(
        f for f in fresh.get("/api/findings").json() if f["leak_type"] == "duplicate_charge"
    )
    draft = fresh.post(f"/api/findings/{duplicate['id']}/draft").json()
    assert draft["body"].rstrip().endswith("Acme Corp Finance")
    assert draft["to_addr"] == "billing@figma.com"


def test_preview_writes_nothing(fresh: TestClient) -> None:
    preview = fresh.post("/api/ledger/preview", json={"text": LEDGER}).json()

    assert preview["rows"] == 4 and preview["charge_sign"] == "positive"
    assert preview["columns"]["merchant"] == "Merchant"
    assert len(preview["sample"]) == 4
    assert fresh.get("/api/setup").json()["counts"]["transactions"] == 0


def test_import_finds_leaks_and_reuploading_adds_nothing(fresh: TestClient) -> None:
    first = _import(fresh)
    again = _import(fresh)

    assert (first["inserted"], first["duplicates"]) == (4, 0)
    assert (again["inserted"], again["duplicates"]) == (0, 4)
    assert first["source"] == "csv"
    assert any(f["leak_type"] == "duplicate_charge" for f in fresh.get("/api/findings").json())
    assert _steps(fresh)["ledger"]
    ledger_run = fresh.get("/api/setup").json()["counts"]
    assert ledger_run["transactions"] == 4


def test_unreadable_upload_is_a_clear_422(fresh: TestClient) -> None:
    response = fresh.post("/api/ledger/import", json={"text": "Date,Amount\n2026-09-01,4\n"})

    assert response.status_code == 422
    assert "merchant" in response.json()["detail"]


def test_vendors_added_in_the_ui_count_immediately(fresh: TestClient) -> None:
    bad = fresh.put("/api/vendors/FIGMA INC", json={**FIGMA, "support_email": "x"})
    assert bad.status_code == 422

    saved = fresh.put("/api/vendors/FIGMA INC", json=FIGMA).json()
    assert saved["key"] == "FIGMA" and saved["origin"] == "user"
    assert [v["key"] for v in fresh.get("/api/vendors").json()] == ["FIGMA"]
    assert _steps(fresh)["vendors"]

    assert fresh.delete("/api/vendors/FIGMA").json() == {"removed": True}
    assert fresh.delete("/api/vendors/FIGMA").status_code == 404
    assert fresh.get("/api/vendors").json() == []


def test_contracts_need_a_vendor_and_replace_by_plan(fresh: TestClient) -> None:
    contract = {"vendor_key": "FIGMA", "plan": "Org", "document": "figma-order.pdf"}
    assert fresh.post("/api/contracts", json=contract).status_code == 422

    fresh.put("/api/vendors/FIGMA INC", json=FIGMA)
    first = fresh.post("/api/contracts", json=contract).json()
    second = fresh.post("/api/contracts", json={**contract, "price_minor": 4_500}).json()

    assert first["id"] == second["id"]
    listed = fresh.get("/api/contracts").json()
    assert [(c["plan"], c["price_minor"], c["origin"]) for c in listed] == [("Org", 4_500, "user")]
    assert fresh.delete(f"/api/contracts/{first['id']}").json() == {"removed": True}
    assert fresh.get("/api/contracts").json() == []


def test_a_stored_vendor_overrides_the_bundled_one(
    engine: Engine, settings: Settings, services: Services
) -> None:
    with TestClient(create_app(settings, services)) as client:
        bundled = client.get("/api/vendors").json()
        target = next(v for v in bundled if v["origin"] == "bundled")
        body = {
            "name": target["name"],
            "support_email": "new@" + target["domains"][0],
            "domains": target["domains"],
        }
        assert client.put(f"/api/vendors/{target['key']}", json=body).status_code == 200

        after = {v["key"]: v for v in client.get("/api/vendors").json()}

    assert len(after) == len(bundled)
    assert after[target["key"]]["support_email"] == body["support_email"]
    assert after[target["key"]]["origin"] == "user"


def test_ledger_merchants_without_a_vendor_are_suggested(
    fresh: TestClient, session_factory: sessionmaker[Session]
) -> None:
    _import(fresh)
    with session_scope(session_factory) as session:
        ingest_emails(session, [_email("billing@figma.com"), _email("news@other.io")])

    suggestions = {s["key"]: s for s in fresh.get("/api/vendors/suggestions").json()}

    assert list(suggestions) == ["FIGMA", "LINEAR APP"]  # most spend first
    assert suggestions["FIGMA"]["charges"] == 3
    assert suggestions["FIGMA"]["domains"] == ["figma.com"]
    assert suggestions["FIGMA"]["senders"] == ["billing@figma.com"]
    assert suggestions["LINEAR APP"]["domains"] == []

    fresh.put("/api/vendors/FIGMA INC", json=FIGMA)
    remaining = [s["key"] for s in fresh.get("/api/vendors/suggestions").json()]
    assert remaining == ["LINEAR APP"]


def test_reading_a_contract_needs_claude(fresh: TestClient) -> None:
    response = fresh.post(
        "/api/contracts/read", json={"filename": "order.pdf", "data_base64": "aGVsbG8="}
    )

    assert response.status_code == 409
    assert "ANTHROPIC_API_KEY" in response.json()["detail"]


def _email(sender: str) -> Email:
    message_id = f"<{sender}>"
    return Email(
        id=email_key(message_id),
        message_id=message_id,
        thread_id=message_id,
        from_addr=sender,
        to_addr="ap@acme.io",
        subject="Your invoice",
        sent_at=datetime(2026, 9, 2, tzinfo=UTC),
        body="Thanks for your payment.",
    )


def test_overlapping_exports_with_different_names_are_not_duplicates(fresh: TestClient) -> None:
    september = "Date,Merchant,Amount\n2026-09-02,NOTION,10.00\n2026-09-20,NOTION,12.00\n"
    overlap = "Date,Merchant,Amount\n2026-09-20,NOTION,12.00\n2026-10-02,NOTION,10.00\n"
    fresh.post("/api/ledger/import", json={"filename": "activity.csv", "text": september})
    again = fresh.post("/api/ledger/import", json={"filename": "activity (1).csv", "text": overlap})

    assert again.json()["inserted"] == 1
    assert fresh.get("/api/setup").json()["counts"]["transactions"] == 3
    assert fresh.get("/api/findings").json() == []


def test_rows_another_source_holds_are_skipped_unless_asked(fresh: TestClient) -> None:
    first = "Date,Merchant,Amount\n2026-09-20,NOTION,12.00\n"
    other = "Date,Merchant,Amount\n2026-09-21,NOTION,12.00\n2026-09-25,LINEAR,8.00\n"
    fresh.post("/api/ledger/import", json={"text": first, "account": "ramp"})
    body = {"text": other, "account": "amex"}

    preview = fresh.post("/api/ledger/preview", json=body).json()
    imported = fresh.post("/api/ledger/import", json=body).json()

    assert preview["on_file_elsewhere"] == 1
    assert (imported["inserted"], imported["skipped_overlaps"]) == (1, 0 + 1)
    forced = fresh.post("/api/ledger/import", json={**body, "include_overlaps": True}).json()
    assert forced["inserted"] == 1


def test_identical_charges_in_one_file_still_count(fresh: TestClient) -> None:
    text = "Date,Merchant,Amount\n2026-09-02,FIGMA INC,45.00\n2026-09-02,FIGMA INC,45.00\n"
    result = fresh.post("/api/ledger/import", json={"text": text}).json()

    assert result["inserted"] == 2
    assert any(f["leak_type"] == "duplicate_charge" for f in fresh.get("/api/findings").json())


def test_vendor_names_with_slashes_and_contracts_by_alias(fresh: TestClient) -> None:
    adobe = {
        "name": "Adobe",
        "support_email": "billing@adobe.com",
        "domains": ["adobe.com"],
        "aliases": ["ADOBE INC", "123"],
    }
    saved = fresh.put("/api/vendors/ADOBE/CREATIVE CLOUD", json=adobe)
    assert saved.status_code == 200, saved.text
    assert "" not in saved.json()["aliases"]

    contract = {"vendor_key": "ADOBE INC", "plan": "Teams", "document": "adobe.pdf"}
    response = fresh.post("/api/contracts", json=contract)
    assert response.status_code == 200, response.text
    assert response.json()["vendor_key"] == saved.json()["key"]
