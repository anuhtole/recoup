# Recoup · Ink and mint redesign spec

Branch: `ui/ink-and-mint`. Replaces the Pine and stone look and the current two-page layout. Every existing feature stays (see "Feature inventory"). Frontend only, except where noted.

## Intent

A premium finance tool that feels as considered as Stripe, Ramp, Robinhood and Link, wearing Spade's retro-modern system: mono record labels, dashed field boxes, tiny radii, dark data panels, a warm announcement strip. One accent, mint, which always means money coming back or the one action to take. Restraint over decoration (Robinhood removed its own confetti; we celebrate with a quiet number roll).

## Research → decisions

| Source | Pattern (verified unless marked) | Recoup decision |
|---|---|---|
| Stripe | Home → List → Detail; detail is its own route with breadcrumb and a two-column body (narrative left, facts sidebar right); selected tab in the URL | Claims list is a full-width table; a case opens at `#/claims/<id>` with breadcrumb and two-column body; filters in the hash |
| Stripe | Disputes: "respond by" deadline is decisive (missed = auto-lose), evidence checklist, final irreversible submit with an acknowledgement | Case sidebar leads with the Respond-by countdown; send review states "can't be edited after sending" |
| Stripe | Overview as primary + secondary columns of titled modules; empty states with an action and a different message when filtered; loading inside the content so chrome stays still | Overview: left = hero + breakdowns, right = "Needs action" + "Sources" modules |
| Stripe | Small fixed status vocabulary on one hue scale (positive / warning / negative / neutral) | Status pills: mint = money/positive, amber = urgent/needs review, neutral = waiting, muted = closed |
| Ramp | Inbox = "assigned to me, actionable", separate from the full list; status sub-tabs with counts | Claims "To do" is the inbox; segmented sub-tabs with counts: To do · Waiting · Done · Window closed |
| Ramp | Grouped sections that dissolve when you sort/filter; checkboxes with a floating bottom bulk bar; "Search or filter…" single bar | Search field filters vendors/references; row checkboxes + bottom bulk bar with "Draft requests" and "Dismiss…"; sending always stays one review per case |
| Ramp | Detail page activity feed shows the system's rationale and cited rules; disclose why ("2 of 3 checks matched") | "How Recoup found this" block lists the rule checks; History is an activity feed |
| Robinhood | One hero figure, delta line beneath, chart directly under it with no gridlines; colour only for money movement | Overview hero: `READY TO CLAIM` figure 64px, delta line ("+$480 recovered since Oct 1"), recovery chart under it from summary snapshots |
| Robinhood | Review → swipe/slide to submit; primary button carries live context ("Buy · $x") | Primary button reads "Send to billing@figma.com · $480.00"; review sheet → slide to send with keyboard fallback |
| Link | One activity feed, one detail per item with one primary action; timelines stated up front; approval card (merchant, item, amount, method, Approve/Decline) | "Recovered" activity view grouped by date; send sheet is an approval card |
| Spade | Mono uppercase labels (11px, .09em), dashed field boxes, 2–6px radii, dark bands, warm strip, grotesk + mono, tick-mark rules | The visual system below |

## Visual system (tokens)

Colour (light content, ink chrome, one accent):
- `--ink #0A0B0A` text · `--panel #0E100F` dark surfaces (sidebar, data band, selected row, next-step panel) · `--panel-2 #171A18` raised dark · `--rule #2B302D` lines on dark
- `--paper #FFFFFF` content surface · `--ground #F3F5F3` app background · `--line #E2E5E2` hairlines · `--dim #5F6862` secondary text on light · `--sub #9AA59F` secondary text on dark
- `--mint #9BF0C8` accent on dark (money, active nav, primary fill) · `--mint-ink #0F7A52` mint for text/numbers on white (AA ≥ 4.5) · `--mint-wash #E6FBF1` tint
- `--amber #F2B04B` announcement strip and urgency on dark · `--amber-ink #8A5A00` urgency text on white · `--danger #B4372E` errors only

Type: Geist (UI, headings) + Geist Mono (labels, references, IDs, table dates). Scale 11 (mono labels) / 13 / 14 / 16 / 20 / 28 / 44 / 64. Headings −0.02 to −0.03em. All money `tabular-nums`. Wordmark recoloured: white "ecoup" with mint arrow-R on the ink sidebar (regenerate from `frontend/public/brand` source with the same script approach).

