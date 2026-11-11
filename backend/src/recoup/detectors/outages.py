"""Outage credits: the contract promises uptime, the status page shows it was missed.

Per vendor and contract period (month or quarter): merge overlapping incidents,
compute uptime in basis points for each covered component, and take the worst one.
The credit is the deepest SLA tier breached, as a share of the fees in that period
(the first charge at the vendor each month).

- Full outages alone breach the SLA, window open   -> Recoverable
- Breach only if partial outages count             -> Needs review
- Terms and downtime are public, not the customer's -> Needs review
- Claim window closed                              -> Not recoverable, which is still
  worth seeing because it shows the cost of not asking

A period is judged only once it has ended, and only on what was known by `as_of`.
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

DETECTOR_VERSION = "outages/2"
_BP = 10_000


@dataclass(frozen=True, slots=True)
class OutageConfig:
    min_amount_minor: int = 2_500


@dataclass(frozen=True, slots=True)
class PeriodAssessment:
    """What one contract period's downtime adds up to, breach or not."""

    start: date
    end: date
    label: str
    component: str | None
    uptime_bp: int
    credit_pct: int
    # False when the breach depends on partial outages.
    is_confirmed: bool
    incidents: tuple[Incident, ...]


def _period_start(contract: Contract, day: date) -> date:
    if contract.period == "quarter":
        return date(day.year, (day.month - 1) // 3 * 3 + 1, 1)
    return day.replace(day=1)


def _period_end(contract: Contract, start: date) -> date:
    """The first day after the period."""
    months = 3 if contract.period == "quarter" else 1
    index = start.year * 12 + start.month - 1 + months
    return date(index // 12, index % 12 + 1, 1)


def _period_label(contract: Contract, start: date) -> str:
    if contract.period == "quarter":
        return f"Q{(start.month - 1) // 3 + 1} {start.year}"
    return f"{calendar.month_name[start.month]} {start.year}"


def _utc(day: date) -> datetime:
    return datetime(day.year, day.month, day.day, tzinfo=UTC)


def _downtime_minutes(incidents: Sequence[Incident], start: datetime, end: datetime) -> int:
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


def _credit_pct(contract: Contract, uptime_bp: int) -> int:
    return max((t.credit_pct for t in contract.tiers if uptime_bp < t.below_bp), default=0)


def _percent(bp: int) -> str:
    """99.90% reads 99.9%, 100.00% reads 100%: the figure as people write it."""
    return f"{bp / 100:.2f}".rstrip("0").rstrip(".") + "%"


def _uptime_bp(incidents: Sequence[Incident], start: date, end: date) -> int:
    begin, finish = _utc(start), _utc(end)
    total = int((finish - begin).total_seconds() // 60)
    return (total - _downtime_minutes(incidents, begin, finish)) * _BP // total


def _assess_period(
    contract: Contract, incidents: Sequence[Incident], start: date
) -> PeriodAssessment:
    end = _period_end(contract, start)
    by_component: dict[str | None, list[Incident]] = defaultdict(list)
    for incident in incidents:
        by_component[incident.component].append(incident)

    def worst(only_outages: bool) -> tuple[int, str | None]:
        scored = [
            (
                _uptime_bp(
                    [i for i in spans if i.severity == "outage" or not only_outages], start, end
                ),
                component or "",
            )
            for component, spans in by_component.items()
        ]
        uptime_bp, name = min(scored)
        return uptime_bp, name or None

    confirmed_bp, confirmed_component = worst(only_outages=True)
    is_confirmed = _credit_pct(contract, confirmed_bp) > 0
    uptime_bp, component = (
        (confirmed_bp, confirmed_component) if is_confirmed else worst(only_outages=False)
    )
    chosen = by_component[component]
    return PeriodAssessment(
        start=start,
        end=end,
        label=_period_label(contract, start),
        component=component,
        uptime_bp=uptime_bp,
        credit_pct=_credit_pct(contract, uptime_bp),
        is_confirmed=is_confirmed,
        incidents=tuple(i for i in chosen if is_confirmed is False or i.severity == "outage"),
    )


def assess_periods(
    contract: Contract, incidents: Sequence[Incident], as_of: date
) -> list[PeriodAssessment]:
    """Every finished period with downtime, including those inside the commitment."""
    covered = set(contract.covered_components)
    known = [
        i
        for i in incidents
        if i.vendor_key == contract.vendor_key
        and i.ended_at.date() <= as_of
        and (not covered or i.component in covered)
    ]
    starts: set[date] = set()
    for incident in known:
        cursor = _period_start(contract, incident.started_at.date())
        while cursor <= incident.ended_at.date():
            starts.add(cursor)
            cursor = _period_end(contract, cursor)

    assessments = []
    for start in sorted(starts):
        end = _period_end(contract, start)
        if end > as_of:
            continue
        begin, finish = _utc(start), _utc(end)
        in_period = [i for i in known if i.ended_at > begin and i.started_at < finish]
        assessments.append(_assess_period(contract, in_period, start))
    return assessments


def _end_time(incident: Incident) -> str:
    same_day = incident.ended_at.date() == incident.started_at.date()
    return f"{incident.ended_at:%H:%M}" if same_day else f"{incident.ended_at:%Y-%m-%d %H:%M}"


def _outcome(contract: Contract, period: PeriodAssessment, is_open: bool) -> Outcome:
    if not is_open:
        return Outcome.NOT_RECOVERABLE
    if period.is_confirmed and not contract.needs_customer_confirmation:
        return Outcome.RECOVERABLE
    return Outcome.NEEDS_REVIEW


def _reason(
    vendor_name: str,
    contract: Contract,
    period: PeriodAssessment,
    money: str,
    deadline: date,
    is_open: bool,
) -> str:
    uptime = _percent(period.uptime_bp)
    subject = f"{vendor_name} {period.component}" if period.component else vendor_name
    if not is_open:
        if contract.needs_customer_confirmation:
            return (
                f"{vendor_name}'s status page showed {uptime} uptime for {period.label}. On its "
                f"published terms that is a {money} credit, but the claim window closed on "
                f"{human_date(deadline)}."
            )
        return (
            f"{vendor_name} owed a {money} credit for {period.label}, when uptime was {uptime}, "
            f"but the claim window closed on {human_date(deadline)}."
        )
    target = _percent(contract.sla_target_bp or _BP)
    # The deadline has its own home on the case (the rail), so the sentence doesn't repeat it.
    claim = f"The contract owes a {period.credit_pct}% credit, {money}."
    partial = "" if period.is_confirmed else " if partial outages count"
    summary = f"{subject} ran at {uptime} uptime in {period.label}{partial}, under its {target} "
    if contract.needs_customer_confirmation:
        return (
            f"{summary}published commitment. If your site was affected and your order form has "
            f"these terms, that is a {period.credit_pct}% credit, {money}."
        )
    if period.is_confirmed:
        return f"{summary}commitment. {claim}"
    return f"{summary}commitment. Confirm against the contract's definition of downtime. {claim}"


def _finding(
    vendor_name: str,
    contract: Contract,
    period: PeriodAssessment,
    invoices: Sequence[Transaction],
    as_of: date,
) -> FindingCandidate:
    first = invoices[0]
    fees = sum(i.amount_minor for i in invoices)
    credit = (fees * period.credit_pct + 50) // 100
    deadline = period.end - timedelta(days=1) + timedelta(days=contract.claim_window_days)
    is_open = as_of <= deadline
    money = Money(credit, first.currency).format()
    target = _percent(contract.sla_target_bp or _BP)
    incident_evidence = tuple(
        Evidence(
            kind="incident",
            ref=i.id,
            detail=(
                f"{i.title}: {i.started_at:%Y-%m-%d %H:%M} to {_end_time(i)} UTC. {i.status_url}"
            ),
        )
        for i in period.incidents
    )
    invoice_evidence = tuple(
        Evidence(
            kind="transaction",
            ref=i.id,
            detail=f"{i.posted_at.date()} invoice {i.money.format()} "
            f"({i.reference or 'no reference'})",
        )
        for i in invoices
    )
    fee_label = f"{period.label} invoice" if len(invoices) == 1 else f"{period.label} fees"
    return FindingCandidate(
        leak_type=LeakType.SLA_CREDIT,
        outcome=_outcome(contract, period, is_open),
        merchant=first.merchant,
        transaction_ids=tuple(i.id for i in invoices),
        source_refs=tuple(i.id for i in period.incidents),
        amount_minor=credit,
        currency=first.currency,
        reason=_reason(vendor_name, contract, period, money, deadline, is_open),
        evidence=(
            Evidence(kind="contract", ref=contract.document, detail=contract.clause),
            *incident_evidence,
            *invoice_evidence,
            Evidence(
                kind="rule",
                ref=DETECTOR_VERSION,
                detail=f"Uptime {_percent(period.uptime_bp)} vs {target} commitment: "
                f"{period.credit_pct}% of the {fee_label}.",
            ),
        ),
        detector_version=DETECTOR_VERSION,
        recover_by=deadline,
        identity=f"{contract.vendor_key}:{period.start.isoformat()}",
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
            invoices.setdefault(
                (vendor_key(txn, vendors), txn.posted_at.date().replace(day=1)), txn
            )

    findings: list[FindingCandidate] = []
    for contract in contracts:
        if contract.sla_target_bp is None:
            continue
        for period in assess_periods(contract, incidents, as_of):
            if period.credit_pct == 0:
                continue
            billed = [
                invoice
                for (key, month), invoice in invoices.items()
                if key == contract.vendor_key and period.start <= month < period.end
            ]
            if not billed:
                continue
            billed.sort(key=lambda t: t.posted_at)
            vendor = vendors.for_merchant(contract.vendor_key)
            name = vendor.name if vendor else billed[0].merchant
            finding = _finding(name, contract, period, billed, as_of)
            if finding.amount_minor >= config.min_amount_minor:
                findings.append(finding)
    return findings
