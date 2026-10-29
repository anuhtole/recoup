# 0007. An offline baseline, cached model output, and fallbacks

**Status:** Accepted

## Context
Tests, CI, and teammates' laptops cannot depend on an API key or the network. Model calls cost money and time, and a model can be briefly unavailable.

## Decision
- Every model-backed step has a keyword-rule twin behind the same interface (`PromiseExtractor`, `ReplyClassifier`, `Drafter`). Recoup uses Claude when `ANTHROPIC_API_KEY` is set and the rules otherwise. The UI shows which mode is active.
- Results are cached per (email, extractor name and prompt version). Re-running detection never pays for the same email twice, and changing the prompt version re-reads every email.
- If a model call fails, that email uses the baseline for this run only and is retried next run. Replies are cached even after a fallback, so a reply is applied exactly once.
- Requests opt into server-side fallbacks (`fallbacks: "default"`), so a declined request is retried on Anthropic's recommended fallback model inside the same call.
- The keyword rules double as the baseline that `make eval-claude` compares Claude against.

## Consequences
- The whole product, demo included, works offline. It finds less in that mode: the eval table shows exactly what the rules miss.
- Claude-written drafts are checked in code (amount and every reference present, no addresses or links) and fall back to the template otherwise.
