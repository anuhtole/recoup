import type { Finding, LeakType } from "./api";
import { vendorName } from "./lib/vendors";

/** A case whose claim window has passed: kept, but out of the live lists. */
export function isWindowClosed(finding: Finding): boolean {
  return (
    finding.outcome === "not_recoverable" ||
    finding.status === "expired" ||
    ((finding.status === "open" || finding.status === "drafted") && finding.days_left !== null && finding.days_left < 0)
  );
}

export type Tab = "todo" | "waiting" | "done" | "closed";
export const TABS: { id: Tab; label: string }[] = [
  { id: "todo", label: "To do" },
  { id: "waiting", label: "Waiting" },
  { id: "done", label: "Done" },
  { id: "closed", label: "Window closed" },
];

export function tabOf(finding: Finding): Tab {
  if (isWindowClosed(finding)) return "closed";
  return finding.stage;
}

const daysLeft = (f: Finding) => f.days_left ?? Number.POSITIVE_INFINITY;

/** The rows of one tab in display order: To do by fewest days left (then largest), the rest newest first. */
export function rowsFor(findings: Finding[], tab: Tab): Finding[] {
  const rows = findings.filter((f) => tabOf(f) === tab);
  if (tab === "todo") return rows.sort((a, b) => daysLeft(a) - daysLeft(b) || b.amount_minor - a.amount_minor);
  if (tab === "closed") return rows.sort((a, b) => (b.days_left ?? -1e9) - (a.days_left ?? -1e9) || b.amount_minor - a.amount_minor);
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
}

export function countsFor(findings: Finding[]): Record<Tab, number> {
  const counts: Record<Tab, number> = { todo: 0, waiting: 0, done: 0, closed: 0 };
  for (const f of findings) counts[tabOf(f)] += 1;
  return counts;
}

/** Search across vendor, reference and reason; type narrows to one leak type. */
export function filterRows(rows: Finding[], query: string, type: LeakType | null): Finding[] {
  const q = query.trim().toLowerCase();
  return rows.filter((f) => {
    if (type && f.leak_type !== type) return false;
    if (!q) return true;
    return (
      f.merchant.toLowerCase().includes(q) ||
      (referenceOf(f.reason) ?? "").toLowerCase().includes(q) ||
      f.reason.toLowerCase().includes(q)
    );
  });
}

/** The shared reference a case was matched on, from the reason sentence ("under the same reference FIG-202606"). */
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

/**
 * The reason sentence for display. Citations are numbered on this text, so it may change length:
 * an all-caps card descriptor at its start reads as the vendor's name ("SQ *JOES CATERING" → "Joes Catering"),
 * "3 more time(s)" reads "3 more times", and a date repeated for both charges is said once.
 */
export function displayReason(reason: string): string {
  let text = reason;
  const match = /^([^a-z]+?) (charged|confirmed|promised|ran|owed)\b/.exec(text);
  if (match) text = vendorName(titleCase(match[1])) + text.slice(match[1].length);
  text = text.replace(/\b(\d+) (more )?([a-z]+)\(s\)/g, (_, n: string, more: string | undefined, word: string) => `${n} ${more ?? ""}${n === "1" ? word : `${word}s`}`);
  return text.replace(/, on ([A-Z][a-z]{2} \d{1,2}, \d{4}) and \1,?/, " on $1,").replace(/ on ([A-Z][a-z]{2} \d{1,2}, \d{4}),\./, " on $1.");
}
