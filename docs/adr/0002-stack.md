# 0002. Python + FastAPI backend, React frontend, SQLite locally and Postgres in CI

**Status:** Accepted

## Context
The product is mostly data work: parsing ledgers, matching transactions, and scoring evals. The UI is a review queue. We have about two weeks and three people.

## Decision
- **Backend:** Python 3.12, FastAPI, SQLAlchemy 2, Alembic, and pydantic v2, managed with uv. Checked with ruff and mypy in strict mode.
- **Model:** Claude through the official `anthropic` Python SDK, using structured outputs (`messages.parse` with a pydantic schema). The default is `claude-opus-5-5` at medium effort, configurable with `RECOUP_LLM_MODEL` / `RECOUP_LLM_EFFORT`.
- **Frontend:** Vite + React + TypeScript with no UI framework. It is a single page that reads from the API.
- **Database:** SQLite for local development, so setup needs no install. CI also runs the full suite and migration check against Postgres 16.

## Consequences
- Python keeps detection, evals, and the Claude SDK in one language.
- The API contract is explicit pydantic schemas, and the TS types mirror them.
- The SQLite/Postgres split adds a CI job, and it catches dialect drift before a deploy would.
