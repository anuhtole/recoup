"""Demo controls. Every route returns 404 unless RECOUP_DEMO_MODE=true."""

from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, HTTPException

from recoup.api.deps import ContextDep, SessionDep
from recoup.api.routes.sync import sources as sources_view
from recoup.api.schemas import (
    AdvanceIn,
    AdvanceOut,
    ConnectIn,
    DemoStateOut,
    ResetOut,
    RunSummaryOut,
)
from recoup.demo import staging
from recoup.demo.simulator import advance

router = APIRouter(prefix="/api/demo")


def _require_demo(context: ContextDep) -> None:
    if not context.settings.demo_mode:
        raise HTTPException(status_code=404, detail="Not found")


@router.get("/state", response_model=DemoStateOut)
def state(session: SessionDep, context: ContextDep) -> DemoStateOut:
    _require_demo(context)
    return DemoStateOut(**asdict(staging.demo_state(session, context.settings)))


@router.post("/connect")
def connect(body: ConnectIn, session: SessionDep, context: ContextDep) -> dict[str, Any]:
    """Staged: no Google sign-in. Answers with GET /api/sources, now with Gmail connected."""
    _require_demo(context)
    staging.connect_gmail(session)
    return sources_view(session, context)


@router.post("/scan", response_model=RunSummaryOut)
def scan(session: SessionDep, context: ContextDep) -> RunSummaryOut:
    _require_demo(context)
    try:
        result = staging.scan(
            session, context.settings, context.services, context.sources_for(session)
        )
    except staging.NotConnectedError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return RunSummaryOut(**asdict(result))


@router.post("/reset", response_model=ResetOut)
def reset(session: SessionDep, context: ContextDep) -> ResetOut:
    _require_demo(context)
    try:
        staging.reset_demo(session, context.settings)
    except staging.NotDemoDataError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return ResetOut(ok=True)


@router.post("/advance", response_model=AdvanceOut)
def advance_clock(body: AdvanceIn, session: SessionDep, context: ContextDep) -> AdvanceOut:
    _require_demo(context)
    try:
        staging.require_scanned(session, context.settings)
    except staging.NotScannedError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    result = advance(
        session, context.settings, context.services, context.sources_for(session), body.days
    )
    # Anything detection found on the new date is dated by the demo clock too.
    staging.stamp_found_dates(session, context.settings)
    return AdvanceOut(
        previous_as_of=result.previous_as_of,
        as_of=result.as_of,
        replies=result.replies,
        credits=result.credits,
        run=RunSummaryOut(**asdict(result.run)),
    )
