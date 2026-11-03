# 0010. Price overcharges against the order form

**Status:** Accepted

## Context
Ramp already benchmarks what a company pays against what similar companies pay. That says a price is high, not that the vendor owes money back. An order form that fixes a price, or caps how far it can rise, does make the difference owed, and it is the same kind of claim Recoup already makes for outage credits: a contract term, a ledger line, and a recovery request.

## Decision
- **Contracts carry an optional price.** `price_minor`, `price_currency`, `price_locked_until` and `price_increase_cap_bp`, plus the clause quoted back to the vendor. A contract without a price is never checked, so SLA-only contracts are unchanged and no migration is needed.
- **The allowed price is a rule, not a model judgment.** The contracted price while locked (or for the whole term when there is no lock date). After the lock, the price plus the cap. After the lock with no cap, nothing is flagged.
- **One charge per vendor per month is priced:** the first. A second charge in the same month is a duplicate, and the duplicate detector owns it, so one charge is never claimed twice.
- **A credit already given clears it.** A later credit at the vendor of exactly the overcharge, or of the whole charge, removes that month from the case.
- **One case per contract, and it grows.** The identity is the vendor and plan, so each new month billed high updates the open case instead of opening another. The claim is the sum of the open differences. Charges past the card dispute window drop out.
- **Outcomes follow the existing pattern.** Recoverable at or above the minimum amount. Needs review when the contract is marked as needing the customer to confirm the terms.

## Consequences
- Prices must be entered per contract until the contract reader (roadmap) fills them from the PDF.
- Per-seat and usage-based plans are not priced yet. A seat increase looks like a price increase, so those contracts should not get a fixed `price_minor` for now.
- The synthetic world plants one positive (Figma raising a locked price) and two hard negatives (Linear rising within its cap after the lock, and GitHub crediting an overbilled month on its own).
