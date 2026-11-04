# Recoup UI redesign: glacier liquid glass

Hand this whole file to Claude Code from the repo root on the `ui/glacier-redesign` branch. It is the full brief. Work through it top to bottom.

## Goal

Redesign Recoup's review UI (`frontend/`) so a first-time finance person can tell, within 5 seconds, what is owed, why, and what to do next.

- **Look:** glacier-blue liquid glass.
- **Feel:** minimal, with one obvious action per screen.
- **Scope:** change only the frontend, never backend behaviour.

## Non-negotiables

Keep these exactly:

- **Sending stays human-approved.**
  - A request is sent only after an explicit confirm step.
  - The API call still sends `{"confirm": true}`.
  - The slide-to-confirm control *is* that confirm step. Nothing ever sends automatically.
- **"Recovered" comes only from the ledger.** The UI never shows a case as recovered because a vendor replied.
- **Keep every current capability:**
  - the three tabs, selecting a case, drafting, editing and saving a draft
  - approving and sending, and dismissing with a reason
  - Run detection, and Advance 2 weeks (demo mode only)
  - j/k and arrow keys to move through the queue, Escape to close dialogs
- **Accessibility:**
  - focus is visible everywhere, and dialogs trap focus
  - text over glass meets AA contrast
  - support `prefers-reduced-motion` (cross-fade instead of moving)
  - support `prefers-reduced-transparency` (solid surfaces, no blur)
  - support `prefers-contrast: more`
- **Builds:** `npm run build` passes, and `make check` stays green.

## Setup

Do these in order, and commit after each step.

### 1. Skills

```bash
npx skills add https://github.com/Leonxlnx/taste-skill --skill "design-taste-frontend"
```

```bash
npx skills add emilkowalski/skills --skill apple-design
```

```bash
npx skills add bklit/bklit-ui --skill bklit-ui
```

Also read https://github.com/emilkowalski/skills/blob/main/ui-cheatsheet.md. It's short, and its rules apply throughout.

### 2. Playwright

Add the Playwright MCP server at project scope:

```bash
claude mcp add playwright -- npx @playwright/mcp@latest --viewport-size 1440x900
```

Then, in `frontend/`:

```bash
npm i -D @playwright/test
```

```bash
npx playwright install chromium
```

### 3. Tailwind v4 and shadcn

In `frontend/`:

```bash
npm i tailwindcss @tailwindcss/vite
```

```bash
npm i -D @types/node
```

Then:
- Add the `@/*` → `./src/*` alias in **both** `tsconfig.json` (`baseUrl` and `paths`) and `vite.config.ts` (`resolve.alias`). Neither exists today.
- Add `tailwindcss()` to the Vite plugins.
- Create `src/index.css` containing `@import "tailwindcss";` and import it in `main.tsx`.

Then run:

```bash
npx shadcn@latest init
```

Choose `rsc: false` and the Radix base.

### 4. Components

```bash
npx shadcn@latest add @kokonutui/slide-to-confirm @kokonutui/smooth-tab @bklit/sankey-chart @bklit/sparkline
```

```bash
npm i motion
```

- Replace the demo placeholder text in the Kokonut components (for example "Card ending 4242") with real Recoup content.
- Their `"use client"` lines are harmless in Vite.

### 5. Before screenshots

Run `make dev`, then:

```bash
node <taste-skill>/scripts/inspect.mjs http://localhost:5173 --app --out .taste-skill/before
```

## Why this brief overrides parts of the Taste skill

The Taste skill says to keep the existing stack and bans glows and gradients on app screens. This redesign overrides both on purpose:

- **The styling migration is intended.** Tailwind and shadcn are needed for the Kokonut and Bklit components, and for `:hover` and `backdrop-filter`, which inline styles can't do.
- **The glacier background is the chosen direction.** Skip the skill's direction and palette deal.

Everything else in the skill still applies:
- its app-screen rules
- its lint and inspect gate
- its look loop
- its before-and-after proof

## Design system: glacier liquid glass

### One source of truth

- Every colour, radius, blur amount and font is a CSS variable in `src/index.css`, mapped into Tailwind's theme.
- Delete the hard-coded `#8C3B2E` in `Button.tsx` and `Toast.tsx`.
- `theme.ts` keeps only the label maps (`LEAK_LABEL`, `OUTCOME_LABEL`, `STATUS_LABEL`).

### Tokens

