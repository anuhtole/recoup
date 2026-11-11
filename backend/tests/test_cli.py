import json
import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from recoup import cli
from recoup.config import get_settings


@pytest.fixture
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    monkeypatch.setenv("RECOUP_DATABASE_URL", f"sqlite:///{tmp_path / 'cli.db'}")
    monkeypatch.setenv("RECOUP_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("RECOUP_DEMO_MODE", "true")
    monkeypatch.setenv("RECOUP_LLM", "off")
    get_settings.cache_clear()
    yield tmp_path
    get_settings.cache_clear()


def _run(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], *args: str
) -> dict[str, Any]:
    monkeypatch.setattr(sys, "argv", ["recoup", *args])
    cli.main()
    result: dict[str, Any] = json.loads(capsys.readouterr().out)
    return result


def test_generate_ingest_run_advance(
    env: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    from recoup.db.models import Base
    from recoup.db.session import make_engine

    monkeypatch.setenv("RECOUP_DEMO_HISTORY", "true")
    get_settings.cache_clear()
    paths = _run(monkeypatch, capsys, "generate")
    engine = make_engine(get_settings().database_url)
    Base.metadata.create_all(engine)
    engine.dispose()
    ingested = _run(monkeypatch, capsys, "ingest")
    first = _run(monkeypatch, capsys, "run")
    second = _run(monkeypatch, capsys, "run")
    advanced = _run(monkeypatch, capsys, "advance", "--days", "7")

    assert set(paths) >= {"transactions", "emails", "labels"}
    assert ingested["as_of"] == "2026-10-01"
    assert first["created"] > 0 and first["mode"] == "offline"
    assert (first["history"]["claims"], first["history"]["recovered"]) == (13, 8)
    assert first["history"]["in_flight"] == 4
    assert second["created"] == 0 and "history" not in second
    assert advanced["as_of"] == "2026-10-08"


def test_run_skips_the_history_by_default(
    env: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    from recoup.db.models import Base
    from recoup.db.session import make_engine

    _run(monkeypatch, capsys, "generate")
    engine = make_engine(get_settings().database_url)
    Base.metadata.create_all(engine)
    engine.dispose()
    _run(monkeypatch, capsys, "ingest")

    assert "history" not in _run(monkeypatch, capsys, "run")


def test_demo_reset_leaves_the_clean_slate_and_scan_rebuilds(
    env: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    from recoup.db.models import Base
    from recoup.db.session import make_engine

    _run(monkeypatch, capsys, "generate")
    engine = make_engine(get_settings().database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    scanned = _run(monkeypatch, capsys, "demo-reset", "--scan")
    clean = _run(monkeypatch, capsys, "demo-reset")

    assert scanned["scan"]["created"] == 20
    assert scanned["state"]["scanned"] and scanned["state"]["gmail_connected"]
    assert clean["transactions"] == scanned["transactions"] > 0
    assert clean["state"] == {
        "scanned": False,
        "gmail_connected": False,
        "gmail_address": "finance@acme.com",
        "as_of": "2026-10-01",
        "start_as_of": "2026-10-01",
    }
    assert "scan" not in clean
