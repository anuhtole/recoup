# 0001. A fixed workflow, not an autonomous agent

**Status:** Accepted

## Context
"Agent" is the obvious framing for an AI product that finds and recovers money. But the core decision here, *is this charge owed back to us?*, has a right answer that can be checked. A loop that lets a model choose its next tool trades away testability and predictable cost, and it buys flexibility we do not need.

## Decision
Recoup is a fixed pipeline: ingest → read inbox → detect → record → review → draft → approve → match credits. Detection is deterministic code. The model is used only where the input is unstructured language: extracting vendor promises, classifying vendor replies, and polishing the draft. Each model call is one structured-output request with no tools, and code validates the output before use (ADR 0005).

## Consequences
- Every finding can be reproduced and unit-tested, and the eval harness grades it.
- Cost and latency are bounded per transaction.
- Adding a leak type means adding a detector function, not re-prompting an agent.
- If we later need open-ended investigation, for example chasing an invoice across several systems, it can be a bounded step inside the pipeline rather than the pipeline itself.
