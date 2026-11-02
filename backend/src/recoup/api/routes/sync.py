"""Pull real data on demand, and show where each source stands.

Status pages are public and need no credentials. Ramp credentials stay on the server;
nothing here returns them.
"""

from dataclasses import asdict
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from recoup.api.deps import ContextDep, SessionDep
from recoup.db.models import SyncRunRow
from recoup.db.state import get_as_of
from recoup.ingest.live import http_fetcher, sync_ramp, sync_status_feeds, uptime_report
from recoup.ingest.ramp import SOURCE as RAMP_SOURCE
from recoup.ingest.ramp import RampError
from recoup.ingest.status_feeds import FEEDS
from recoup.pipeline.run import run_pipeline

router = APIRouter(prefix="/api")


def _last_run(session: SessionDep, source: str) -> dict[str, Any] | None:
    row = session.scalar(
        select(SyncRunRow)
        .where(SyncRunRow.source == source)
        .order_by(SyncRunRow.finished_at.desc(), SyncRunRow.id.desc())
    )
    if row is None:
        return None
    return {
        "ok": row.ok,
        "origin": row.origin,
        "finished_at": row.finished_at.isoformat(),
        "detail": row.detail,
    }


@router.get("/sources")
def sources(session: SessionDep, context: ContextDep) -> dict[str, Any]:
    settings = context.settings
    return {
        "ramp": {
            "connected": settings.ramp_configured,
            "environment": settings.ramp_env,
            "last_sync": _last_run(session, RAMP_SOURCE),
        },
        "status_feeds": [
            {
                "key": feed.key,
                "page_url": feed.page_url,
                "sla": feed.contract.document,
                "last_sync": _last_run(session, f"status:{feed.key}"),
            }
            for feed in FEEDS
        ],
        "uptime_checks": [asdict(c) for c in uptime_report(session, get_as_of(session, settings))],
    }


@router.post("/sync/status")
def sync_status(session: SessionDep, context: ContextDep) -> dict[str, Any]:
    with httpx.Client(timeout=20.0) as client:
        feeds = sync_status_feeds(session, http_fetcher(client))
    run = run_pipeline(session, context.settings, context.services, context.sources)
    return {"feeds": [asdict(f) for f in feeds], "run": asdict(run)}


@router.post("/sync/ramp")
def sync_ramp_route(session: SessionDep, context: ContextDep) -> dict[str, Any]:
    if not context.settings.ramp_configured:
        raise HTTPException(status_code=409, detail="Ramp is not connected.")
    try:
        result = sync_ramp(session, context.settings)
    except RampError as exc:
        # Commit the recorded failure; rolling back would hide that the sync was tried.
        session.commit()
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    run = run_pipeline(session, context.settings, context.services, context.sources)
    return {"ramp": asdict(result), "run": asdict(run)}
