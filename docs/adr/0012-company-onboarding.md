# 0012. A company plugs in its own data from the Setup page

**Status:** Accepted

## Context
Until now Recoup ran on one company's files: `vendors.json`, `contracts.json` and a ledger loaded by the CLI, with "Northwind Labs" written into every draft. A finance team trying Recoup has a card export, an inbox, and a folder of order forms, not JSON. Most teams are not on Ramp, so a ledger API alone would leave them out.

## Decision
- **Five steps, in the order that makes the next one useful.** `GET /api/setup` returns company, ledger, vendors, mail and contracts, each with whether it is done and what to do. The Setup page (`#/setup`) renders that list.
- **The company profile is data.** The name and card dispute address live in the `state` table. Drafts are signed "<name> Finance" and card disputes go to that address.
- **Ledgers arrive as CSV first.** Every bank, card and accounting tool exports CSV, so it is the one format every customer has. `csv_ledger.py` finds the date, merchant and amount columns (or debit and credit), reads US and day-first dates and parenthesized negatives, and guesses which sign is a charge. The person sees a preview and can remap columns before anything is stored. Rows are keyed by the account and the row's id or reference, so importing the same export twice adds nothing. Ramp stays the API path for teams on Ramp ([ADR 0008](0008-real-data-connectors.md)).
- **Vendors are suggested, never guessed into a recipient.** Merchants on the ledger that Recoup does not know are listed by spend, with the mail domains they write from. The billing address Recoup writes to is always typed by a person, never taken from an email ([ADR 0006](0006-human-approval-and-ledger-truth.md)).
- **Stored setup wins over files.** Vendors and contracts saved in Recoup go to the `vendors` and `contracts` tables and override bundled entries with the same key. Sources are built per request, so a change applies on the next call without a restart.
- **Contracts are read, then confirmed.** An uploaded PDF goes through the contract reader and its grounding gate ([ADR 0011](0011-contract-reader.md)). The API returns the proposed terms and saves nothing until the person saves them.
- **Gmail connects from the browser.** `GET /api/connect/gmail` starts Google's consent with PKCE and a one-time state. The callback stores the refresh token in the server's `.env` and never sends it to the page. The scope is still `gmail.readonly`.
- **A row's identity never comes from the filename.** Uploads share the `csv` source unless a person names an account, and the card's last four digits are part of the row fingerprint. Before an import, each row is matched against other sources (same merchant, amount and currency, posted within a day, no conflicting reference or card) and matches are left out by default. Otherwise two exports of the same card, or a Ramp sync plus an export, would store each charge twice and Recoup would ask vendors for refunds it isn't owed.
- **Weak guesses are shown, not hidden.** The charge sign is guessed by value, not row count, with card bill payments left out, and a running-balance column means a bank account. The date order is decided by any unambiguous row in the file. When either guess is weak, the preview asks the person to check it.
- **Uploads are JSON.** CSV goes as text and PDFs as base64, which keeps multipart parsing out of the dependency list. Files are capped at 5 MB (CSV) and 10 MB (PDF).

## Consequences
- One Recoup deployment is one company. Several companies on one server would need tenant ids on every table and real sign-in; that is out of scope for now.
- Pending Gmail consents are kept in memory, so a server restart in the middle of consent means clicking Connect again.
- CSV detection covers common exports. An unusual layout falls back to the column picker in the preview, not to a guess.
