"""The tools the chat agent may call, and nothing else it can do.

The list is the security boundary. Every tool either reads Recoup's own records or
prepares something for a person: there is no tool that sends, edits, or dismisses.
Sending stays behind `POST /api/drafts/{id}/send`, which needs a person's confirmation.

Tool results are built from Recoup's structured records (ids, amounts, dates, states).
They never carry email, contract, or draft text. The one free-text field is the vendor
name, which can come from a card descriptor, so it is cut down to a short run of
letters, digits and basic punctuation before the model sees it.
"""

import logging
import re
from collections.abc import Callable
from dataclasses import asdict, dataclass
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from recoup.api.schemas import FindingOut
from recoup.api.views import finding_list
from recoup.config import Settings
from recoup.db.models import FindingRow
from recoup.db.state import get_as_of
from recoup.domain.money import Money
from recoup.domain.workflow import Stage
from recoup.ingest.company import get_profile
from recoup.ingest.sources import Sources
from recoup.pipeline.run import run_pipeline
from recoup.recovery.standing import money_standing
from recoup.recovery.workflow import TransitionError, audit, create_draft, open_draft
from recoup.services import Services

AGENT_ACTOR = "agent:chat"
URGENT_WITHIN_DAYS = 14
MAX_VENDOR_CHARS = 40
# Tools that are expensive or change shared state run at most once per chat message.
ONCE_PER_MESSAGE = frozenset({"run_scan"})
logger = logging.getLogger(__name__)
_NOT_NAME = re.compile(r"[^A-Za-z0-9 .,&'-]+")
GMAIL_CONNECT_PATH = "/api/connect/gmail"


@dataclass(frozen=True)
class ToolContext:
    session: Session
    settings: Settings
    services: Services
    sources: Sources
    is_sync_running: Callable[[], bool] = lambda: False


@dataclass(frozen=True, slots=True)
class ToolOutcome:
    ok: bool
    result: dict[str, Any]


class ToolError(Exception):
    """A refusal whose message is safe to show the model and the person."""


class NoInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ListCasesInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    view: Literal["urgent", "todo", "waiting", "done"] = "urgent"
    limit: int = Field(default=10, ge=1, le=25)


class DraftRequestInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    finding_id: int = Field(ge=1)


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    input_model: type[BaseModel]
    run: Callable[[ToolContext, Any], dict[str, Any]]


def _cases(context: ToolContext) -> list[FindingOut]:
    rows = context.session.scalars(select(FindingRow).order_by(FindingRow.id)).all()
    return finding_list(context.session, rows, get_as_of(context.session, context.settings))


def vendor_label(merchant: str) -> str:
    """A vendor name with nothing in it that could read as an instruction."""
    return " ".join(_NOT_NAME.sub(" ", merchant).split())[:MAX_VENDOR_CHARS].strip()


def _case_view(case: FindingOut) -> dict[str, Any]:
    return {
        "id": case.id,
        "vendor": vendor_label(case.merchant),
        "amount": Money(case.amount_minor, case.currency).format(),
        "leak_type": case.leak_type.value,
        "outcome": case.outcome.value,
        "status": case.status.value,
        "days_left": case.days_left,
        "next_step": case.next_action.kind,
    }


def _is_urgent(case: FindingOut) -> bool:
    return (
        case.stage is Stage.TODO
        and case.days_left is not None
        and 0 <= case.days_left <= URGENT_WITHIN_DAYS
    )


def get_overview(context: ToolContext, _: NoInput) -> dict[str, Any]:
    rows = context.session.scalars(select(FindingRow)).all()
    as_of = get_as_of(context.session, context.settings)
    standing = money_standing(rows, as_of)
    return {
        "as_of": as_of.isoformat(),
        "claimable_minor": standing.claimable_minor,
        "ready_to_claim": Money(standing.claimable_minor, "USD").format(),
        "in_flight": Money(standing.in_flight_minor, "USD").format(),
        "recovered": Money(standing.recovered_minor, "USD").format(),
        "claim_window_closed": Money(standing.expired_minor, "USD").format(),
        "cases": {stage.value: count for stage, count in standing.stage_counts.items()},
    }


def list_connections(context: ToolContext, _: NoInput) -> dict[str, Any]:
    settings = context.settings
    return {
        "data": settings.data_mode,
        "ramp": {"connected": settings.ramp_configured},
        "gmail": {
            "connected": settings.gmail_configured,
            "sends_approved_mail": settings.gmail_send_configured,
        },
        "status_pages": {"connected": True},
    }


def connect_gmail(context: ToolContext, _: NoInput) -> dict[str, Any]:
    """Consent belongs to the person: the agent can only point at where to give it."""
    settings = context.settings
    if settings.gmail_configured:
        return {"status": "already_connected"}
    if not (settings.gmail_client_id and settings.gmail_client_secret):
        return {
            "status": "not_set_up",
            "detail": "The server has no Google OAuth client yet. See Gmail in the README.",
        }
    return {"status": "needs_person", "open_url": GMAIL_CONNECT_PATH}


