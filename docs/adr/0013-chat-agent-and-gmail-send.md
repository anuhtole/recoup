# 0013. A chat agent that can look and draft but not send; approved mail goes out through Gmail

**Status:** Accepted. Narrows [0001](0001-workflow-not-agent.md) and completes the sending step [0009](0009-connector-interface.md) left for later.

## Context
A finance person does not think in queues and tabs. They ask "what are we owed?", "which of these are urgent?", "draft the requests". Answering that takes a model that chooses which of Recoup's operations to run, which is the agent loop ADR 0001 ruled out. The reason it was ruled out still holds: Recoup holds private financial data, reads untrusted text, and can send mail. A model with tools in the middle of those three is how a crafted email turns into a message to an attacker.

Separately, an approved request only went to a local outbox, so nothing reached a vendor.

## Decision
- **Detection stays a fixed workflow.** `pipeline/run.py` is unchanged and no model chooses its steps. The agent is a second way to reach the same operations the UI already calls.
- **The tool list is the boundary** (`agent/tools.py`). Six tools: `get_overview`, `list_connections`, `connect_gmail`, `run_scan`, `list_cases`, `draft_request`. There is no tool that sends, edits, or dismisses, and a test fails if one is added without changing it. A call to anything else is refused and audited.
- **The agent drafts; a person sends.** `draft_request` creates the same draft the Draft button does, addressed from the vendor directory. Sending is still `POST /api/drafts/{id}/send` with `{"confirm": true}`, which the model cannot call.
- **Tool results carry no email, contract or draft text.** They are built from ids, amounts, dates and states, so the usual injection path (text in, instruction followed) is closed by construction, not by prompt wording. The one free-text field is the vendor name, which can come from a card descriptor: it is reduced to letters, digits and basic punctuation and cut to 40 characters.
- **The agent does not redraft.** If a case already has an open draft, `draft_request` returns it untouched, so the agent cannot overwrite a person's edits.
- **The conversation is plain text from the person.** The chat endpoint accepts only `user` and `assistant` strings and must end on a `user` turn, so a caller cannot forge a tool result.
- **The loop is bounded** to six model turns per message (`agent/loop.py`), a scan runs at most once per message and never alongside a running sync, and every tool call is written to the audit log as `agent:chat`. Each call runs in a savepoint and is committed on its own, so a failing tool changes nothing and earlier work in the same turn is kept.
- **Consent is not delegated.** `connect_gmail` returns the link for the person to open; the agent cannot grant access.
- **Gmail sending is opt-in and narrow** (`recovery/gmail_outbox.py`). With `RECOUP_GMAIL_SEND=true`, consent also asks for `gmail.send`, and an approved vendor email is sent from the company's mailbox to exactly one recipient. A subject or address with a line break, or more than one address, is refused. Card dispute packets stay in the local outbox.
- **A send is never repeated by Recoup.** The draft is claimed and that claim is committed before Gmail is called, and a failed send is never retried. If Gmail refuses the message, the draft goes back to "draft". If Gmail stops answering mid-send, the message may have gone out, so the draft stays "sending" and cannot be approved again; the person checks Sent and, if it is not there, drafts the request again.

## Consequences
- Recoup now has one place where a model decides what happens next. What it can decide is limited to reading Recoup's own records, re-running detection, and preparing a draft for review.
- The worst a hijacked agent can do is create drafts nobody asked for and re-run a scan. Both are visible, audited and reversible, and neither sends anything.
- The agent cannot explain a case's evidence in its own words, since it never sees the quotes. It points the person to the case view, where the evidence is shown with citations. That is a real limit on how helpful it can be, taken on purpose.
- The agent is tested against a scripted model, including one that tries to send and to reach tools that do not exist. It has not yet run against the live Claude API, and Gmail sending has not yet run against a real mailbox.
- Turning sending on means connecting Gmail again, since the earlier consent did not include `gmail.send`.
- An ambiguous send needs a person to look at Sent. Recoup does not guess, and prefers a request that was not sent to one sent twice.
- **The API still has no login.** That was acceptable when nothing left the machine. With `RECOUP_GMAIL_SEND=true`, anyone who can reach the port can approve a send from the company's mailbox, so sending must only be turned on where the API is bound to localhost (the default) or sits behind authentication. Adding login, and taking the approver from the session, comes before any shared deployment.
- The chat endpoint has size limits but no rate limit, so on a shared host it could be used to spend the Claude budget. Same condition as above.
