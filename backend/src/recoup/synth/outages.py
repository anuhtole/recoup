"""Plant public status-page incidents and label the SLA credits they create.

Credits are a share of that month's invoice: the first debit at the vendor in
the affected month.
"""

from datetime import UTC, date, datetime, timedelta

from recoup.domain.merchants import normalize_merchant
from recoup.domain.sources import Incident
from recoup.domain.types import LeakType, Outcome, Transaction
from recoup.synth.builder import CaseKind, LedgerBuilder


def _incident(
    vendor: str, slug: str, title: str, start: datetime, minutes: int, domain: str
) -> Incident:
    return Incident(
        id=f"inc_{slug}",
        vendor_key=normalize_merchant(vendor),
        title=title,
        started_at=start,
        ended_at=start + timedelta(minutes=minutes),
        status_url=f"https://status.{domain}/incidents/{slug}",
    )


def _at(day: date, hour: int, minute: int = 0) -> datetime:
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=UTC)


def plant_outages(b: LedgerBuilder, subs: dict[tuple[str, date], Transaction]) -> list[Incident]:
    aws = [
        _incident(
            "AMAZON WEB SERVICES",
            "aws-2026-08-11a",
            "Elevated error rates for EC2 instances in us-west-2",
            _at(date(2026, 8, 11), 16, 5),
            130,
            "aws.amazon.com",
        ),
        # Overlaps the first incident by 20 minutes; downtime is counted once.
        _incident(
            "AMAZON WEB SERVICES",
            "aws-2026-08-11b",
            "Increased API latency for load balancers in us-west-2",
            _at(date(2026, 8, 11), 17, 55),
            80,
            "aws.amazon.com",
        ),
    ]
    slack = [
        _incident(
            "SLACK TECHNOLOGIES",
            "slack-2026-09-09",
            "Messages failing to send for all workspaces",
            _at(date(2026, 9, 9), 14, 30),
            250,
            "slack.com",
        )
    ]
    zoom = [
        _incident(
            "ZOOM.US",
            "zoom-2026-05-12",
            "Users unable to join meetings",
            _at(date(2026, 5, 12), 15, 0),
            240,
            "zoom.us",
        )
    ]
    github = [
        _incident(
            "GITHUB",
            "github-2026-09-18",
            "Degraded performance for Actions",
            _at(date(2026, 9, 18), 9, 40),
            25,
            "githubstatus.com",
        )
    ]
    notion = [
        _incident(
            "NOTION LABS",
            "notion-2026-06-23",
            "Pages failing to load",
            _at(date(2026, 6, 23), 18, 0),
            180,
            "notion-status.com",
        )
    ]

    def sla_case(
        case_id: str,
        merchant: str,
        month: date,
        incidents: list[Incident],
        credit_minor: int,
        outcome: Outcome | None,
        description: str,
    ) -> None:
        kind: CaseKind = "positive" if outcome else "hard_negative"
        b.case(
            case_id,
            kind,
            [subs[(merchant, month)]],
            description,
            outcome,
            leak_type=LeakType.SLA_CREDIT,
            source_refs=[i.id for i in incidents],
            amount_minor=credit_minor,
        )

    aug_aws = subs[("AWS", date(2026, 8, 1))]
    sla_case(
        "sla-001",
        "AWS",
        date(2026, 8, 1),
        aws,
        (aug_aws.amount_minor * 10 + 50) // 100,
        Outcome.RECOVERABLE,
        "AWS fell below 99.9% in August; a 10% credit is claimable.",
    )
    sla_case(
        "sla-002",
        "SLACK TECHNOLOGIES",
        date(2026, 9, 1),
        slack,
        10_938,
        Outcome.RECOVERABLE,
        "Slack fell below 99.5% in September; a 25% credit is claimable.",
    )
    sla_case(
        "sla-003",
        "ZOOM.US",
        date(2026, 5, 1),
        zoom,
        3_748,
        Outcome.NOT_RECOVERABLE,
        "Zoom owed a 25% credit for May, but the claim window closed.",
    )
    sla_case(
        "slan-001",
        "GITHUB",
        date(2026, 9, 1),
        github,
        0,
        None,
        "GitHub had a short incident but stayed above its 99.9% commitment.",
    )
    sla_case(
        "slan-002",
        "NOTION LABS",
        date(2026, 6, 1),
        notion,
        0,
        None,
        "Notion had an outage, but the Plus plan has no uptime commitment.",
    )
    return [*aws, *slack, *zoom, *github, *notion]
