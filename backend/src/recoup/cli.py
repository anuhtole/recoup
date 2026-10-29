"""Command line entry point: `recoup generate | ingest | run | advance | serve`."""

import argparse
import json
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import asdict

from sqlalchemy.orm import Session

from recoup.config import get_settings
from recoup.db.session import make_engine, make_session_factory, session_scope
from recoup.demo.simulator import advance
from recoup.ingest.dataset import ingest_dataset
from recoup.ingest.sources import load_sources
from recoup.pipeline.run import run_pipeline
from recoup.services import build_services
from recoup.synth.generate import DEFAULT_SEED, write_dataset


@contextmanager
def _session() -> Iterator[Session]:
    engine = make_engine(get_settings().database_url)
    try:
        with session_scope(make_session_factory(engine)) as session:
            yield session
    finally:
        engine.dispose()


def _generate(args: argparse.Namespace) -> None:
    paths = write_dataset(get_settings().data_dir, seed=args.seed)
    print(json.dumps({key: str(path) for key, path in paths.items()}, indent=2))


def _ingest(_: argparse.Namespace) -> None:
    with _session() as session:
        result = ingest_dataset(session, get_settings().data_dir)
    print(json.dumps(asdict(result)))


def _run(_: argparse.Namespace) -> None:
    settings = get_settings()
    services = build_services(settings)
    with _session() as session:
        summary = run_pipeline(session, settings, services, load_sources(settings.data_dir))
    print(json.dumps({**asdict(summary), "mode": services.mode}))


def _advance(args: argparse.Namespace) -> None:
    settings = get_settings()
    services = build_services(settings)
    with _session() as session:
        result = advance(session, settings, services, load_sources(settings.data_dir), args.days)
    print(json.dumps(asdict(result)))


def _serve(args: argparse.Namespace) -> None:
    import uvicorn

    uvicorn.run("recoup.api.app:create_app", factory=True, port=args.port, reload=args.reload)


def main() -> None:
    parser = argparse.ArgumentParser(prog="recoup")
    commands = parser.add_subparsers(dest="command", required=True)

    generate = commands.add_parser("generate", help="Write the synthetic dataset and answer key")
    generate.add_argument("--seed", type=int, default=DEFAULT_SEED)
    generate.set_defaults(handler=_generate)

    commands.add_parser("ingest", help="Load ledger and inbox into the database").set_defaults(
        handler=_ingest
    )
    commands.add_parser("run", help="Read the inbox, detect, and persist findings").set_defaults(
        handler=_run
    )
    demo = commands.add_parser("advance", help="Demo: move the clock and play the vendors' side")
    demo.add_argument("--days", type=int, default=14)
    demo.set_defaults(handler=_advance)

    serve = commands.add_parser("serve", help="Start the API server")
    serve.add_argument("--port", type=int, default=8000)
    serve.add_argument("--reload", action="store_true")
    serve.set_defaults(handler=_serve)

    args = parser.parse_args()
    args.handler(args)


if __name__ == "__main__":
    main()
