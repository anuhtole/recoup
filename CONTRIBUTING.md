# Contributing

## Set up

You need Python 3.12+, [uv](https://docs.astral.sh/uv/), Node 22 and `make`.

```bash
make setup   # install, build the database, load the synthetic company, run detection
make dev     # API on :8000, UI on http://localhost:5173
```

`make reset` rebuilds the database and restarts the demo at Oct 1, 2026. No API key is needed: without `ANTHROPIC_API_KEY`, Recoup runs on the keyword rules.

## Before you open a pull request

```bash
make check   # ruff, mypy (strict), pytest, and the frontend type check and build
```

CI runs the same steps against SQLite and Postgres 16, plus three drift checks. If you changed any of these, regenerate and commit the result:

| You changed | Run | CI compares |
|---|---|---|
| A model in `backend/src/recoup/db/models.py` | `cd backend && uv run alembic revision --autogenerate -m "what changed"` | `alembic check` |
| The generator in `backend/src/recoup/synth/` | `make data` | `data/synthetic/` |
| A detector, an extractor or the evals | `make eval` | `backend/evals/results/` |

For a UI change, also run the end-to-end path: `make reset`, then `cd frontend && npm run e2e`.

## How we work

- **Tests first.** Write the failing test, then the code. A bug fix starts with a test that reproduces it.
- **One ADR per decision.** If a change makes a choice someone could reasonably have made differently, add the next numbered record to [`docs/adr/`](docs/adr/README.md) with Status, Context, Decision and Consequences, and add it to the index.
- **Conventional commits.** `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`, `ci:`, with an optional scope such as `feat(api):`.
- **Branches and pull requests.** Branch from `main` (`feat/…`, `fix/…`, `ui/…`). Work that builds on an open pull request can be stacked on its branch; retarget it to `main` once the base merges. CI must be green before merging.
- **Small pieces.** Files of a few hundred lines, functions under about 50, no mutation of shared data.

[`docs/architecture.md`](docs/architecture.md) shows how the packages fit together.

## Rules that do not bend

These are what make Recoup safe to point at real books. A change that weakens one needs its own ADR.

- The model reads; code decides. Model output is used only after `extract/validate.py` or `extract/contract_gate.py` has checked it.
- No message is sent without a person's explicit approval. Recipients come only from the vendor directory.
- The chat agent has no tool that sends, edits or dismisses, and its tool results carry no email, contract or draft text.
- Connectors are read-only. Gmail reads with `gmail.readonly`; Ramp uses `transactions:read`. Sending through Gmail is a separate, opt-in scope.
- Secrets stay on the server. Nothing in `frontend/` reads an API key or token.
- Money is integer minor units, never floats.

## Frontend merge guide

The UI is redesigned in rounds on its own branch. These boundaries keep a design merge from changing behaviour.

### Where things live

| Path | What it is |
|---|---|
| `frontend/src/api.ts` | The only API client. Its types mirror `backend/src/recoup/api/schemas.py` and are the contract with the backend. |
| `frontend/src/index.css` | Every colour, radius and font, as tokens that Tailwind reads through `@theme`. |
| `frontend/src/theme.ts` | Plain-language labels for leak types, outcomes and statuses. |
| `frontend/src/components/` | Shared components and the Overview, Queue and TopBar screens. |
| `frontend/src/components/case/` | The case view: evidence, citations, draft editor, confirm sheet. |
| `frontend/src/components/setup/` | The Setup page, one file per step. |
| `frontend/src/components/kokonutui/` | Vendored components (slide to confirm, smooth tab). Restyle through tokens; avoid editing in place. |
| `frontend/src/hooks/` | Data loading and the hash router (`useHashRoute.ts`). |
| `frontend/e2e/recoup.spec.ts` | The Playwright path through the UI. |

### What a design pull request must not change

- **API types and calls** in `api.ts`. If a design needs new data, that is a backend change with its own pull request.
- **Routes.** `#/overview`, `#/claims`, `#/claims/<id>` and `#/setup` are used by the README and the e2e spec.
- **The approval step.** Sending goes through the confirm sheet and posts `{"confirm": true}`; the recipient shown is the one the API returned.
- **Selectors the e2e spec relies on**, unless the spec is updated in the same pull request.
- **Unused code and packages.** Add a package or a vendored component in the commit that first imports it, and remove it when its last import goes.

### Merge checklist

1. Merge `main` into the design branch first, and resolve conflicts there.
2. `cd frontend && npm ci && npm run build`
3. `make reset`, then `cd frontend && npm run e2e`
4. `make check` from the repo root
5. Update the README where it describes the UI: the demo steps, the confirm step under Safety, and the `frontend/` line in Project layout.
6. Leave `frontend/package-lock.json` out of the commit unless `package.json` changed.
