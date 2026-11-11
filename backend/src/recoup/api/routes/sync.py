"""Pull real data on demand, and show where each source stands.

Status pages are public and need no credentials. Ramp and Gmail credentials stay on
the server; nothing here returns them.
"""

from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from sqlalchemy import func, select

from recoup.api.deps import ContextDep, SessionDep
from recoup.db.models import SyncRunRow, TransactionRow
from recoup.db.state import get_as_of
from recoup.demo import staging
from recoup.ingest.gmail import SOURCE as GMAIL_SOURCE
from recoup.ingest.live import (
    STATUS_PREFIX,
    http_fetcher,
    sync_ramp,
    sync_status_feeds,
    uptime_report,
)
from recoup.ingest.ramp import SOURCE as RAMP_SOURCE
from recoup.ingest.ramp import RampError
from recoup.ingest.status_feeds import FEEDS
from recoup.pipeline.run import run_pipeline

router = APIRouter(prefix="/api")
_STAGED_SYNC_AGE = timedelta(minutes=2)


def _last_run(session: SessionDep, source: str, prefix: bool = False) -> dict[str, Any] | None:
    match = SyncRunRow.source.startswith(source) if prefix else SyncRunRow.source == source
    row = session.scalar(
        select(SyncRunRow)
        .where(match)
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


def _staged_ramp_run(session: SessionDep) -> dict[str, Any]:
    """The demo ledger is a file, so Ramp's last sync is staged: always a few minutes ago."""
    count = session.scalar(select(func.count()).select_from(TransactionRow)) or 0
    return {
        "ok": True,
        "origin": "demo",
        "finished_at": (datetime.now(UTC) - _STAGED_SYNC_AGE).isoformat(),
        "detail": {"pulled": count, "inserted": count, "skipped": {}, "staged": True},
    }


@router.get("/sources")
def sources(session: SessionDep, context: ContextDep) -> dict[str, Any]:
    settings = context.settings
    report = context.sync.last_report
    # The scripted demo stages its sources: Ramp is connected from the start, and Gmail
    # once the presenter connects it (POST /api/demo/connect). Real credentials win.
    staged = settings.demo_mode and settings.data_mode == "demo"
    ramp_connected = settings.ramp_configured or staged
    gmail_connected = settings.gmail_configured or (staged and staging.gmail_connected(session))
    ramp_run = _last_run(session, RAMP_SOURCE)
    if ramp_run is None and staged and not settings.ramp_configured:
        ramp_run = _staged_ramp_run(session)
    gmail_run = _last_run(session, GMAIL_SOURCE)
    configured = {"ramp": ramp_connected, "gmail": gmail_connected}
    return {
        "ramp": {
            "connected": ramp_connected,
            "environment": settings.ramp_env,
            "last_sync": ramp_run,
        },
        "gmail": {
            "connected": gmail_connected,
            "last_sync": gmail_run,
        },
        "connectors": [
            {
                "key": c.key,
                "kind": c.kind,
                "configured": configured.get(c.key, c.is_configured),
                # Status pages record one run per feed; show the newest.
                "last_sync": _last_run(session, STATUS_PREFIX, prefix=True)
                if c.kind == "status"
                else {"ramp": ramp_run, "gmail": gmail_run}.get(c.key) or _last_run(session, c.key),
            }
            for c in context.sync.connectors
        ],
        "background_sync": {
            "interval_minutes": settings.sync_interval_minutes,
            "running": context.sync.is_running,
            "last_finished_at": report.finished_at if report else None,
            "last_error": context.sync.last_error,
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


def _staged_sync(session: SessionDep, context: ContextDep) -> dict[str, Any]:
    """The scripted demo's sync: detection only. Its sources are staged, so nothing is fetched
    (real status pages would bring in real outages and change the story from run to run)."""
    try:
        staging.require_scanned(session, context.settings)
    except staging.NotScannedError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    run = run_pipeline(session, context.settings, context.services, context.sources)
    staging.stamp_found_dates(session, context.settings)
    staged = {"inserted": 0, "staged": True}
    outcomes = [
        {"connector": "ramp", "kind": "ledger", "ok": True, "detail": staged, "error": None},
        {"connector": "gmail", "kind": "email", "ok": True, "detail": staged, "error": None},
    ]
    finished = datetime.now(UTC).isoformat()
    return {"finished_at": finished, "outcomes": outcomes, "run": asdict(run)}


@router.post("/sync")
def sync_everything(session: SessionDep, context: ContextDep) -> dict[str, Any]:
    """Every connected source, then detection, as one unit of work."""
    if staging.is_staged_database(session, context.settings):
        return _staged_sync(session, context)
    report = context.sync.run_once()
    if report is None:
        raise HTTPException(status_code=409, detail="A sync is already running.")
    return asdict(report)


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
