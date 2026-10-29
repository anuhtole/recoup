# 0006. A person approves every message; only the ledger closes a case

**Status:** Accepted

## Context
A recovery request is outward-facing and hard to take back. "The vendor said yes" is not the same as money back.

## Decision
- **Approval gate.** Recoup drafts, a person approves. The send endpoint requires `{"confirm": true}`, which the UI sends only from its confirmation dialog. The approver and recipient are written to the audit trail.
- **Recipients from code.** The vendor directory supplies the address. Vendors not in the directory, and vendors that decline, get a card-dispute packet to the issuer instead.
- **Ledger truth.** A case becomes `recovered` only when a matching credit (same vendor, exact amount, after the request) appears in the card feed. Each credit closes at most one case.
- **Outbox abstraction.** `LocalOutbox` records the message and assigns a Message-ID. A Gmail outbox would plug in behind the same approval step with a send-only scope.

## Consequences
- The "Recovered" number on screen is money actually returned, not money promised.
- Partial credits do not close a case yet. That is deliberately conservative and tracked on the roadmap.
