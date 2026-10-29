"""Demo controls. The route returns 404 unless RECOUP_DEMO_MODE=true."""

from dataclasses import asdict

from fastapi import APIRouter, HTTPException

from recoup.api.deps import ContextDep, SessionDep
from recoup.api.schemas import AdvanceIn, AdvanceOut, RunSummaryOut
from recoup.demo.simulator import advance

router = APIRouter(prefix="/api/demo")


@router.post("/advance", response_model=AdvanceOut)
def advance_clock(body: AdvanceIn, session: SessionDep, context: ContextDep) -> AdvanceOut:
    if not context.settings.demo_mode:
        raise HTTPException(status_code=404, detail="Not found")
    result = advance(session, context.settings, context.services, context.sources, body.days)
    return AdvanceOut(
        previous_as_of=result.previous_as_of,
        as_of=result.as_of,
        replies=result.replies,
        credits=result.credits,
        run=RunSummaryOut(**asdict(result.run)),
    )
