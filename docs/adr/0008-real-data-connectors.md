# 0008. Real data: Ramp transactions and public status pages

**Status:** Accepted

## Context
Synthetic data proves the rules do what we intended, not that they work on real inputs. Two real sources are within reach: Ramp's Developer API for the ledger, and the public Statuspage feeds vendors publish for outages. Both come with limits a claim has to respect.

## Decision
- **Status pages are read per component.** Each incident's timeline becomes spans of downtime for the components an SLA covers. `major_outage` is an outage, `partial_outage` is partial, and degraded performance is not downtime. Maintenance, unresolved incidents, and incidents with no component data are skipped, so missing data can only understate what is owed.
- **Only vendors with a published numeric SLA are included:** Jira and Confluence (Atlassian, monthly) and GitHub (quarterly). Slack is left out because its public SLA states no uptime number. GitHub Actions and Packages are left out because GitHub measures them by failed executions, which a status page cannot show.
- **Public evidence is never Recoverable.** A status page can't prove this customer was hit (the September Jira outage was US East only), and published terms may differ from their order form. Open cases are Needs review, and the case says what to confirm.
- **A period is judged once it has ended, on what was known by the clock date.** A case is identified by vendor and period, so a later incident updates it rather than opening an overlapping one.
- **Stored rows build the history.** Feeds return only recent incidents, so each sync keeps what it has seen. A failed feed keeps its last good data and doesn't stop the others.
- **Ramp is read-only and least-privilege:** client credentials with only `transactions:read`, posted transactions only, and the token is never sent to a host other than Ramp's, whatever a response says the next page is.
- **A recorded snapshot of the real feeds** lets the demo run without network access. Its data is real but frozen, and sync runs record which origin was used.

## Consequences
- Demo invoices for Atlassian are fictional and carry `source=demo-invoices`, so real outages have a bill to price against. Only the outages are real.
- A bundled Atlassian invoice needs splitting by product, since credits are a share of the affected product's fees. Today each product is matched as its own merchant.
- The Ramp connector is tested against the shapes in Ramp's published OpenAPI spec. It needs a run against a real sandbox before anyone relies on it.
- Open disputes in Ramp's `disputes` field are not yet read, so a charge already being disputed could still be flagged.
