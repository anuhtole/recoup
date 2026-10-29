"""Database and dataset fixtures.

Tests run against a throwaway SQLite file by default. Set RECOUP_TEST_DATABASE_URL
to run the same suite against Postgres (CI does both).
"""

import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from recoup.config import Settings
from recoup.db.models import Base
from recoup.db.session import make_engine, make_session_factory, session_scope
from recoup.ingest.dataset import ingest_dataset
from recoup.ingest.sources import Sources, load_sources
from recoup.pipeline.run import RunSummary, run_pipeline
from recoup.services import Services, offline_services
from recoup.synth.generate import write_dataset


@pytest.fixture
def database_url(tmp_path: Path) -> str:
    return os.environ.get("RECOUP_TEST_DATABASE_URL") or f"sqlite:///{tmp_path / 'test.db'}"


@pytest.fixture
def engine(database_url: str) -> Iterator[Engine]:
    engine = make_engine(database_url)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture
def session_factory(engine: Engine) -> sessionmaker[Session]:
    return make_session_factory(engine)


@pytest.fixture(scope="session")
def data_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    directory = tmp_path_factory.mktemp("synthetic")
    write_dataset(directory)
    return directory


@pytest.fixture
def settings(database_url: str, data_dir: Path) -> Settings:
    return Settings(database_url=database_url, data_dir=data_dir, demo_mode=True, llm="off")


@pytest.fixture
def services() -> Services:
    return offline_services()


@pytest.fixture
def sources(data_dir: Path) -> Sources:
    return load_sources(data_dir)


def load_and_run(
    factory: sessionmaker[Session], settings: Settings, services: Services, sources: Sources
) -> RunSummary:
    with session_scope(factory) as session:
        ingest_dataset(session, settings.data_dir)
    with session_scope(factory) as session:
        return run_pipeline(session, settings, services, sources)
