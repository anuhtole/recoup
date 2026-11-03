"""Keep data fresh: pull from every connector, then re-run detection, on a timer.

Only one cycle runs at a time, whether a timer or a person started it. A cycle is
one unit of work: findings are only saved together with the data they came from.
"""

import asyncio
import logging
import threading
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy.orm import Session, sessionmaker

from recoup.config import Settings
from recoup.connectors.base import Connector, SyncOutcome
from recoup.connectors.registry import sync_all
from recoup.db.session import session_scope
from recoup.ingest.sources import Sources
from recoup.pipeline.run import RunSummary, run_pipeline
from recoup.services import Services

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class CycleReport:
    finished_at: str
    outcomes: tuple[SyncOutcome, ...]
    run: RunSummary


def sync_cycle(
    session: Session,
    settings: Settings,
    services: Services,
    sources: Sources,
    connectors: Sequence[Connector],
) -> CycleReport:
    outcomes = sync_all(session, connectors)
    run = run_pipeline(session, settings, services, sources)
    return CycleReport(datetime.now(UTC).isoformat(), tuple(outcomes), run)


class BackgroundSync:
    def __init__(
        self,
        factory: sessionmaker[Session],
        settings: Settings,
        services: Services,
        sources: Sources,
        connectors: Sequence[Connector],
        interval_seconds: float,
    ) -> None:
        self._factory = factory
        self._settings = settings
        self._services = services
        self._sources = sources
        self.connectors = tuple(connectors)
        self.interval_seconds = interval_seconds
        self._lock = threading.Lock()
        self.last_report: CycleReport | None = None
        self.last_error: str | None = None

    @property
    def is_running(self) -> bool:
        return self._lock.locked()

    @property
    def is_scheduled(self) -> bool:
        return self.interval_seconds > 0

    def run_once(self) -> CycleReport | None:
        """One cycle, or None when another is already running."""
        if not self._lock.acquire(blocking=False):
            return None
        try:
            with session_scope(self._factory) as session:
                report = sync_cycle(
                    session, self._settings, self._services, self._sources, self.connectors
                )
            self.last_report, self.last_error = report, None
            return report
        except Exception as exc:
            self.last_error = type(exc).__name__
            raise
        finally:
            self._lock.release()

    async def run_forever(self) -> None:
        """Sync at startup and then every interval, until cancelled."""
        while True:
            try:
                await asyncio.to_thread(self.run_once)
            except Exception:
                # A bad cycle is logged and the next one still runs.
                logger.exception("background sync failed")
            await asyncio.sleep(self.interval_seconds)