Shape and space: 4px grid; radii 2 (chips, fields), 4 (buttons, rows), 6 (cards, panels); no resting shadows; one shadow for floating sheets.

Spade elements, used deliberately:
- Mono uppercase label above every value (`READY TO CLAIM`, `REFERENCE`, `RESPOND BY`).
- Dashed field boxes for raw record fields in evidence.
- Tick-mark rule down the left edge of the Overview hero.
- Warm amber strip at the top of the content area: `DEMO DATA · AS OF OCT 1, 2026` (live: `LIVE DATA · SYNCED 2 MIN AGO`).
- Ink data band for the key numbers.

## Layout

### App shell
- Left sidebar 240px, ink panel: wordmark; nav with mono counts — Overview, Claims (15), Recovered, Sources — active = mint text + 2px mint bar; footer: environment (Demo/Live, as-of), sources status dot, and in demo mode a "Demo controls" group (Run detection, Advance 2 weeks).
- Content on `--ground`, max width 1200, page header: mono breadcrumb, title, right-aligned page actions.
- <900px: sidebar becomes a top bar + menu sheet; bottom tab bar (Overview, Claims, Recovered, Sources).

### Overview `#/overview`
- Hero (paper, tick-mark edge): `READY TO CLAIM`, figure 64px, delta line, urgency sentence; primary "Review 15 claims" top-right; recovery chart under it (snapshots per demo date; single point → flat baseline with "Chart fills in as money comes back").
- Ink data band: Ready · In flight · Recovered (mint) · Missed, with the mint progress bar.
- Two columns (2fr / 1fr): left "Where it comes from" + "Top vendors"; right "Needs action" (top 5 by deadline, amber `1 DAY` tags) + "Sources" (status dot, last sync, Sync now).

### Claims `#/claims`
- Sub-tabs with counts, search field, type chips — all in the hash.
- Table: checkbox · Vendor (initial tile, name, mono reference) · Type · Amount (right) · Respond by (mono date + days; ≤3 amber) · Status pill. Rows 56px, hover tint, focus/selected row ink with mint amount. j/k/arrows move, Enter opens, x selects.
- Bulk bar (floating, ink) when rows are selected: "Draft requests" (creates drafts only), "Dismiss…" (one reason for all), count, clear.
- Window closed tab holds the closed-window cases.

### Case `#/claims/<id>`
- Breadcrumb `CLAIMS / FIGMA`, prev/next arrows, Esc back to list.
- Main (1.6fr): header (vendor, type, 44px amount, status pill); reason with citations; "How Recoup found this" (rule checks); Evidence record cards (dashed fields) + price comparison + status-page treatment; draft editor when drafting; Correspondence; History activity feed (collapsed).
- Sidebar (1fr, sticky): Respond-by countdown block; Facts (status, reference, vendor, found on); Next step ink panel with the one mint action and "Not owed, dismiss".

### Send
- "Review request" opens the approval sheet: recipient large, amount, reference, channel, the letter preview, "Can't be edited after sending", slide-to-send (mint on ink) with keyboard fallback. Still posts `{"confirm": true}`.

### Recovered `#/recovered`
- Activity feed grouped by date: recovered (mint), vendor agreed, sent/in flight; totals at top; each row opens its case. Existing data only.

### Sources `#/sources`
- Page version of the Sources sheet: rows per source, status, environment, last sync, result, setup help with copy; "Sync now" primary.

## Feature inventory (must all survive)
Overview totals + urgency · needs-action list · by-type breakdown · top vendors · progress/recently recovered · claim stages incl. closed-window · keyboard nav · case detail: citations, email-source sheet, evidence, price comparison, status-page outage treatment, correspondence, history · draft/edit/save · review + slide-to-send with confirm gate · dismiss with reason · card-dispute escalation · run detection · advance 2 weeks (demo) · notices · sources status/panel/sync/setup help · demo/live tag · hash routing + deep links · reduced motion/transparency/contrast · phone layout.

## Quality bar
Taste lint 0 FAIL; zero console errors; AA contrast everywhere; one primary action per screen; nothing clipped or overlapping at 1440 / 1024 / 768 / 390; Lighthouse a11y ≥ 95; e2e passes after `make reset`; `make check` green.
