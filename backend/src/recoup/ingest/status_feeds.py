"""Vendors whose public status feed and published SLA Recoup can read.

Only vendors with a published numeric SLA belong here. Terms are from each vendor's
public SLA page and may differ from a customer's order form, so a person still
reviews every claim. Slack is absent because its public SLA states no uptime number.

GitHub Actions and Packages are left out on purpose: GitHub measures those by failed
executions and error rates, which a status page cannot show.
"""

from dataclasses import dataclass

from recoup.domain.merchants import normalize_merchant
from recoup.domain.sources import Contract, SlaTier


@dataclass(frozen=True, slots=True)
class StatusFeed:
    key: str
    page_url: str
    contract: Contract

    @property
    def url(self) -> str:
        return f"{self.page_url}/api/v2/incidents.json"


def _atlassian_premium(descriptor: str, product: str, components: tuple[str, ...]) -> Contract:
    return Contract(
        vendor_key=normalize_merchant(descriptor),
        plan="Premium (published terms)",
        document="https://www.atlassian.com/legal/sla",
        sla_target_bp=9_990,
        tiers=(
            SlaTier(below_bp=9_990, credit_pct=10),
            SlaTier(below_bp=9_900, credit_pct=25),
            SlaTier(below_bp=9_500, credit_pct=50),
        ),
        claim_window_days=15,
        clause=(
            f"Atlassian's published SLA for {product} Premium commits to 99.9% monthly uptime. "
            "Credits are 10% of the product's monthly fees below 99.9%, 25% below 99.0%, and "
            "50% below 95.0%. Claims are due within 15 days after the end of the month."
        ),
        period="month",
        covered_components=components,
        needs_customer_confirmation=True,
    )


FEEDS: tuple[StatusFeed, ...] = (
    StatusFeed(
        key="jira",
        page_url="https://jira-software.status.atlassian.com",
        contract=_atlassian_premium(
            "ATLASSIAN JIRA",
            "Jira",
            ("Viewing content", "Create and edit", "Search"),
        ),
    ),
    StatusFeed(
        key="confluence",
        page_url="https://confluence.status.atlassian.com",
        contract=_atlassian_premium(
            "ATLASSIAN CONFLUENCE",
            "Confluence",
            ("View Content", "Create and Edit", "Search"),
        ),
    ),
    StatusFeed(
        key="github",
        page_url="https://www.githubstatus.com",
        contract=Contract(
            vendor_key=normalize_merchant("GITHUB"),
            plan="Enterprise Cloud (published terms)",
            document="https://github.com/customer-terms/github-online-services-sla",
            sla_target_bp=9_990,
            tiers=(
                SlaTier(below_bp=9_990, credit_pct=5),
                SlaTier(below_bp=9_950, credit_pct=10),
                SlaTier(below_bp=9_900, credit_pct=25),
            ),
            claim_window_days=30,
            clause=(
                "GitHub's published SLA (June 2026) commits to 99.9% quarterly uptime. Credits "
                "are 5% of fees below 99.9%, 10% below 99.5%, and 25% below 99.0%. Claims are "
                "due within 30 days after the end of the quarter."
            ),
            period="quarter",
            covered_components=(
                "Git Operations",
                "Issues",
                "Pull Requests",
                "Webhooks",
                "Pages",
                "API Requests",
            ),
            needs_customer_confirmation=True,
        ),
    ),
)
