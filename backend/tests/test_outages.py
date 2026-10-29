from datetime import UTC, date, datetime, timedelta

from recoup.detectors.outages import detect_sla_credits
from recoup.domain.sources import Contract, Incident, SlaTier
from recoup.domain.types import FindingCandidate, LeakType, Outcome
from tests.factories import directory, txn

CONTRACT = Contract(
    vendor_key="SLACK TECHNOLOGIES",
    plan="Business+",
    document="slack.pdf",
    sla_target_bp=9_990,
    tiers=(SlaTier(below_bp=9_990, credit_pct=10), SlaTier(below_bp=9_950, credit_pct=25)),
    claim_window_days=30,
    clause="99.9% monthly uptime.",
)
INVOICE = txn("2026-09-05", "SLACK TECHNOLOGIES", 43_750, "SLK-202609")


def _incident(slug: str, start: str, minutes: int) -> Incident:
    started = datetime.fromisoformat(start).replace(tzinfo=UTC)
    return Incident(
        id=f"inc_{slug}",
        vendor_key="SLACK TECHNOLOGIES",
        title="Outage",
        started_at=started,
        ended_at=started + timedelta(minutes=minutes),
        status_url="https://status.slack.com/x",
    )


def _detect(
    incidents: list[Incident], as_of: date = date(2026, 10, 1), contract: Contract = CONTRACT
) -> list[FindingCandidate]:
    return detect_sla_credits([INVOICE], [contract], incidents, directory(), as_of)


def test_breach_prices_the_deepest_tier_of_the_month_invoice() -> None:
    # 250 minutes of a 30-day month is 99.42% uptime: below 99.5%, so 25%.
    [finding] = _detect([_incident("a", "2026-09-09T14:30", 250)])

    assert (finding.leak_type, finding.outcome) == (LeakType.SLA_CREDIT, Outcome.RECOVERABLE)
    assert finding.amount_minor == 10_938
    assert finding.recover_by == date(2026, 10, 30)
    assert [e.kind for e in finding.evidence] == ["contract", "incident", "transaction", "rule"]


def test_overlapping_incidents_count_downtime_once() -> None:
    # 09:00-10:30 and 10:00-11:00 overlap: 120 minutes, not 150. Still only the 10% tier.
    incidents = [_incident("a", "2026-09-09T09:00", 90), _incident("b", "2026-09-09T10:00", 60)]

    [finding] = _detect(incidents)

    assert finding.amount_minor == 4_375
    assert finding.source_refs == ("inc_a", "inc_b")


def test_uptime_above_commitment_owes_nothing() -> None:
    assert _detect([_incident("a", "2026-09-18T09:40", 25)]) == []


def test_closed_claim_window_is_not_recoverable() -> None:
    [finding] = _detect([_incident("a", "2026-09-09T14:30", 250)], as_of=date(2026, 11, 2))

    assert finding.outcome == Outcome.NOT_RECOVERABLE


def test_contract_without_sla_owes_nothing() -> None:
    no_sla = CONTRACT.model_copy(update={"sla_target_bp": None, "tiers": ()})

    assert _detect([_incident("a", "2026-09-09T14:30", 600)], contract=no_sla) == []
