"""Outage credits: the contract promises uptime, the status page shows it was missed.

Per vendor and calendar month: merge overlapping incidents, compute uptime in
basis points, pick the deepest SLA tier breached, and price the credit as that
share of the month's invoice (the first charge at the vendor that month).

Inside the claim window the credit is Recoverable; after it closes it is Not
recoverable, which is still worth seeing because it shows the cost of not asking.
"""

import calendar
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

from recoup.detectors.vendor_keys import vendor_key
from recoup.domain.dates import human_date
from recoup.domain.money import Money
from recoup.domain.sources import Contract, Incident
from recoup.domain.types import Evidence, FindingCandidate, LeakType, Outcome, Transaction
from recoup.domain.vendors import VendorDirectory

DETECTOR_VERSION = "outages/1"
_BP = 10_000


@dataclass(frozen=True, slots=True)
class OutageConfig:
    min_amount_minor: int = 2_500


def _month_bounds(month: date) -> tuple[datetime, datetime]:
    start = datetime(month.year, month.month, 1, tzinfo=UTC)
    days = calendar.monthrange(month.year, month.month)[1]
    return start, start + timedelta(days=days)


def _downtime_minutes(incidents: Sequence[Incident], month: date) -> int:
    start, end = _month_bounds(month)
    spans = sorted(
        (max(i.started_at, start), min(i.ended_at, end))
        for i in incidents
        if i.ended_at > start and i.started_at < end
    )
    total = timedelta()
    current_start, current_end = None, None
    for span_start, span_end in spans:
        if current_end is None or span_start > current_end:
            if current_start is not None and current_end is not None:
                total += current_end - current_start
            current_start, current_end = span_start, span_end
        else:
            current_end = max(current_end, span_end)
    if current_start is not None and current_end is not None:
        total += current_end - current_start
    return int(total.total_seconds() // 60)


def _months_touched(incidents: Sequence[Incident]) -> list[date]:
    months: set[date] = set()
    for incident in incidents:
        cursor = date(incident.started_at.year, incident.started_at.month, 1)
        while cursor <= incident.ended_at.date():
            months.add(cursor)
            cursor = (cursor + timedelta(days=32)).replace(day=1)
    return sorted(months)


def _credit_pct(contract: Contract, uptime_bp: int) -> int:
    return max((t.credit_pct for t in contract.tiers if uptime_bp < t.below_bp), default=0)


def _percent(bp: int) -> str:
    return f"{bp / 100:.2f}%"


def _finding(
    vendor_name: str,
    contract: Contract,
    month: date,
    incidents: Sequence[Incident],
    invoice: Transaction,
    uptime_bp: int,
    pct: int,
    as_of: date,
) -> FindingCandidate:
    credit = (invoice.amount_minor * pct + 50) // 100
    _, month_end = _month_bounds(month)
    deadline = month_end.date() - timedelta(days=1) + timedelta(days=contract.claim_window_days)
    is_open = as_of <= deadline
    money = Money(credit, invoice.currency).format()
    target = _percent(contract.sla_target_bp or _BP)
    label = f"{month:%B %Y}"
    if is_open:
        reason = (
            f"{vendor_name} ran at {_percent(uptime_bp)} uptime in {label}, under its "
            f"{target} commitment. The contract owes a {pct}% credit, {money}; claim by "
            f"{human_date(deadline)}."
        )
    else:
        reason = (
            f"{vendor_name} owed a {money} credit for {label} ({_percent(uptime_bp)} "
            f"uptime), but the claim window closed on {human_date(deadline)}."
        )
    incident_evidence = tuple(
        Evidence(
            kind="incident",
            ref=i.id,
            detail=(
                f"{i.title}: {i.started_at:%Y-%m-%d %H:%M} to {i.ended_at:%H:%M} UTC. "
                f"{i.status_url}"
            ),
        )
        for i in incidents
    )
    return FindingCandidate(
        leak_type=LeakType.SLA_CREDIT,
        outcome=Outcome.RECOVERABLE if is_open else Outcome.NOT_RECOVERABLE,
        merchant=invoice.merchant,
        transaction_ids=(invoice.id,),
        source_refs=tuple(i.id for i in incidents),
        amount_minor=credit,
        currency=invoice.currency,
        reason=reason,
        evidence=(
            Evidence(kind="contract", ref=contract.document, detail=contract.clause),
            *incident_evidence,
            Evidence(
                kind="transaction",
                ref=invoice.id,
                detail=f"{invoice.posted_at.date()} invoice {invoice.money.format()} "
                f"({invoice.reference or 'no reference'})",
            ),
            Evidence(
                kind="rule",
                ref=DETECTOR_VERSION,
                detail=f"Monthly uptime {_percent(uptime_bp)} vs {target} commitment: "
                f"{pct}% of the {label} invoice.",
            ),
        ),
        detector_version=DETECTOR_VERSION,
        recover_by=deadline,
    )


def detect_sla_credits(
    transactions: Sequence[Transaction],
    contracts: Sequence[Contract],
    incidents: Sequence[Incident],
    vendors: VendorDirectory,
    as_of: date,
    config: OutageConfig | None = None,
) -> list[FindingCandidate]:
    config = config or OutageConfig()
    invoices: dict[tuple[str, date], Transaction] = {}
    for txn in sorted(transactions, key=lambda t: (t.posted_at, t.id)):
        if txn.is_debit:
            month = txn.posted_at.date().replace(day=1)
            invoices.setdefault((vendor_key(txn, vendors), month), txn)

    by_vendor: dict[str, list[Incident]] = defaultdict(list)
    for incident in incidents:
        by_vendor[incident.vendor_key].append(incident)

    findings: list[FindingCandidate] = []
    for contract in contracts:
        if contract.sla_target_bp is None:
            continue
        vendor_incidents = by_vendor.get(contract.vendor_key, [])
        for month in _months_touched(vendor_incidents):
            start, end = _month_bounds(month)
            in_month = [i for i in vendor_incidents if i.ended_at > start and i.started_at < end]
            total = int((end - start).total_seconds() // 60)
            uptime_bp = (total - _downtime_minutes(in_month, month)) * _BP // total
            pct = _credit_pct(contract, uptime_bp)
            invoice = invoices.get((contract.vendor_key, month))
            if pct == 0 or invoice is None:
                continue
            vendor = vendors.for_merchant(contract.vendor_key)
            name = vendor.name if vendor else invoice.merchant
            finding = _finding(name, contract, month, in_month, invoice, uptime_bp, pct, as_of)
            if finding.amount_minor >= config.min_amount_minor:
                findings.append(finding)
    return findings
