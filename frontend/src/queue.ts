import type { Finding, Stage } from "./api";

/** A case whose claim window has passed: kept, but out of the live To do list. */
export function isWindowClosed(finding: Finding): boolean {
  return (
    finding.outcome === "not_recoverable" ||
    finding.status === "expired" ||
    (finding.days_left !== null && finding.days_left < 0)
  );
}

/**
 * The rows of one tab in display order. To do splits into live cases, most urgent first, and a
 * quiet group of closed-window cases at the bottom. The other tabs keep the API's order.
 */
export function orderStage(findings: Finding[], stage: Stage): { live: Finding[]; closed: Finding[] } {
  const rows = findings.filter((f) => f.stage === stage);
  if (stage !== "todo") return { live: rows, closed: [] };
  const daysLeft = (f: Finding) => f.days_left ?? Number.POSITIVE_INFINITY;
  const live = rows
    .filter((f) => !isWindowClosed(f))
    .sort((a, b) => daysLeft(a) - daysLeft(b) || b.amount_minor - a.amount_minor);
  return { live, closed: rows.filter(isWindowClosed) };
}

/** The shared reference a duplicate charge was matched on, from the reason sentence ("under the same reference FIG-202606"). */
export function referenceOf(reason: string): string | null {
  return /reference ([A-Z0-9][A-Z0-9-]{3,})/.exec(reason)?.[1] ?? null;
}

const KEEP_UPPER = new Set(["US", "UK", "SF", "NY", "LA", "AWS", "SLA", "EU"]);

/** "FIGMA INC" → "Figma Inc": title-cases words written in all caps, leaving codes (FIG-202606) alone. */
export function titleCase(text: string): string {
  return text.replace(/\b[A-Z][A-Z']+\b/g, (word, offset: number, whole: string) => {
    const next = whole[offset + word.length];
    if (KEEP_UPPER.has(word) || next === "-" || /\d/.test(word)) return word;
    return word.charAt(0) + word.slice(1).toLowerCase();
  });
}

/** The reason sentence for display: an all-caps card descriptor at its start reads in title case. Same length, so citations still line up. */
export function displayReason(reason: string): string {
  const match = /^([^a-z]+?) (charged|confirmed|promised|ran|owed)\b/.exec(reason);
  if (!match) return reason;
  return titleCase(match[1]) + reason.slice(match[1].length);
}
