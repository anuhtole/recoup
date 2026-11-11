"""Command line entry point.

`recoup generate | ingest | run | advance | demo-reset | sync | connect | contracts | watch |
serve`.
"""

import argparse
import json
import sys
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import asdict
from pathlib import Path

import httpx
from anthropic import Anthropic, APIError
from sqlalchemy.orm import Session

from recoup.config import Settings, get_settings
from recoup.connectors.registry import build_connectors
from recoup.connectors.scheduler import BackgroundSync
from recoup.db.session import has_schema, make_engine, make_session_factory, session_scope
from recoup.db.state import get_as_of
from recoup.demo.history import replay_history
from recoup.demo.simulator import advance
from recoup.demo.staging import connect_gmail as connect_demo_gmail
from recoup.demo.staging import demo_state, reset_demo
from recoup.demo.staging import scan as scan_demo
from recoup.extract.claude import ClaudeStructured, LlmError
from recoup.extract.contract_reader import (
    ClaudeContractReader,
    ContractReadError,
    read_contract,
)
from recoup.ingest.company import company_sources, save_contract
from recoup.ingest.dataset import ingest_dataset
from recoup.ingest.gmail import GmailError, consent_scopes
from recoup.ingest.google_oauth import connect_gmail
from recoup.ingest.live import (
    demo_invoices,
    http_fetcher,
    snapshot_fetcher,
    sync_gmail,
    sync_ramp,
    sync_status_feeds,
    uptime_report,
)
from recoup.ingest.loader import ingest_transactions
from recoup.ingest.ramp import RampError
from recoup.ingest.sources import Sources, load_sources
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
        summary = run_pipeline(session, settings, services, _sources(session, settings))
        # The demo's past claims, replayed once, only with RECOUP_DEMO_HISTORY=true.
        history = (
            replay_history(session, settings, services, _sources(session, settings))
            if settings.data_mode == "demo"
            else None
        )
    output: dict[str, object] = {**asdict(summary), "mode": services.mode}
    if history is not None:
        output["history"] = asdict(history)
    print(json.dumps(output))


def _advance(args: argparse.Namespace) -> None:
    settings = get_settings()
    services = build_services(settings)
    with _session() as session:
        result = advance(session, settings, services, _sources(session, settings), args.days)
    print(json.dumps(asdict(result)))


def _demo_reset(args: argparse.Namespace) -> None:
    """The scripted demo's clean slate; --scan also connects Gmail and scans, as the
    presenter would. Rows are cleared, not the file, so a running server keeps working."""
    settings = get_settings()
    started = time.perf_counter()
    output: dict[str, object] = {}
    with _session() as session:
        output["transactions"] = reset_demo(session, settings)
        if args.scan:
            connect_demo_gmail(session)
            services = build_services(settings)
            run = scan_demo(session, settings, services, _sources(session, settings))
            output["scan"] = {**asdict(run), "mode": services.mode}
        output["state"] = asdict(demo_state(session, settings))
    output["seconds"] = round(time.perf_counter() - started, 3)
    print(json.dumps(output))


def _sources(session: Session, settings: Settings) -> Sources:
    return company_sources(session, load_sources(settings.data_dir))


def _detect(session: Session) -> dict[str, object]:
    settings = get_settings()
    services = build_services(settings)
    summary = run_pipeline(session, settings, services, _sources(session, settings))
    return {**asdict(summary), "mode": services.mode}


def _sync_status(args: argparse.Namespace) -> None:
    settings = get_settings()
    with _session() as session:
        if args.demo_invoices:
            ingest_transactions(session, demo_invoices())
        if args.snapshot:
            directory = settings.data_dir.parent / "live" / "status_snapshot"
            feeds = sync_status_feeds(session, snapshot_fetcher(directory), origin="snapshot")
        else:
            with httpx.Client(timeout=20.0) as client:
                feeds = sync_status_feeds(session, http_fetcher(client))
        run = _detect(session)
        checks = uptime_report(session, get_as_of(session, settings))
    output = {
        "feeds": [asdict(f) for f in feeds],
        "uptime_checks": [asdict(c) for c in checks],
        "run": run,
    }
    print(json.dumps(output, indent=2))


def _sync_ramp(_: argparse.Namespace) -> None:
    try:
        with _session() as session:
            sync = sync_ramp(session, get_settings())
            run = _detect(session)
    except RampError as exc:
        sys.exit(str(exc))
    print(json.dumps({"ramp": asdict(sync), "run": run}, indent=2))


def _sync_gmail(_: argparse.Namespace) -> None:
    settings = get_settings()
    try:
        with _session() as session:
            sync = sync_gmail(session, settings, _sources(session, settings).vendors)
            run = _detect(session)
    except GmailError as exc:
        sys.exit(str(exc))
    print(json.dumps({"gmail": asdict(sync), "run": run}, indent=2))


def _background(interval_minutes: int) -> tuple[BackgroundSync, Callable[[], None]]:
    settings = get_settings()
    engine = make_engine(settings.database_url)
    sources = load_sources(settings.data_dir)
    sync = BackgroundSync(
        make_session_factory(engine),
        settings,
        build_services(settings),
        sources,
        build_connectors(settings, sources),
        interval_seconds=interval_minutes * 60,
    )
    return sync, engine.dispose


def _sync_all(_: argparse.Namespace) -> None:
    sync, dispose = _background(0)
    try:
        report = sync.run_once()
    finally:
        dispose()
    print(json.dumps(asdict(report) if report else None, indent=2))


