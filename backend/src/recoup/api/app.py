"""FastAPI application for the review UI."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from recoup.api.deps import AppContext
from recoup.api.routes import cases, demo, drafts
from recoup.config import Settings, get_settings
from recoup.db.session import make_engine, make_session_factory
from recoup.ingest.sources import load_sources
from recoup.services import Services, build_services


def create_app(settings: Settings | None = None, services: Services | None = None) -> FastAPI:
    settings = settings or get_settings()
    engine = make_engine(settings.database_url)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        engine.dispose()

    app = FastAPI(title="Recoup", version="0.2.0", lifespan=lifespan)
    app.state.context = AppContext(
        settings=settings,
        factory=make_session_factory(engine),
        services=services or build_services(settings),
        sources=load_sources(settings.data_dir),
    )

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(cases.router)
    app.include_router(drafts.router)
    app.include_router(demo.router)
    return app
