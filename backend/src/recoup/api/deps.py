"""Request-scoped dependencies: a database session per request, plus app-wide services."""

from collections.abc import Iterator
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session, sessionmaker

from recoup.config import Settings
from recoup.ingest.sources import Sources
from recoup.services import Services


@dataclass(frozen=True)
class AppContext:
    settings: Settings
    factory: sessionmaker[Session]
    services: Services
    sources: Sources


def get_context(request: Request) -> AppContext:
    context: AppContext = request.app.state.context
    return context


def get_session(context: Annotated[AppContext, Depends(get_context)]) -> Iterator[Session]:
    session = context.factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


ContextDep = Annotated[AppContext, Depends(get_context)]
SessionDep = Annotated[Session, Depends(get_session)]
