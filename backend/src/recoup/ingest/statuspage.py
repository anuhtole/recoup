"""Read real downtime from Statuspage-hosted vendor status pages.

The public feed returns recent incidents with a component-by-component timeline.
Each incident becomes spans of downtime per covered component, using the status
the vendor itself published:

- major_outage     -> "outage"
- partial_outage   -> "partial" (never confirms a breach on its own)
- degraded and anything else -> not downtime

Feed text is untrusted: ids are validated, titles are cleaned, and links are built
from our own feed config. Maintenance, unresolved incidents, and incidents with no
component data are skipped, so missing data can only understate what is owed.
"""

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, field_validator

from recoup.domain.sources import Incident
from recoup.ingest.status_feeds import StatusFeed

_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_SLUG = re.compile(r"[^a-z0-9]+")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]+")
_MAX_TITLE_CHARS = 200
_SEVERITY = {"major_outage": "outage", "partial_outage": "partial"}


class _AffectedComponent(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    new_status: str


class _Update(BaseModel):
    model_config = ConfigDict(extra="ignore")

    created_at: datetime
    display_at: datetime | None = None
    affected_components: list[_AffectedComponent] | None = None

    @property
    def at(self) -> datetime:
        return self.display_at or self.created_at


class StatusIncident(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    impact: str
    created_at: datetime
    started_at: datetime | None = None
    resolved_at: datetime | None = None
    scheduled_for: datetime | None = None
    incident_updates: list[_Update] = []

    @field_validator("id")
    @classmethod
    def _safe_id(cls, value: str) -> str:
        if not _SAFE_ID.match(value):
            raise ValueError("unexpected incident id")
        return value


class StatusFeedPage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    incidents: list[StatusIncident]


@dataclass(frozen=True, slots=True)
class ParsedFeed:
    incident_ids: tuple[str, ...]
    spans: tuple[Incident, ...]
    earliest: datetime | None
    skipped_open: int
    skipped_no_components: int


def _clean_title(title: str) -> str:
    return _CONTROL.sub(" ", title).strip()[:_MAX_TITLE_CHARS]


def _component_timeline(
    incident: StatusIncident, resolved_at: datetime
) -> dict[str, list[tuple[datetime, str]]]:
    """Status changes per component, in time order, up to resolution."""
    updates = sorted(incident.incident_updates, key=lambda u: u.at)
    timeline: dict[str, list[tuple[datetime, str]]] = {}
    for update in updates:
        if update.at >= resolved_at:
            continue
        for component in update.affected_components or []:
            timeline.setdefault(component.name, []).append((update.at, component.new_status))
    return timeline


def _spans_for_component(
    feed: StatusFeed,
    incident: StatusIncident,
    component: str,
    changes: Sequence[tuple[datetime, str]],
    resolved_at: datetime,
) -> Iterable[Incident]:
    began = incident.started_at or incident.created_at
    for index, (at, status) in enumerate(changes):
        severity = _SEVERITY.get(status)
        if severity is None:
            continue
        # The first report covers the time since the vendor says the incident began.
        start = began if index == 0 else at
        end = changes[index + 1][0] if index + 1 < len(changes) else resolved_at
        if end <= start:
            continue
        slug = _SLUG.sub("-", component.lower()).strip("-")
        yield Incident(
            id=f"live:{feed.key}:{incident.id}:{slug}:{index}",
            vendor_key=feed.contract.vendor_key,
            title=_clean_title(incident.name),
            started_at=start,
            ended_at=end,
            status_url=f"{feed.page_url}/incidents/{incident.id}",
            component=component,
            severity=severity,
        )


def parse_feed(feed: StatusFeed, payload: dict[str, Any]) -> ParsedFeed:
    """Turn a raw feed into downtime spans for the components the contract covers."""
    page = StatusFeedPage.model_validate(payload)
    covered = set(feed.contract.covered_components)
    spans: list[Incident] = []
    incident_ids: list[str] = []
    skipped_open = skipped_no_components = 0
    for incident in page.incidents:
        if incident.impact == "maintenance" or incident.scheduled_for is not None:
            continue
        if incident.resolved_at is None:
            skipped_open += 1
            continue
        timeline = _component_timeline(incident, incident.resolved_at)
        if not timeline:
            skipped_no_components += 1
            continue
        incident_ids.append(incident.id)
        for component, changes in timeline.items():
            if component in covered:
                spans.extend(
                    _spans_for_component(feed, incident, component, changes, incident.resolved_at)
                )
    earliest = min((i.created_at for i in page.incidents), default=None)
    return ParsedFeed(
        incident_ids=tuple(incident_ids),
        spans=tuple(spans),
        earliest=earliest.astimezone(UTC) if earliest else None,
        skipped_open=skipped_open,
        skipped_no_components=skipped_no_components,
    )
