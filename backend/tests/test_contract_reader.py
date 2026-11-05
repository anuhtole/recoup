import sys
from datetime import date
from pathlib import Path
from typing import Any

import pytest

from recoup import cli
from recoup.config import get_settings
from recoup.domain.sources import SlaTier
from recoup.extract.claude import ClaudeStructured, LlmError
from recoup.extract.contract_gate import validate_contract
from recoup.extract.contract_reader import (
    ClaudeContractReader,
    ContractReadError,
    document_text,
    read_contract,
    save_contract,
)
from recoup.extract.schema import ContractReading, ExtractedTier
from recoup.synth.documents import SAMPLE_ORDER_FORM, write_text_pdf
from tests.factories import directory

SLA_CLAUSE = "Linear will make the Services available 99.9% of the time in each month."
PRICE_CLAUSE = "The subscription fee is $160.00 per month"


def _reading(**changes: Any) -> ContractReading:
    fields: dict[str, Any] = {
        "vendor_name": "Linear Orbit, Inc.",
        "plan": "Business",
        "uptime_commitment_pct": "99.9",
        "sla_clause": SLA_CLAUSE,
        "credit_tiers": [
            ExtractedTier(below_uptime_pct="99.9", credit_pct=10),
            ExtractedTier(below_uptime_pct="99.0", credit_pct=25),
        ],
        "claim_window_days": 30,
        "measurement_period": "month",
        "covered_components": [],
        "price_per_period": "160.00",
        "price_currency": "USD",
        "price_locked_until": "2026-06-30",
        "price_increase_cap_pct": "7",
        "price_clause": PRICE_CLAUSE,
    }
    return ContractReading(**{**fields, **changes})


class _FakeLlm(ClaudeStructured):
    def __init__(self, reading: ContractReading | None) -> None:
        super().__init__(client=None, model="claude-test")  # type: ignore[arg-type]
        self._reading = reading
        self.prompts: list[str] = []

    def parse(self, system: str, user: str, schema: type[Any]) -> Any:
        self.prompts.append(user)
        if self._reading is None:
            raise LlmError("model stopped with refusal")
        return self._reading


@pytest.fixture
def order_form(tmp_path: Path) -> Path:
    path = tmp_path / "linear-business-order-form.pdf"
    write_text_pdf(path, SAMPLE_ORDER_FORM)
    return path


def _text(order_form: Path) -> str:
    return document_text(order_form)


def test_reads_sla_and_price_terms_from_the_pdf(order_form: Path) -> None:
    llm = _FakeLlm(_reading())

    verdict = read_contract(ClaudeContractReader(llm), order_form, directory())

    contract = verdict.contract
    assert contract is not None and verdict.problems == ()
    assert contract.vendor_key == "LINEAR APP"
    assert contract.document == order_form.name
    assert contract.sla_target_bp == 9_990
    assert contract.tiers == (
        SlaTier(below_bp=9_990, credit_pct=10),
        SlaTier(below_bp=9_900, credit_pct=25),
    )
    assert contract.price_minor == 16_000
    assert contract.price_locked_until == date(2026, 6, 30)
    assert contract.price_increase_cap_bp == 700
    assert "$160.00 per month" in llm.prompts[0]


def test_unknown_or_ambiguous_vendor_is_rejected(order_form: Path) -> None:
    for name in ("Acme Billing Co", "Atlassian", ""):
        verdict = validate_contract(_reading(vendor_name=name), _text(order_form), directory(), "x")
        assert verdict.contract is None


def test_clause_not_in_document_drops_only_that_term(order_form: Path) -> None:
    reading = _reading(sla_clause="Linear guarantees 99.9% uptime with generous credits.")

    verdict = validate_contract(reading, _text(order_form), directory(), "x")

    assert verdict.contract is not None
    assert verdict.contract.sla_target_bp is None and verdict.contract.price_minor == 16_000
    assert any("SLA" in p for p in verdict.problems)


def test_numbers_must_be_written_where_claimed(order_form: Path) -> None:
    text = _text(order_form)
    inflated = validate_contract(_reading(price_per_period="1600.00"), text, directory(), "x")
    low_target = validate_contract(_reading(uptime_commitment_pct="90"), text, directory(), "x")
    big_credit = _reading(credit_tiers=[ExtractedTier(below_uptime_pct="99.9", credit_pct=100)])

    assert inflated.contract is not None and inflated.contract.price_minor is None
    assert low_target.contract is not None and low_target.contract.sla_target_bp is None
    contract = validate_contract(big_credit, text, directory(), "x").contract
    assert contract is not None and contract.sla_target_bp is None


def test_tiers_must_grow_as_uptime_falls(order_form: Path) -> None:
    backwards = [
        ExtractedTier(below_uptime_pct="99.9", credit_pct=25),
        ExtractedTier(below_uptime_pct="99.0", credit_pct=10),
    ]

    verdict = validate_contract(
        _reading(credit_tiers=backwards), _text(order_form), directory(), "x"
    )

    assert verdict.contract is not None and verdict.contract.tiers == ()
    assert any("grow" in p for p in verdict.problems)


def test_unwritten_lock_date_and_cap_are_dropped(order_form: Path) -> None:
    reading = _reading(price_locked_until="2027-12-31", price_increase_cap_pct="3")

    verdict = validate_contract(reading, _text(order_form), directory(), "x")

    assert verdict.contract is not None
    assert verdict.contract.price_locked_until is None
    assert verdict.contract.price_increase_cap_bp is None
    assert len(verdict.problems) == 2


def test_nothing_verified_means_no_contract(order_form: Path) -> None:
    reading = _reading(uptime_commitment_pct=None, price_per_period=None)

    verdict = validate_contract(reading, _text(order_form), directory(), "x")

    assert verdict.contract is None
    assert "no SLA or price term" in verdict.problems[-1]


def test_unreadable_documents_are_refused(tmp_path: Path) -> None:
    blank = tmp_path / "scan.pdf"
    write_text_pdf(blank, [])
    broken = tmp_path / "broken.pdf"
    broken.write_bytes(b"not a pdf")
    other = tmp_path / "contract.docx"
    other.write_text("x")

    for path in (blank, broken, other):
        with pytest.raises(ContractReadError):
            document_text(path)


def test_model_refusal_propagates(order_form: Path) -> None:
    with pytest.raises(LlmError):
        read_contract(ClaudeContractReader(_FakeLlm(None)), order_form, directory())


def test_save_adds_then_replaces_by_vendor_and_plan(order_form: Path, tmp_path: Path) -> None:
    contract = validate_contract(_reading(), _text(order_form), directory(), "x").contract
    assert contract is not None
    contracts_file = tmp_path / "contracts.json"

    assert save_contract(contracts_file, contract) is False
    assert save_contract(contracts_file, contract.model_copy(update={"price_minor": 1})) is True

    assert contracts_file.read_text().count('"LINEAR APP"') == 1


def test_cli_needs_an_api_key(
    order_form: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(sys, "argv", ["recoup", "contracts", "read", str(order_form)])
    get_settings.cache_clear()
    try:
        with pytest.raises(SystemExit, match="ANTHROPIC_API_KEY"):
            cli.main()
    finally:
        get_settings.cache_clear()
