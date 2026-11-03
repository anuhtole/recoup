"""Northwind's vendor directory and contracts.

All of this is synthetic. Contract terms and SLA tiers are illustrative and are
not any real vendor's published terms.
"""

from datetime import date

from recoup.domain.merchants import normalize_merchant
from recoup.domain.sources import Contract, SlaTier, Vendor


def _vendor(
    descriptor: str, name: str, support: str, domains: tuple[str, ...], *aliases: str
) -> Vendor:
    return Vendor(
        key=normalize_merchant(descriptor),
        name=name,
        support_email=support,
        domains=domains,
        aliases=tuple(normalize_merchant(alias) for alias in aliases),
    )


VENDORS: tuple[Vendor, ...] = (
    _vendor("FIGMA", "Figma", "billing@figma.com", ("figma.com",)),
    _vendor("SLACK TECHNOLOGIES", "Slack", "billing@slack.com", ("slack.com",), "SLACK"),
    _vendor("NOTION LABS", "Notion", "team@makenotion.com", ("makenotion.com", "notion.so")),
    _vendor("GITHUB", "GitHub", "billing@github.com", ("github.com",)),
    _vendor("LINEAR APP", "Linear", "billing@linear.app", ("linear.app",)),
    _vendor("ZOOM.US", "Zoom", "billing@zoom.us", ("zoom.us",)),
    _vendor(
        "GOOGLE WORKSPACE", "Google Workspace", "workspace-billing@google.com", ("google.com",)
    ),
    _vendor("WEWORK", "WeWork", "members@wework.com", ("wework.com",)),
    _vendor(
        "AMAZON WEB SERVICES",
        "Amazon Web Services",
        "aws-billing@amazon.com",
        ("amazon.com", "aws.amazon.com"),
        "AWS",
    ),
    _vendor("AMZN Mktp US", "Amazon", "cs-reply@amazon.com", ("amazon.com",), "AMAZON"),
    _vendor("UNITED AIRLINES", "United Airlines", "refunds@united.com", ("united.com",)),
    _vendor(
        "MARRIOTT SF UNION SQ",
        "Marriott Union Square",
        "guest.services@marriott.com",
        ("marriott.com",),
    ),
    _vendor("STAPLES", "Staples", "orders@staples.com", ("staples.com",)),
    _vendor("LOOM", "Loom", "billing@loom.com", ("loom.com",)),
    _vendor("CALENDLY", "Calendly", "support@calendly.com", ("calendly.com",)),
    # Reserved .example addresses: real Atlassian claims go through support.atlassian.com.
    _vendor(
        "ATLASSIAN JIRA",
        "Jira (Atlassian)",
        "jira-sla-claims@atlassian.example",
        ("atlassian.com", "atlassian.example"),
    ),
    _vendor(
        "ATLASSIAN CONFLUENCE",
        "Confluence (Atlassian)",
        "confluence-sla-claims@atlassian.example",
        ("atlassian.com", "atlassian.example"),
    ),
)


def _tiers(*pairs: tuple[int, int]) -> tuple[SlaTier, ...]:
    return tuple(SlaTier(below_bp=below, credit_pct=pct) for below, pct in pairs)


CONTRACTS: tuple[Contract, ...] = (
    Contract(
        vendor_key=normalize_merchant("AMAZON WEB SERVICES"),
        plan="Enterprise Agreement",
        document="aws-enterprise-agreement-2026.pdf",
        sla_target_bp=9_990,
        tiers=_tiers((9_990, 10), (9_900, 30), (9_500, 100)),
        claim_window_days=60,
        clause=(
            "§7.2 If Monthly Uptime falls below 99.9%, Customer is eligible for a Service "
            "Credit of 10% of that month's fees (30% below 99.0%; 100% below 95.0%). "
            "Claims must be submitted within 60 days of the end of the affected month."
        ),
    ),
    Contract(
        vendor_key=normalize_merchant("SLACK TECHNOLOGIES"),
        plan="Business+",
        document="slack-business-plus-order-form.pdf",
        sla_target_bp=9_990,
        tiers=_tiers((9_990, 10), (9_950, 25), (9_900, 50)),
        claim_window_days=30,
        clause=(
            "Schedule B. Uptime commitment of 99.9% per calendar month. Credits: 10% of the "
            "monthly fee below 99.9%, 25% below 99.5%, 50% below 99.0%. Customer must "
            "request credits within 30 days after the end of the month."
        ),
    ),
    Contract(
        vendor_key=normalize_merchant("ZOOM.US"),
        plan="Business",
        document="zoom-business-terms.pdf",
        sla_target_bp=9_990,
        tiers=_tiers((9_990, 10), (9_950, 25)),
        claim_window_days=30,
        clause=(
            "Section 4. Monthly availability target 99.9%. Below target: 10% credit; below "
            "99.5%: 25% credit. Requests must be made within 30 days after month end."
        ),
    ),
    Contract(
        vendor_key=normalize_merchant("GITHUB"),
        plan="Enterprise Cloud",
        document="github-enterprise-cloud-sla.pdf",
        sla_target_bp=9_990,
        tiers=_tiers((9_990, 10), (9_900, 25)),
        claim_window_days=30,
        clause=(
            "Uptime commitment 99.9% per quarter-month. Below commitment: 10% service credit; "
            "below 99.0%: 25%. Claims within 30 days of month end."
        ),
        price_minor=21_000,
        price_clause="Order form: Enterprise Cloud at $210.00 per month for the 12-month term.",
    ),
    Contract(
        vendor_key=normalize_merchant("NOTION LABS"),
        plan="Plus",
        document="notion-plus-terms.pdf",
        clause="The Plus plan carries no uptime commitment or service credits.",
    ),
    Contract(
        vendor_key=normalize_merchant("FIGMA"),
        plan="Organization",
        document="figma-organization-order-form.pdf",
        price_minor=48_000,
        price_locked_until=date(2026, 12, 31),
        price_clause=(
            "§3.1 Fees: $480.00 per month for 8 Organization seats. Fees are fixed through "
            "December 31, 2026 and may not be increased during that period."
        ),
    ),
    Contract(
        vendor_key=normalize_merchant("LINEAR APP"),
        plan="Business",
        document="linear-business-order-form.pdf",
        price_minor=16_000,
        price_locked_until=date(2026, 6, 30),
        price_increase_cap_bp=700,
        price_clause=(
            "Pricing: $160.00 per month through June 30, 2026. After that, Linear may raise "
            "fees by no more than 7% per renewal year."
        ),
    ),
)
