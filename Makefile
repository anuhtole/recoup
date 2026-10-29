.PHONY: setup data db demo reset api web dev test eval eval-claude lint fmt typecheck check

# Import the backend from source, so commands never depend on the editable install's .pth file
# (macOS can flag those hidden, and Python 3.12+ then skips them).
export PYTHONPATH := $(CURDIR)/backend/src

## setup: install everything, build the database, load the synthetic data, run detection
setup:
	cd backend && uv sync
	cd frontend && npm install
	$(MAKE) db

## data: regenerate the synthetic dataset and answer key
data:
	cd backend && uv run recoup generate

## db: create the database, load ledger and inbox, run detection
db:
	cd backend && uv run alembic upgrade head && uv run recoup ingest && uv run recoup run

## reset: drop the local database and rebuild it, which restarts the demo at Oct 1, 2026
reset:
	rm -f backend/recoup.db
	$(MAKE) db

## dev: API on :8000 (demo controls on) and UI on :5173
dev:
	$(MAKE) -j2 api web

## demo: a clean database, then dev
demo: reset dev

api:
	cd backend && RECOUP_DEMO_MODE=true uv run recoup serve --reload

web:
	cd frontend && npm run dev

## test: unit, integration, red-team, and eval quality gates
test:
	cd backend && uv run pytest

## eval: detector and baseline tables, written to backend/evals/results/
eval:
	cd backend && uv run python -m evals.run

## eval-claude: the same, plus Claude extraction (needs ANTHROPIC_API_KEY; makes paid API calls)
eval-claude:
	cd backend && uv run python -m evals.run --claude

lint:
	cd backend && uv run ruff check . && uv run ruff format --check .

fmt:
	cd backend && uv run ruff format . && uv run ruff check --fix .

typecheck:
	cd backend && uv run mypy

## check: everything CI runs
check: lint typecheck test
	cd frontend && npm run build