def _watch(args: argparse.Namespace) -> None:
    """Sync everything on a timer in the foreground; Ctrl-C stops it."""
    if args.interval < 1:
        sys.exit("--interval must be at least 1 minute.")
    sync, dispose = _background(args.interval)
    try:
        while True:
            report = sync.run_once()
            if report is not None:
                print(json.dumps({"finished_at": report.finished_at, "run": asdict(report.run)}))
            time.sleep(sync.interval_seconds)
    except KeyboardInterrupt:
        pass
    finally:
        dispose()


def _connect_gmail(args: argparse.Namespace) -> None:
    settings = get_settings()
    if not settings.gmail_client_id or settings.gmail_client_secret is None:
        sys.exit(
            "Set RECOUP_GMAIL_CLIENT_ID and RECOUP_GMAIL_CLIENT_SECRET in backend/.env first "
            "(a Google Cloud OAuth client of type Desktop app)."
        )
    print("Opening Google sign-in in your browser. Recoup asks for read-only Gmail access.")
    try:
        connect_gmail(
            settings.gmail_client_id,
            settings.gmail_client_secret.get_secret_value(),
            args.env_file,
            scopes=consent_scopes(settings.gmail_send),
        )
    except GmailError as exc:
        sys.exit(str(exc))
    print(f"Gmail connected. The refresh token was saved to {args.env_file}.")


def _contracts_read(args: argparse.Namespace) -> None:
    settings = get_settings()
    if settings.anthropic_api_key is None:
        sys.exit("Reading a contract needs ANTHROPIC_API_KEY in backend/.env.")
    client = Anthropic(api_key=settings.anthropic_api_key.get_secret_value(), max_retries=3)
    llm = ClaudeStructured(client=client, model=settings.llm_model, effort=settings.llm_effort)
    with _session() as session:
        vendors = _sources(session, settings).vendors
    try:
        verdict = read_contract(ClaudeContractReader(llm), args.path, vendors)
    except (ContractReadError, LlmError) as exc:
        sys.exit(str(exc))
    except APIError as exc:
        sys.exit(f"Claude request failed ({type(exc).__name__}). Try again shortly.")
    for problem in verdict.problems:
        print(f"note: {problem}", file=sys.stderr)
    if verdict.contract is None:
        sys.exit("Rejected: nothing in this document could be verified.")
    print(verdict.contract.model_dump_json(indent=2))
    if args.save:
        with _session() as session:
            save_contract(session, verdict.contract, "upload")
        print("Saved it to this company's contracts.", file=sys.stderr)


def _require_schema() -> None:
    """Stop before the server starts, not at the first request, when nothing is migrated."""
    engine = make_engine(get_settings().database_url)
    try:
        if not has_schema(engine):
            sys.exit(
                "The database has no tables yet. Run `make db` from the repo root, "
                "or `uv run alembic upgrade head` in backend/, then start the server again."
            )
    finally:
        engine.dispose()


def _serve(args: argparse.Namespace) -> None:
    import uvicorn

    _require_schema()
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
    commands.add_parser(
        "run", help="Read the inbox, detect, and persist findings (plus past claims if enabled)"
    ).set_defaults(handler=_run)
    demo = commands.add_parser("advance", help="Demo: move the clock and play the vendors' side")
    demo.add_argument("--days", type=int, default=14)
    demo.set_defaults(handler=_advance)

    reset = commands.add_parser(
        "demo-reset", help="Demo: back to the clean slate (ledger in, nothing found, Oct 1)"
    )
    reset.add_argument(
        "--scan", action="store_true", help="Then connect Gmail and scan, as the presenter would"
    )
    reset.set_defaults(handler=_demo_reset)

    sync = commands.add_parser("sync", help="Pull real data, then re-run detection")
    targets = sync.add_subparsers(dest="target", required=True)
    status = targets.add_parser("status", help="Read vendor status pages against published SLAs")
    status.add_argument("--snapshot", action="store_true", help="Use the recorded real feeds")
    status.add_argument(
        "--demo-invoices", action="store_true", help="Add Northwind's fictional Atlassian bills"
    )
    status.set_defaults(handler=_sync_status)
    targets.add_parser("ramp", help="Read transactions from the Ramp API").set_defaults(
        handler=_sync_ramp
    )
    targets.add_parser("gmail", help="Read vendor mail from Gmail, read-only").set_defaults(
        handler=_sync_gmail
    )
    targets.add_parser("all", help="Every connected source, then detection").set_defaults(
        handler=_sync_all
    )

    connect = commands.add_parser("connect", help="Grant Recoup access to a data source")
    providers = connect.add_subparsers(dest="provider", required=True)
    gmail = providers.add_parser("gmail", help="Read-only Gmail consent in the browser")
    gmail.add_argument("--env-file", type=Path, default=Path(".env"))
    gmail.set_defaults(handler=_connect_gmail)

    contracts = commands.add_parser("contracts", help="Read vendor contracts with Claude")
    actions = contracts.add_subparsers(dest="action", required=True)
    read = actions.add_parser("read", help="Read an order form's SLA and price terms")
    read.add_argument("path", type=Path, help="A .pdf, .txt, or .md order form")
    read.add_argument("--save", action="store_true", help="Add the verified contract to the data")
    read.set_defaults(handler=_contracts_read)

    watch = commands.add_parser("watch", help="Sync every source on a timer until stopped")
    watch.add_argument("--interval", type=int, default=15, help="Minutes between syncs")
    watch.set_defaults(handler=_watch)

    serve = commands.add_parser("serve", help="Start the API server")
    serve.add_argument("--port", type=int, default=8000)
    serve.add_argument("--reload", action="store_true")
    serve.set_defaults(handler=_serve)

    args = parser.parse_args()
    args.handler(args)


if __name__ == "__main__":
    main()
