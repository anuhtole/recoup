# Recoup · Ink and mint v2 ("real product" pass)

Branch `ui/ink-and-mint-v2` (worktree `~/recoup-v2`), built on tag `ink-v1`. Same palette and every feature from `docs/design/ink-and-mint.md`; this pass removes what makes v1 read as AI-generated and adds what makes software feel shipped. Benchmarks: Stripe Dashboard, Ramp, Mercury, Linear. Frontend only.

## The diagnosis being fixed (v1 → v2)
1. **Ornament without meaning** — tick-mark ruler, 30-square countdown, dashed box around every field, black numbered squares. → Delete all of them. Spade's retro flavour survives only in: the ink sidebar, mono for machine identifiers, and tabular figures.
2. **Every number repeated** — $13,710.09 appears 3× on Overview and again on Claims. → Each figure has exactly one home per screen.
3. **Empty state in the hero** — "Nothing back yet", "Chart fills in…", big $0.00 boxes. → Hero is the actionable queue. Zeros render as muted "—" small. Chart only renders with ≥2 real points, otherwise it is absent (no placeholder).
4. **Card soup** — every section a bordered card on grey. → Content canvas is flat white (`--paper`). Sections are separated by space (40–48px) and a section header (14px/600 title, optional right-side meta, hairline beneath). Borders only on tables and the right rail block on Case. Floating things (sheets, menus, palette, bulk bar) get the shadow.
5. **Mono everywhere** — → Mono ONLY for references/IDs, transaction ids, card last-4, and keyboard hints (`⌘K`, `/`). Labels become 12–13px sans, `--dim`, sentence case ("Respond by", not `RESPOND BY`). No breadcrumbs on top-level pages; Case keeps a sans breadcrumb "Claims / Figma".
6. **Developer copy + over-explaining** — "1 day(s) apart (window: 3 days)", "DUPLICATES/1", "Fewest days left", helper sentences under everything. → Plain, confident voice. Delete any helper sentence unless it prevents a mistake (the send sheet's "This can't be edited after it's sent" stays). Never show rule ids, pluralise correctly, no parentheses jargon.
7. **Placeholders** — letter tiles, a Status column empty in 14/15 rows, a huge Vendor gap. → Real vendor logos (see below); Status column only where it varies (Waiting/Done/Window closed tabs); on To do a small inline "Needs review" tag beside the vendor name. Fixed, sensible column widths.
8. **Missing product scaffolding; demo tooling in prime space** — → Add org switcher, ⌘K command palette, user menu, export, row counts. Remove the full-width amber strip and the sidebar demo-controls block (see Shell).
9. **Unfinished money styling** — pale mint primary button, flat figures. → Primary buttons are solid ink (`--ink` bg, white text, 4px radius, 36px tall; 40px for the page's main CTA). Mint is reserved for money-coming-back figures/indicators and the final slide-to-send (mint on ink). Hero figures render cents smaller and dimmer (`$13,710` + `.09` at ~55% size, `--dim`).

## Shell
- **Sidebar (ink, 232px):** top = org switcher button: Recoup mark + "Acme Inc." + chevron, with a small "Demo" pill when `data_mode === "demo"`; menu shows the org (only one) and "Data: Demo / Live" read-only. Nav: Overview, Claims (count), Recovered, Sources (status dot instead of "1/3"). Bottom: a quiet sources line ("Ledger synced · Oct 1") and nothing else.
- **Top bar (content area, 56px, white, hairline bottom):** left = page title (20px/600) — pages don't repeat an H1 below it; right = search trigger button ("Search…" with `⌘K` kbd), Demo menu button (only in demo mode; contains Run detection, Advance 2 weeks, and the as-of date "Viewing Oct 1, 2026"), help icon (popover with keyboard shortcuts), user avatar "JG" menu (name "Jackson", "Keyboard shortcuts"). No dead links: every item does something.
- **⌘K palette** (also `/` on Claims focuses search): fuzzy search over cases (vendor, reference, amount), pages, and actions (Run detection, Advance 2 weeks, Export claims). Arrow keys + Enter, Esc closes. Uses the existing Sheet/floating styles.
- Phone (<900px): top bar with menu + search; bottom tab bar stays.

## Vendor logos
Add `simple-icons` (pinned exact version) and a `VendorLogo` component: map vendor display names → simple-icons slugs (Figma, Slack, Lyft, WeWork, Amazon Web Services→amazonwebservices, Loom, Zoom, United Airlines→unitedairlines, etc. — cover every vendor in the demo data; check `/api/cases`). Verify each slug exists in the installed version. Render the brand SVG in its brand colour on a 28px white tile with a hairline (20px in dense lists). Fallback (e.g. "Sq *Joes Catering"): monogram on a deterministic neutral tint from a 6-colour token set, never plain black-on-grey. Strip processor prefixes like "Sq *" from the display name.

## Overview
- Top bar title "Overview". "Export" (CSV of open claims, client-side) as a secondary button. No period control unless it truly filters.
- **Hero row (no card):** label "Open claims" → figure 56px with dim cents → one line: "15 claims · 1 expires tomorrow" (the second part amber-ink with a small amber dot). Main CTA "Review claims" solid ink, right-aligned. Below: an inline stat line — "In flight —  ·  Recovered —  ·  Missed $1,432.73" in 13px, figures tabular, recovered in mint-ink when > 0.
- Chart: recovery chart only when ≥2 snapshot points; minimal, no gridlines, mint line.
- Two columns (3fr/2fr) below:
  - Left: "Expiring soon" — compact table (logo, vendor, type, respond by, amount), top 5, "View all" link to Claims.
  - Right: "By type" — rows with name, count, amount, and a thin inline proportion bar per row. Then "Top vendors" with logos.
- Delete the black data band.

## Claims
- Title in top bar. One toolbar row: underline tabs with counts (To do · Waiting · Done · Window closed) left; right: "Type" filter dropdown chip (shows selection, e.g. "Type: Duplicates ×"), search input, "Export" secondary button.
- Table: checkbox · Vendor (logo, name, inline tag if needs review; reference mono 12px under) · Type · Respond by ("Oct 2", under it "1 day left" amber-ink if ≤3, else `--dim` "29 days") · Amount (right-aligned, last, tabular). Status column only on non-To-do tabs. Rows 52px, hover `--wash`, keyboard-focus row gets a 2px ink left bar + wash (not a full ink row).
- Table footer: "15 claims" left, "Total $13,710.09" right — the ONE place the total lives on this screen; remove the page subtitle sentence.
- Bulk bar: same behaviour, compact ink bar centred at bottom.

## Case `#/claims/<id>`
- Sans breadcrumb "Claims / Figma" + prev/next + "1 of 15" (sans, dim).
- Header (no card): logo 40px, vendor 20px/600, type tag; amount 44px with dim cents; status tag. Then the reason sentence with citation superscripts (keep the email-source sheet).
- "Why it's owed": checklist in plain language (rewrite rule-check strings in a UI mapping layer — e.g. "Same amount charged twice, one day apart", "No refund has posted", "Both charges are in your ledger"). No "3 OF 3 CHECKS · DUPLICATES/1".
- "Evidence": compact table of source records — Date · Description · Reference (mono) · Amount — with the citation number as a small index in the first cell; contract clauses/emails/incidents/price comparison as simple rows or quotes. No dashed boxes.
- Correspondence, History (collapsed) as plain sections.
- Right rail (sticky, one bordered block, 6px radius): "Respond by · Oct 2, 2026" with "1 day left" amber-ink beneath (no bar); details (Card ···· 4417 mono, Found Oct 1; status is not repeated here: it lives once, as the pill beside the header amount, per "one home per figure"); primary action (solid ink "Draft request" / "Review and send") and a text button "Not owed".
- Send sheet: keep approval-card content, slide-to-send (mint on ink — the one mint control), the irreversible line, `{"confirm": true}`.

## Recovered, Sources
Same flat treatment: top-bar title, section headers, tables/lists with logos, no cards, no mono labels. Recovered empty state: one short line + "Advance 2 weeks" button only in demo mode.

## Type & tokens
- Content background is `--paper`. Add `--tint-1..6` for monograms. Remove `.ticks`, `.field-box` once unused.
- Scale: 12 / 13 / 14 / 16 / 20 / 28 / 44 / 56. Headings 600, −0.01 to −0.02em. Body 14px. One date format: "Oct 2" (same year) in lists, "Oct 2, 2026" in detail rows; sans, tabular.

## Must survive
Everything in `docs/design/ink-and-mint.md` → "Feature inventory", keyboard nav (j/k, Enter, x, Esc), reduced motion/transparency/contrast, phone layout, the confirm gate, e2e passing.

## Decisions after the review pass
- **Rail:** no Status row (see Case above). The pill beside the amount is the status's one home.
- **Search:** ⌘K lives in the sidebar under the org switcher ("Search ⌘K"); the top bar no longer has a search field on wide screens. The Claims toolbar field is "Filter claims" (`/`). Phones keep the top-bar search icon.
- **Claim types:** one map (`frontend/src/lib/claimTypes.ts`), singular for tags and plural for headings and filters from the same noun ("Missing refund" / "Missing refunds").
- **States:** "Window closed" is the one name for a passed deadline (tab, pill, stat line, toasts); "Not owed" is the one verb family for dismissing ("Mark not owed").
- **Logos:** vendors simple-icons lacks (Slack, AWS, Amazon, WeWork, Ramp, Office Depot) use local marks in `frontend/public/logos`; wordmarks that can't be read small (Uber, Zoom) are white on their brand colour.
- **Recovered empty state:** one left-aligned row with "Review claims"; the demo-only "Advance 2 weeks" stays beside it, as this spec's Recovered section asks.
- **Org name:** `Settings.org_name` on the API (default "Acme Inc.") signs every letter and is what the org switcher shows.
