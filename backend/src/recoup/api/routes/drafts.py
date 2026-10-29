"""Drafts: edit, then send only with an explicit approval from a person."""

from fastapi import APIRouter, HTTPException

from recoup.api.deps import ContextDep, SessionDep
from recoup.api.schemas import DraftOut, DraftUpdateIn, SendIn
from recoup.db.models import DraftRow
from recoup.db.state import get_as_of
from recoup.recovery.workflow import TransitionError, send_draft, update_draft

router = APIRouter(prefix="/api/drafts")


def _get(session: SessionDep, draft_id: int) -> DraftRow:
    draft = session.get(DraftRow, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    return draft


@router.patch("/{draft_id}", response_model=DraftOut)
def edit(draft_id: int, body: DraftUpdateIn, session: SessionDep) -> DraftOut:
    draft = _get(session, draft_id)
    try:
        update_draft(session, draft, body.subject, body.body, actor="user:reviewer")
    except TransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return DraftOut.model_validate(draft, from_attributes=True)


@router.post("/{draft_id}/send", response_model=DraftOut)
def send(draft_id: int, body: SendIn, session: SessionDep, context: ContextDep) -> DraftOut:
    draft = _get(session, draft_id)
    try:
        send_draft(
            session,
            draft,
            outbox=context.services.outbox,
            as_of=get_as_of(session, context.settings),
            actor=f"user:{body.approver}",
        )
    except TransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return DraftOut.model_validate(draft, from_attributes=True)