def run_scan(context: ToolContext, _: NoInput) -> dict[str, Any]:
    if context.is_sync_running():
        raise ToolError("A sync is already running. Try again in a minute.")
    summary = run_pipeline(context.session, context.settings, context.services, context.sources)
    wanted = ("as_of", "transactions", "emails_read", "created", "updated", "recovered")
    return {key: value for key, value in asdict(summary).items() if key in wanted}


def list_cases(context: ToolContext, args: ListCasesInput) -> dict[str, Any]:
    cases = _cases(context)
    if args.view == "urgent":
        picked = sorted(
            filter(_is_urgent, cases), key=lambda c: (c.days_left or 0, -c.amount_minor)
        )
    else:
        picked = [c for c in cases if c.stage.value == args.view]
    return {
        "view": args.view,
        "total": len(picked),
        "cases": [_case_view(c) for c in picked[: args.limit]],
    }


def draft_request(context: ToolContext, args: DraftRequestInput) -> dict[str, Any]:
    """Prepare a request for a person to read, edit and approve. Nothing is sent."""
    row = context.session.get(FindingRow, args.finding_id)
    if row is None:
        raise ToolError(f"There is no case {args.finding_id}.")
    existing = open_draft(context.session, row.id)
    if existing is not None:
        # Never redraft over one the person may have edited.
        return {"draft_id": existing.id, "finding_id": row.id, "status": "already_drafted"}
    profile = get_profile(context.session, context.settings)
    try:
        draft = create_draft(
            context.session,
            row,
            vendors=context.sources.vendors,
            drafter=context.services.drafter,
            as_of=get_as_of(context.session, context.settings),
            card_dispute_address=profile.card_dispute_address,
            actor=AGENT_ACTOR,
            company=profile.name,
        )
    except TransitionError as exc:
        raise ToolError(str(exc)) from exc
    return {"draft_id": draft.id, "finding_id": row.id, "status": "awaiting_approval"}


TOOLS: tuple[Tool, ...] = (
    Tool(
        "get_overview",
        "Totals for the company: money ready to claim, in flight, recovered, and missed.",
        NoInput,
        get_overview,
    ),
    Tool(
        "list_connections",
        "Which data sources are connected (Ramp, Gmail, status pages).",
        NoInput,
        list_connections,
    ),
    Tool(
        "connect_gmail",
        "Start connecting the finance inbox. Returns a link the person must open to consent.",
        NoInput,
        connect_gmail,
    ),
    Tool(
        "run_scan",
        "Run detection over the ledger, inbox and contracts. Returns how many cases changed.",
        NoInput,
        run_scan,
    ),
    Tool(
        "list_cases",
        "List cases. 'urgent' means open cases whose claim window closes within 14 days.",
        ListCasesInput,
        list_cases,
    ),
    Tool(
        "draft_request",
        "Draft a recovery request for one case. The person reviews and sends it; you cannot.",
        DraftRequestInput,
        draft_request,
    ),
)
_BY_NAME = {tool.name: tool for tool in TOOLS}


def tool_specs() -> list[dict[str, Any]]:
    return [
        {
            "name": tool.name,
            "description": tool.description,
            "input_schema": tool.input_model.model_json_schema(),
        }
        for tool in TOOLS
    ]


def _run(context: ToolContext, tool: Tool, raw_input: object) -> ToolOutcome:
    try:
        args = tool.input_model.model_validate(raw_input)
        # A savepoint: a tool that fails part-way leaves nothing behind, and the
        # session stays usable for the rest of the conversation.
        with context.session.begin_nested():
            return ToolOutcome(True, tool.run(context, args))
    except ValidationError as exc:
        fields = sorted({".".join(str(p) for p in e["loc"]) for e in exc.errors()})
        return ToolOutcome(False, {"error": f"Invalid input for {tool.name}: {fields}"})
    except ToolError as exc:
        return ToolOutcome(False, {"error": str(exc)})
    except Exception:
        logger.exception("agent tool %s failed", tool.name)
        return ToolOutcome(False, {"error": f"{tool.name} failed. Nothing was changed."})


def call_tool(context: ToolContext, name: str, raw_input: object) -> ToolOutcome:
    """Run one tool call from the model. Anything off the list, or malformed, is refused."""
    tool = _BY_NAME.get(name)
    if tool is None:
        outcome = ToolOutcome(False, {"error": f"{name[:64]!r} is not a tool."})
    else:
        outcome = _run(context, tool, raw_input)
    finding_id = outcome.result.get("finding_id") if outcome.ok else None
    audit(context.session, AGENT_ACTOR, "agent.tool", finding_id, tool=name[:64], ok=outcome.ok)
    # Commit per call: what the agent did is kept even if a later step fails, and no
    # write lock is held while waiting on the model.
    context.session.commit()
    return outcome
