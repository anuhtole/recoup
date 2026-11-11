import type { Finding, LeakType } from "./api";
import { formatPercent } from "./format";
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

const KEEP_UPPER = new Set(["US", "UK", "SF", "NY", "LA", "AWS", "SLA", "EU", "LLC", "INC", "LTD", "AMZN", "SQ", "TST", "API"]);
// How brands write themselves, after title-casing a descriptor: "WEWORK" → "WeWork", "ZOOM.US" → "Zoom.us".
const BRAND_CASE: [RegExp, string][] = [
  [/\bWework\b/g, "WeWork"],
  [/\bGithub\b/g, "GitHub"],
  [/\bZoom\.US\b/g, "Zoom.us"],
  [/\bPaypal\b/g, "PayPal"],
];

/**
 * "JOE'S CATERING LLC" → "Joe's Catering LLC": title-cases a card descriptor, which banks print in all
 * caps. Anything with a lowercase letter is already how someone wrote it ("AMZN Mktp US", "Increased API
 * latency…") and is left alone. Codes (FIG-202606), legal suffixes and acronyms keep their caps.
 */
export function titleCase(text: string): string {
  if (/[a-z]/.test(text)) return text;
  let out = text.replace(/\b[A-Z][A-Z']+\b/g, (word, offset: number, whole: string) => {
    const next = whole[offset + word.length];
    if (KEEP_UPPER.has(word) || next === "-" || /\d/.test(word)) return word;
    return word.charAt(0) + word.slice(1).toLowerCase();
  });
  for (const [pattern, brand] of BRAND_CASE) out = out.replace(pattern, brand);
  return out;
}

/**
 * The reason sentence for display. Citations are numbered on this text, so it may change length:
 * - it starts with the vendor's name as the header shows it ("AMZN Mktp US charged" → "Amazon charged");
 * - the shared reference, already in the header and the ledger, isn't said again;
 * - "3 more time(s)" reads "3 more times", 99.90% reads 99.9%, a date repeated for both charges is said once;
 * - older detector wording is brought in line ("a person should confirm", "(99.46% uptime)", "; claim by …").
 */
export function displayReason(reason: string, merchant?: string): string {
  let text = reason;
  if (merchant) {
    const lead = /^([^$\d]{1,48}?) (charged|confirmed|promised|ran|owed)\b/.exec(text);
    if (lead) text = vendorName(merchant) + text.slice(lead[1].length);
  } else {
    const match = /^([^a-z]+?) (charged|confirmed|promised|ran|owed)\b/.exec(text);
    if (match) text = vendorName(titleCase(match[1])) + text.slice(match[1].length);
  }
  text = text
    .replace(/, under the same reference [A-Z0-9][A-Z0-9-]{3,}\./, ".")
    .replace(/There is no shared order reference to prove it was one purchase, so a person should confirm before we contact the vendor\./, "No shared order reference shows it was one purchase, so confirm it before you claim.")
    .replace(/ \((\d+(?:\.\d+)?%) uptime\),/, ", when uptime was $1,")
    .replace(/; claim by [A-Z][a-z]{2} \d{1,2}, \d{4}\./, ".")
    .replace(/\b1 more time\(s\)/g, "once more");
  text = formatPercent(text);
  text = text.replace(/\b(\d+) (more )?([a-z]+)\(s\)/g, (_, n: string, more: string | undefined, word: string) => `${n} ${more ?? ""}${n === "1" ? word : `${word}s`}`);
  return text.replace(/, on ([A-Z][a-z]{2} \d{1,2}, \d{4}) and \1,?/, " on $1,").replace(/ on ([A-Z][a-z]{2} \d{1,2}, \d{4}),\./, " on $1.");
}
