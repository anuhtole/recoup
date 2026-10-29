"""Cases: the review queue, one case's full story, and the actions a person can take."""

from dataclasses import asdict

from fastapi import APIRouter, HTTPException
from sqlalchemy import case, func, select

from recoup.api.deps import ContextDep, SessionDep
from recoup.api.schemas import (
    DismissIn,
    DraftOut,
    FindingDetailOut,
    FindingOut,
    OutcomeTotal,
    RunSummaryOut,
    StageCount,
    SummaryOut,
)
from recoup.api.views import finding_detail, finding_list
from recoup.db.models import FindingRow
from recoup.db.state import get_as_of
from recoup.domain.types import Outcome
from recoup.domain.workflow import STAGE_OF, Stage, Status
from recoup.pipeline.run import run_pipeline
from recoup.recovery.workflow import TransitionError, create_draft, dismiss

router = APIRouter(prefix="/api")
REVIEWER = "user:reviewer"

_STAGE_ORDER = {Stage.TODO: 0, Stage.WAITING: 1, Stage.DONE: 2}


def _is_past(days_left: int | None) -> bool:
    return days_left is not None and days_left < 0


def _get(session: SessionDep, finding_id: int) -> FindingRow:
    row = session.get(FindingRow, finding_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Case not found")
    return row


@router.get("/summary", response_model=SummaryOut)
def summary(session: SessionDep, context: ContextDep) -> SummaryOut:
    rows = session.scalars(select(FindingRow)).all()
    claimable = in_flight = recovered = expired = 0
    stage_counts = dict.fromkeys(Stage, 0)
    for row in rows:
        status = Status(row.status)
        stage_counts[STAGE_OF[status]] += 1
        if status is Status.RECOVERED:
            recovered += row.recovered_minor or 0
        elif status is Status.DISMISSED:
            continue
        elif status is Status.EXPIRED:
            expired += row.amount_minor
        elif STAGE_OF[status] is Stage.WAITING:
            in_flight += row.amount_minor
        else:
            claimable += row.amount_minor

    totals_rows = session.execute(
        select(
            FindingRow.outcome, func.count(FindingRow.id), func.sum(FindingRow.amount_minor)
        ).group_by(FindingRow.outcome)
    ).all()
    by_outcome = {outcome: (count, total or 0) for outcome, count, total in totals_rows}
    return SummaryOut(
        currency="USD",
        as_of=get_as_of(session, context.settings),
        mode=context.services.mode,
        demo_mode=context.settings.demo_mode,
        claimable_minor=claimable,
        in_flight_minor=in_flight,
        recovered_minor=recovered,
        expired_minor=expired,
        totals=[
            OutcomeTotal(
                outcome=o,
                count=by_outcome.get(o.value, (0, 0))[0],
                amount_minor=by_outcome.get(o.value, (0, 0))[1],
            )
            for o in Outcome
        ],
        stages=[StageCount(stage=s, count=stage_counts[s]) for s in Stage],
    )


@router.get("/findings", response_model=list[FindingOut])
def list_findings(
    session: SessionDep,
    context: ContextDep,
    outcome: Outcome | None = None,
    stage: Stage | None = None,
) -> list[FindingOut]:
    query = select(FindingRow).order_by(
        case((FindingRow.recover_by.is_(None), 1), else_=0),
        FindingRow.recover_by.asc(),
        FindingRow.amount_minor.desc(),
        FindingRow.id,
    )
    if outcome is not None:
        query = query.where(FindingRow.outcome == outcome.value)
    if stage is not None:
        query = query.where(
            FindingRow.status.in_([s.value for s, g in STAGE_OF.items() if g is stage])
        )
    views = finding_list(
        session, session.scalars(query).all(), get_as_of(session, context.settings)
    )
    # Open deadlines first (soonest on top), then ones already past, then no deadline.
    return sorted(views, key=lambda v: (_STAGE_ORDER[v.stage], _is_past(v.days_left)))


@router.get("/findings/{finding_id}", response_model=FindingDetailOut)
def get_finding(finding_id: int, session: SessionDep, context: ContextDep) -> FindingDetailOut:
    row = _get(session, finding_id)
    return finding_detail(session, row, context.sources, get_as_of(session, context.settings))


@router.post("/findings/{finding_id}/draft", response_model=DraftOut)
def draft_request(finding_id: int, session: SessionDep, context: ContextDep) -> DraftOut:
    row = _get(session, finding_id)
    try:
        draft = create_draft(
            session,
            row,
            vendors=context.sources.vendors,
            drafter=context.services.drafter,
            as_of=get_as_of(session, context.settings),
            card_dispute_address=context.settings.card_dispute_address,
            actor=REVIEWER,
        )
    except TransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return DraftOut.model_validate(draft, from_attributes=True)


@router.post("/findings/{finding_id}/dismiss", response_model=FindingOut)
def dismiss_case(
    finding_id: int, body: DismissIn, session: SessionDep, context: ContextDep
) -> FindingOut:
    row = _get(session, finding_id)
    as_of = get_as_of(session, context.settings)
    try:
        dismiss(session, row, body.reason, REVIEWER, as_of)
    except TransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    session.flush()
    return finding_list(session, [row], as_of)[0]


@router.post("/pipeline/run", response_model=RunSummaryOut)
def trigger_run(session: SessionDep, context: ContextDep) -> RunSummaryOut:
    result = run_pipeline(session, context.settings, context.services, context.sources)
    return RunSummaryOut(**asdict(result))
