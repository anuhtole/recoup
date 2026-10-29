# 0004. Discrete outcomes, not confidence scores

**Status:** Accepted

## Context
A score like "0.82 likely duplicate" pushes the hard decision onto the reviewer without telling them what to check. Finance teams act on clear states and an audit trail.

## Decision
Each finding has exactly one outcome:
- **Recoverable:** the evidence is sufficient to ask for the money back (for example, the same order reference was charged twice).
- **Needs review:** something is suspicious but a fact is missing, and the reason says which one.
- **Not recoverable:** a real leak, but past the dispute window or otherwise closed.

Each outcome comes with a written reason, cited evidence, and a recover-by date. Every change is appended to `audit_events`.

## Consequences
- Evals can measure outcome accuracy, not just detection.
- *Needs review* is a first-class state in the UI, styled as routine rather than as an error.
- Thresholds live in configuration as explicit hard stops, such as the minimum amount and the window, rather than hiding inside a score.
