# 0005. The model reads; code decides

**Status:** Accepted

## Context
Vendor email is where refund and cancellation promises live, and only a language model reads it reliably. Email is also untrusted input written by outsiders. Recoup can draft outbound mail, so it has all three legs of the "lethal trifecta": private data, untrusted content, and a way to communicate out. A prompt is not a security boundary.

## Decision
Claude returns a typed proposal (`EmailExtraction`) from one structured-output call with no tools. The proposal becomes a `Promise` only if code verifies all of the following (`extract/validate.py`):

1. **Verified sender.** The From domain belongs to a vendor in the directory. When several vendors share a domain, the exact support address decides. In production this check adds Gmail's DKIM/SPF `Authentication-Results` header.
2. **Grounding.** The quote appears verbatim in the email body.
3. **Exact amount.** The amount parses as money and appears inside that quote.
4. **Reference check.** A reference the email doesn't contain is dropped.

Text can only *add* a finding for a person to review. Whether money posted is read from the ledger alone, so no email can make a real leak disappear. Recipients come from the vendor directory, never from model output.

## Consequences
- `tests/test_injection.py` swaps in an extractor that obeys every injection. Even then, a look-alike domain yields no finding, the real Slack duplicate stays open, and nothing is drafted or sent.
- Some true promises are rejected, for example one whose amount is written only in words. They are recorded as `email.rejected` in the audit log rather than silently dropped.
- The same pattern covers vendor replies: a reply's quote must be grounded before it can change a case's status.
