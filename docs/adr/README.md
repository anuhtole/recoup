# Architecture decision records

Each record states one decision, the context that forced it, and what it costs. Read them in order to see how Recoup got its shape, or jump to the one behind the code you are reading.

| # | Decision | Where it lives |
|---|---|---|
| [0001](0001-workflow-not-agent.md) | A fixed workflow, not an autonomous agent | `pipeline/` |
| [0002](0002-stack.md) | Python + FastAPI backend, React frontend, SQLite locally and Postgres in CI | `backend/`, `frontend/` |
| [0003](0003-integer-minor-units.md) | Money as integer minor units | `domain/money.py` |
| [0004](0004-discrete-outcomes.md) | Discrete outcomes, not confidence scores | `domain/types.py` |
| [0005](0005-model-reads-code-decides.md) | The model reads; code decides | `extract/validate.py` |
| [0006](0006-human-approval-and-ledger-truth.md) | A person approves every message; only the ledger closes a case | `recovery/` |
| [0007](0007-offline-baseline-and-caching.md) | An offline baseline, cached model output, and fallbacks | `extract/heuristic.py` |
| [0008](0008-real-data-connectors.md) | Real data: Ramp transactions and public status pages | `ingest/ramp.py`, `ingest/status_feeds.py` |
| [0009](0009-connector-interface.md) | One connector interface, read-only Gmail, background sync | `connectors/` |
| [0010](0010-price-overcharges.md) | Price overcharges against the order form | `detectors/pricing.py` |
| [0011](0011-contract-reader.md) | Claude reads contracts, code checks every term | `extract/contract_reader.py`, `extract/contract_gate.py` |
| [0012](0012-company-onboarding.md) | A company plugs in its own data from the Setup page | `ingest/company.py`, `ingest/csv_ledger.py`, `frontend/src/components/setup/` |
| [0013](0013-chat-agent-and-gmail-send.md) | A chat agent that can look and draft but not send; approved mail goes out through Gmail | `agent/`, `recovery/gmail_outbox.py` |

Paths under `backend/src/recoup/` unless shown otherwise. A new decision takes the next number and the same sections: **Status**, **Context**, **Decision**, **Consequences**.