| Token | Day (Glacier) | Night (Night ice) |
|---|---|---|
| Page base | `#e6f1fa` | `#071526` |
| Ice glows (4) | `#bfe3ff` `#8fd3f4` `#e8f6ff` `#c9d7ff` | `#1f6fb2` `#2bb3d9` `#0e3a66` `#4a5fd1` |
| Glass fill | `rgba(255,255,255,.34)` | `rgba(170,215,255,.10)` |
| Glass edge | `rgba(255,255,255,.75)` | `rgba(190,230,255,.28)` |
| Ink | `#0b2340` | `#e6f3ff` |
| Dim text | `#4d6a86` | `#8fb2d1` |
| Accent (primary action, selection) | `#1f7fd1` | `#7cc8ff` |
| Money back | `#0b8a6c` | `#5fe0b8` |

Night follows `prefers-color-scheme: dark`.

The reference mockup is the "Glacier glass" section of the Recoup Look Options artifact.

### Glass

- Use `backdrop-filter: blur(24px) saturate(180%)`, with a 1px light edge and an inner highlight along the top.
- Larger surfaces get more blur and a deeper shadow.
- Never put glass on glass. Rows inside a glass panel are flat tints.
- The four background glows are fixed, blurred circles behind everything. Render them once, in `App.tsx`.

### Type

- Use one sans family: the system font stack first, with Inter Tight from Google Fonts. One sans family throughout; money, dates, references and IDs use tabular-nums (no monospace). Type scale: 12 / 14 / 16 / 20 / 26 / 40.
- Remove the EB Garamond and JetBrains Mono mix.
- Large headings get `-0.02em` letter-spacing; body text gets none.
- Every money figure uses `tabular-nums`.

### Colour discipline

- The accent is only for the one primary action and the current selection.
- The money-back colour is only for recovered money and the "Recoverable" label.
- Amber is only for "Needs review".
- No other colours.

## Minimalism rules

Apply these everywhere:

- **One primary action per screen.** Everything else is a secondary button, or sits behind a "More" disclosure.
- **Plain language.**
  - Labels say what happens: "Send request", "Not owed, dismiss".
  - Never show internal words like detector, pipeline or extractor.
- **Cut anything that doesn't help the next decision.**
  - Story and Audit trail merge into one "History" disclosure, closed by default.
  - Correspondence appears only when the case has emails.
- **Queue rows show three things:** vendor, amount, and the deadline or status. The leak type goes on a second, muted line.
- **Case view order, top to bottom:**
  1. Amount and vendor
  2. The one-sentence reason, with citations
  3. The one next step
  4. The draft, when there is one
  5. Evidence
  6. History
- **Empty states** say what will appear here and what to press.

## Component map

| Current file | New treatment |
|---|---|
| `components/Metrics.tsx` | Four glass tiles, each with a Bklit `LineSparkline`, plus a Bklit Sankey below them (details below). |
| `components/Queue.tsx` | Kokonut SmoothTab for the tabs, Motion `layout` on rows, and a shared `layoutId` into the case view (details below). |
| `components/Chip.tsx` | Status chips morph between states (details below). |
| `components/case/DraftEditor.tsx` and `ConfirmDialog.tsx` | "Approve and send" becomes Kokonut SlideToConfirm inside a confirm sheet (details below). |
| `components/Toast.tsx` | Becomes a stacked notification list (details below). |
| `components/case/Evidence.tsx` and `CaseView.tsx` | Citations (see the next section). |
| `components/Button.tsx` | Tailwind `:hover` and `:active` instead of JS hover state. Press feedback is `scale(.97)` on pointer-down. Only the primary variant uses the accent. |
| `App.tsx` | Wrap the app in `<MotionConfig reducedMotion="user">` and render the background glows once. Keep all data flow (`act`, `useCases`, `useCase`) unchanged. |

**`Metrics.tsx`**
- **Sparklines:** their data is a client-side history of `/api/summary` snapshots, one per demo advance, kept in `sessionStorage`. With only one point, show no line.
- **Number roll:** amounts roll to their new value using `useSpring` + `useTransform` from `motion/react`.
- **Sankey:** it goes below the tiles and shows Found → Ready to claim / Missed → In flight → Recovered, using values from `summary`. On screens narrower than 900px it collapses behind a "See the flow" toggle.

**`Queue.tsx`**
- The tabs become Kokonut `SmoothTab`, with counts.
- Rows use Motion `layout`, so they slide when the order changes or a case moves tabs.
- Each row has `layoutId={"case-" + id}`, so selecting it expands smoothly into the case view (`AnimatePresence`).

**`Chip.tsx`**
- Status chips morph between states (Sent → Vendor agreed → Recovered) using `AnimatePresence mode="popLayout"` and a spring.
- The label and colour cross-fade.

