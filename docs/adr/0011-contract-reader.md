# 0011. Claude reads contracts, code checks every term

**Status:** Accepted

## Context
Outage credits and price checks both need contract terms: the uptime target, the credit tiers, the price, the lock date, and the cap. Typing them in by hand is the step finance teams skip, so the money stays unclaimed. Order forms are long and varied, which suits a model, but a contract decides how much Recoup asks a vendor for, so a misread term is a wrong claim.

## Decision
- **Text in, typed terms out.** `recoup contracts read <file>` extracts the PDF's text with pypdf and sends it in one structured-output call (`contracts/1`, `ContractReading`). No tools and no agent loop, as in [ADR 0005](0005-model-reads-code-decides.md). Scanned PDFs with no text layer are refused, not guessed at.
- **The gate sees what the model saw.** Because Claude reads the extracted text, not the file, `contract_gate.py` can check each term against exactly that text:
  - the vendor resolves in the vendor directory (exact name, key or alias, or the one longest name a legal name starts with);
  - each clause appears verbatim;
  - the uptime target and the price are written in their own clause;
  - every percent is written with a `%` sign, so a section number cannot pass for a cap;
  - the lock date is written in the document;
  - tiers sit below the target and their credits grow as uptime falls.
- **Terms fail one at a time.** A bad SLA drops the SLA and keeps a good price, with the reason printed. A document with no surviving term is rejected.
- **Nothing is saved without asking.** The command prints the contract and its notes. Only `--save` writes it to `contracts.json`, replacing the same vendor and plan.

## Consequences
- Grounding proves a term is in the document, not that it is the right one. A crafted document that states a false price in its own text would pass, so a person reviews before `--save`.
- Per-seat and usage-based pricing are not read yet ([ADR 0010](0010-price-overcharges.md)).
- `data/samples/linear-business-order-form.pdf` is a fictional order form for the demo. Tests use a fake model, so CI makes no paid calls.
