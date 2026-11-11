"""Chat with the agent. It can look things up and draft; sending is a separate, human step."""

import logging
from dataclasses import asdict

from anthropic import APIError
from fastapi import APIRouter, HTTPException

from recoup.agent.loop import run_agent
from recoup.agent.tools import ToolContext
from recoup.api.deps import ContextDep, SessionDep
from recoup.api.schemas import ChatIn, ChatOut, ToolCallOut
from recoup.extract.claude import LlmError

router = APIRouter(prefix="/api/agent")
logger = logging.getLogger(__name__)


@router.post("/chat", response_model=ChatOut)
def chat(body: ChatIn, session: SessionDep, context: ContextDep) -> ChatOut:
    llm = context.services.llm
    if llm is None:
        raise HTTPException(
            status_code=409, detail="The assistant needs ANTHROPIC_API_KEY on the server."
        )
    tools = ToolContext(
        session=session,
        settings=context.settings,
        services=context.services,
        sources=context.sources_for(session),
        is_sync_running=lambda: context.sync.is_running,
    )
    history = [{"role": m.role, "content": m.content} for m in body.messages]
    try:
        reply = run_agent(llm.client, llm.model, history, tools)
    except LlmError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except APIError as exc:
        logger.warning("agent chat failed: %s", type(exc).__name__)
        raise HTTPException(
            status_code=502, detail="Claude could not be reached. Try again shortly."
        ) from exc
    return ChatOut(
        reply=reply.text,
        calls=[ToolCallOut(**asdict(call)) for call in reply.calls],
        stopped_early=reply.stopped_early,
    )