**`DraftEditor.tsx` and `ConfirmDialog.tsx`**
- "Approve and send" becomes Kokonut `SlideToConfirm`, inside a confirm sheet.
- The sheet shows the recipient large ("Sends to billing@figma.com") above the slider.
- Keyboard fallback: focus the slider, press Enter, then press Enter again to confirm.

**`Toast.tsx`**
- After Advance 2 weeks, each vendor reply and each posted credit appears as its own card.
- The cards stack and dismiss themselves, using `AnimatePresence` and springs.

Use the free `motion/react` APIs throughout. The motion.dev examples for the badge, number counter, shared modal and notification stack are paid Motion+ source code. Rebuild the effects with `AnimatePresence`, `layout`, `layoutId`, `useSpring` and `useTransform`. Don't use `AnimateNumber`, because it's Motion+ only.

## Citations

The goal is to make "we have the receipts" visible.

**Footnotes**
- Number every claim in the reason sentence that has matching evidence (¹ ² ³).
- Match claims to evidence using `detail.evidence[]` and `detail.transactions[]`.

**Preview**
- Hovering or focusing a footnote shows a small glass preview of its source:
  - the charge row
  - the vendor's sentence
  - the contract clause
  - the outage incident

**Open the source**
- Clicking an email footnote opens the full original email in a glass sheet.
  - The email comes from `detail.emails[].body`, which the API already returns.
  - The sheet is scrolled to the quoted sentence, which is highlighted.
- Keep the caption saying the quote was checked word for word against the email.
- Vendor quotes are currently parsed out of `evidence[].detail` with a regex in `Evidence.tsx`. Reuse that.

No backend change is needed.

## Motion rules (from the Apple design skill)

- Use springs for everything the user touches: `{ type: "spring", bounce: 0, duration: 0.4 }`. Sheets use `duration: 0.5`.
- Animate only `transform` and `opacity`.
- Things enter and leave along the same path.
- Never block input while something animates.
- Press feedback starts on pointer-down.
- No decorative motion. Every animation marks a change to a case or to money.

## How to use the skills

**Taste (`design-taste-frontend`)**
- Take the app-screen route: read `references/app-screens.md` and use the `--app` flags.
- Skip the direction and palette deal, since the direction is fixed above.
- After each section of work, run `lint.mjs` on `frontend/src` and `inspect.mjs --app`.
  - Fix every FAIL.
  - Fix every WARN, or write down why it's fine.
- Do the look loop, up to three rounds: open every screenshot and fix the three worst problems.

**Apple design (`apple-design`)**
- It only greets you unless you ask it a specific question.
- Ask it three specific questions and apply the answers:
  1. the glass material spec for these tokens
  2. the confirm sheet and slider motion
  3. the shared transition from a queue row to the case view

**Bklit (`bklit-ui`)**
- Use it to install, compose and theme the Sankey and the sparklines.
- Point `--chart-1` through `--chart-5` at the glacier tokens.

## Verification

All of this is required before calling it done.

**1. Tap through with the Playwright MCP**
- Do this at 1440×900, 768×1024 and 390×844, in both light and dark.
- Steps:
  1. Load the app, switch through all three tabs, and move through the queue with j/k.
  2. Open the Figma case. Check the footnotes, open the email-source sheet, and close it with Escape.
  3. Draft the request, edit the subject, save, and slide to confirm. It sends, and the case moves to Waiting.
  4. Click Advance 2 weeks. Check that the notification stack appears, the chips morph, the money totals roll, and the sparklines gain a point.
  5. Dismiss a case with a reason.
- Read the console after every step. There must be zero errors.

**2. Commit an end-to-end test**
- Write `frontend/e2e/recoup.spec.ts` with `@playwright/test`, covering the same path.
- Its `webServer` starts `make dev`, and the API runs on port 8000.
- Add an `npm run e2e` script.
- Run it after `make reset`, so it always starts from Oct 1, 2026.

**3. Taste gate**
- Run `inspect.mjs --app --out .taste-skill/after`.
- Compare before and after at every width.
- Click everything that worked before.

**4. Reduced motion and reduced transparency**
- Emulate both in Playwright and screenshot the case view.
- There should be no blur and no movement, and it must still be fully usable.

**5. Final checks**
- Run `npm run build` and `make check`.
- Finish with a short summary and before-and-after screenshots.

## Order of work

1. Setup
2. Tokens and glass
3. Queue and tabs
4. Case view and citations
5. Draft and slide to confirm
6. Metrics, sparklines and Sankey
7. Notifications and motion polish
8. Verification

Commit after each step with a clear message. Don't push.
