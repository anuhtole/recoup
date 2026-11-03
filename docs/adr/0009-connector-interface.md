# 0009. One connector interface, read-only Gmail, background sync

**Status:** Accepted

## Context
Any team should be able to point Recoup at its own ledger and mailbox and have it run on that data as it arrives. Detectors already read only domain types (`Transaction`, `Email`, `Vendor`, `Contract`, `Incident`), so a new source has to map into those types and nothing else. Until now, each source was wired into the CLI and API on its own, and email came from synthetic files.

## Decision
- **A connector is a small protocol:** a `key`, a `kind` (ledger, email or status), `is_configured`, and `sync(session)`, which writes domain rows. Ramp, Gmail and status pages all implement it. Adding a source means writing one connector, with no change to detection.
- **One failing connector never stops the others.** A connector reports an expected failure as `ConnectorError`, whose message is safe to show. Any other exception is a bug and is not swallowed.
- **Gmail is read-only and narrow.** It asks only for the `gmail.readonly` scope, uses the loopback OAuth flow with PKCE and a checked state, and stores the refresh token in `backend/.env` with owner-only permissions. It searches only mail from vendor directory domains, so personal mail is never downloaded.
- **A From line is not proof.** A message is stored only when Gmail's own topmost Authentication-Results header (from `mx.google.com`) shows DMARC or DKIM passing, aligned with the sender's domain. Headers further down came with the message and are ignored. Attachments are never read. Message text remains untrusted input to extraction, as with every email.
- **Sync is incremental and safe to repeat.** Gmail keeps a cursor with a one-day overlap, and message ids decide what is new. A pull that hits the message cap does not move the cursor, so nothing is skipped.
- **Background sync runs every connector and then detection, as one unit of work.** Only one cycle runs at a time: a timer cycle and `POST /api/sync` take the same lock, and a second request gets a 409. It is off by default (`RECOUP_SYNC_INTERVAL_MINUTES=0`). `recoup watch` runs it from the CLI.
- **Sending is unchanged.** Drafts still go to the local outbox behind explicit approval, and recipients still come only from the vendor directory.

## Consequences
- Each Google account owner creates their own OAuth client and adds themselves as a test user. Recoup ships no shared Google credentials.
- Vendors that send mail without DMARC or DKIM alignment are skipped and counted as `unverified_sender`, so their replies need manual entry.
- The Gmail connector is tested against the Gmail API's documented response shapes. It has not yet run against a real mailbox.
- Polling, not push. Gmail's Pub/Sub push and Ramp webhooks would cut latency, but they need a public endpoint, which the demo does not have.
