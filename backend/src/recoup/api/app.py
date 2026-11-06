"""FastAPI application for the review UI."""

import asyncio
import contextlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from recoup.api.deps import AppContext
from recoup.api.routes import cases, demo, drafts, sync
from recoup.config import Settings, get_settings
from recoup.connectors.registry import build_connectors
from recoup.connectors.scheduler import BackgroundSync
from recoup.db.session import make_engine, make_session_factory
from recoup.ingest.sources import load_sources
from recoup.services import Services, build_services


def create_app(settings: Settings | None = None, services: Services | None = None) -> FastAPI:
    settings = settings or get_settings()
    engine = make_engine(settings.database_url)
    factory = make_session_factory(engine)
    services = services or build_services(settings)
    sources = load_sources(settings.data_dir)
    background = BackgroundSync(
        factory,
        settings,
        services,
        sources,
        build_connectors(settings, sources),
        interval_seconds=settings.sync_interval_minutes * 60,
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        task = asyncio.create_task(background.run_forever()) if background.is_scheduled else None
        yield
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        engine.dispose()

    app = FastAPI(title="Recoup", version="0.2.0", lifespan=lifespan)
    app.state.context = AppContext(
        settings=settings, factory=factory, services=services, base_sources=sources, sync=background
    )

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(cases.router)
    app.include_router(drafts.router)
    app.include_router(demo.router)
    app.include_router(sync.router)
    return app
