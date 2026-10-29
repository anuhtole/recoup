# 0003. Money as integer minor units

**Status:** Accepted

## Context
Floats cannot represent most decimal amounts exactly, so `0.1 + 0.2 != 0.3`. In a product whose output is "you are owed $X", a rounding error is a correctness bug with a dollar sign on it.

## Decision
Every amount is an integer count of the currency's minor unit (cents for USD, whole yen for JPY), stored as `BIGINT`. `Money` pairs the amount with an ISO currency code and refuses to add mismatched currencies or parse excess precision. Debits are positive and credits are negative.

## Consequences
- Exact equality is safe, and the duplicate detector depends on it.
- Formatting happens only at the edges (the API reason text and the UI).
- Multi-currency conversion is out of scope. Findings never mix currencies.
