# 0014. The demo conversation is scripted; everything it does is real

**Status:** Accepted. Sits beside [0013](0013-chat-agent-and-gmail-send.md) until the live agent is behind the Agent page.

## Context
The demo is a conversation: ask what the company is owed, connect Gmail, scan, draft the urgent requests, send them, and come back two weeks later. The chat agent in ADR 0013 can hold that conversation, but it has not run against the live Claude API, and a recorded demo has to say the same thing on every take. A demo that fakes its numbers, though, would show a product that does not exist.

## Decision
- **Script the words, not the work.** The Agent page matches what is typed against a fixed list of lines (`frontend/src/demo/script.ts`) and decides which line comes next (`flow.ts`). It contains no figures: every amount, count and vendor name is read from `GET /api/summary` and `GET /api/findings` (`facts.ts`).
- **Every action is the real one.** The scan runs `run_pipeline`. Drafting calls `POST /api/findings/{id}/draft`. The slide to send calls `POST /api/drafts/{id}/send` with `{"confirm": true}` once per draft, so the rules in [0006](0006-human-approval-and-ledger-truth.md) hold in the demo as they do anywhere else. Typing "send" sends nothing: only the slide does.
- **Stage what needs an outside account.** `POST /api/demo/connect` marks Gmail as connected without a Google sign-in, and the synthetic ledger stands in for Ramp (`demo/staging.py`). "Two weeks later" is the simulated vendor inbox from before: it writes replies and posts credits, and cases still close only through `match_recoveries`.
- **Keep the demo away from real data.** The demo routes answer 404 unless `RECOUP_DEMO_MODE=true`. The reset deletes every row, so it refuses when the ledger holds anything that did not come from the synthetic feed. The optional replay of past claims (`demo/history.py`) always uses the local outbox, because nobody approves those messages.

## Consequences
- The demo cannot drift from the product: `frontend/e2e/demo.spec.ts` types the whole conversation and checks each figure against what the API returned.
- Off-script questions get "I can't do that in this demo yet". The Agent page does not call `POST /api/agent/chat`; swapping the script for the agent is the next step, and the page's actions already run the same operations the agent's tools call.
- The page says "Ramp is connected" and "Gmail is connected" about staged connections. The README says so, and says the real connectors have not run against live accounts.
