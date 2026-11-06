import type { FindingDetail } from "../api";
import { needsCustomerConfirmation, parseQuote } from "../components/case/cite";
import { formatDate, formatPercent } from "../format";
import { vendorName } from "./vendors";

/**
 * "Why it's owed": the detector's rule strings rewritten as plain checks. The API words its rules for
 * engineers ("Same merchant and exact amount 1 day(s) apart (window: 3 days)"); this layer is the only
 * place that reads them, so rule ids, "(s)" and parenthesised jargon never reach the screen.
 */
export interface OwedCheck {
  text: string;
  /** An identifier set after the text in mono: a shared reference. */
  code?: string;
  /** False for what a person still has to confirm. */
  passed: boolean;
}

const APART = ["on the same day", "one day apart", "two days apart", "three days apart"];
const NUMBER = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

const pct = formatPercent;
const day = (iso: string) => formatDate(iso);
/** "Three", "Twelve": a count at the start of a sentence is spelled out. */
const Count = (n: number) => (NUMBER[n] ? NUMBER[n].charAt(0).toUpperCase() + NUMBER[n].slice(1) : String(n));
/** Whole calendar days between two postings, as the ledger dates them (UTC). */
const calendarDays = (a: string, b: string) => Math.round(Math.abs(Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86_400_000);

function allCharges(n: number, verb: string): string {
  if (n === 1) return `The charge ${verb === "are" ? "is" : verb}`;
  if (n === 2) return `Both charges ${verb}`;
  return `All ${n} charges ${verb}`;
}

/** Charges only: once money is back, the ledger also holds the credit, which is no part of why it was owed. */
const chargesOf = (detail: FindingDetail) => detail.transactions.filter((t) => t.amount_minor > 0);
/** After a credit posts, "no refund has posted" is history, so it is said in the past tense. */
const posted = (detail: FindingDetail) => (detail.status === "recovered" || detail.transactions.some((t) => t.amount_minor < 0) ? "had posted when Recoup found it" : "has posted");

function duplicates(detail: FindingDetail, rule: string): OwedCheck[] {
  const out: OwedCheck[] = [];
  const charges = [...chargesOf(detail)].sort((a, b) => a.posted_at.localeCompare(b.posted_at));
  // Counted from the two charges' dates, never the rule's "1 day(s)", which older detectors measured in
  // 24-hour spans (11pm and 1am the next day read "same day" against a ledger showing two dates).
  const gap = /(\d+) day\(s\) apart/.exec(rule);
  const n = charges.length >= 2 ? calendarDays(charges[0].posted_at, charges[1].posted_at) : gap ? Number(gap[1]) : null;
  out.push({ text: `Same amount charged twice${n === null ? "" : `, ${APART[n] ?? `${n} days apart`}`}`, passed: true });
  const refs = [...new Set(charges.map((t) => t.reference).filter((r): r is string => Boolean(r)))];
  const shared = refs.length === 1 && charges.every((t) => t.reference === refs[0]);
  // The reference itself is in the header and the ledger; here it is enough that they match.
  if (shared) out.push({ text: `${allCharges(charges.length, "carry")} the same order reference`, passed: true });
  if (/no matching refund has posted/i.test(rule)) out.push({ text: `No refund ${posted(detail)}`, passed: true });
  out.push({ text: `${allCharges(charges.length, "are")} in your ledger`, passed: true });
  if (!shared) out.push({ text: "No shared order reference, so confirm it was one purchase", passed: false });
  return out;
}

function promises(detail: FindingDetail, rule: string): OwedCheck[] {
  const vendor = vendorName(detail.merchant);
  const quoted = detail.evidence.some((e) => e.kind === "email" && parseQuote(e.detail));
  const out: OwedCheck[] = [];
  const after = /(\d+) charge\(s\) posted after the cancellation took effect on (\d{4}-\d{2}-\d{2})/.exec(rule);
  if (after) {
    const n = Number(after[1]);
    if (quoted) out.push({ text: `${vendor} confirmed the cancellation by email`, passed: true });
    out.push({ text: `${n === 1 ? "A charge" : `${Count(n)} charges`} posted after the cancellation took effect on ${day(after[2])}`, passed: true });
    out.push({ text: `${allCharges(chargesOf(detail).length, "are")} in your ledger`, passed: true });
    return out;
  }
  // The word the vendor used: Marriott promised a "credit", United a "refund".
  const said = detail.evidence.map((e) => (e.kind === "email" ? (parseQuote(e.detail)?.quote ?? "") : "")).join(" ").toLowerCase();
  const word = /\bcredit/.test(said) && !/\brefund/.test(said) ? "credit" : /\brefund/.test(said) ? "refund" : detail.leak_type === "missing_refund" ? "refund" : "credit";
  if (quoted) out.push({ text: `${vendor} promised the ${word} by email`, passed: true });
  const due = /due by (\d{4}-\d{2}-\d{2})/.exec(rule);
  if (due) out.push({ text: `It was due by ${day(due[1])}`, passed: true });
  if (/none matches/.test(rule)) out.push({ text: `No matching credit ${posted(detail)}`, passed: true });
  const charges = chargesOf(detail);
  if (charges.length > 0) out.push({ text: `${allCharges(charges.length, "are")} in your ledger`, passed: true });
  return out;
}

function outages(detail: FindingDetail, rule: string): OwedCheck[] {
  const out: OwedCheck[] = [];
  const m = /Uptime ([\d.]+%) vs ([\d.]+%) commitment: (\d+%) of the (.+?) invoice/.exec(rule);
  if (m) {
    out.push({ text: `Uptime was ${pct(m[1])} in ${m[4]}, under the ${pct(m[2])} commitment`, passed: true });
    out.push({ text: `The contract owes ${m[3]} of that month's invoice`, passed: true });
  } else if (detail.evidence.some((e) => e.kind === "contract")) {
    out.push({ text: "The contract owes a credit for the outage", passed: true });
  }
  const incidents = detail.evidence.filter((e) => e.kind === "incident").length;
  if (incidents === 1) out.push({ text: "The outage is on the vendor's status page", passed: true });
  else if (incidents > 1) out.push({ text: `${NUMBER[incidents] ?? incidents} outages are on the vendor's status page`.replace(/^\w/, (c) => c.toUpperCase()), passed: true });
  const invoices = chargesOf(detail).length;
  if (invoices > 0) out.push({ text: invoices === 1 ? "The invoice is in your ledger" : "The invoices are in your ledger", passed: true });
  if (needsCustomerConfirmation(detail.leak_type, detail.reason)) out.push({ text: "Confirm the outage affected you", passed: false });
  return out;
}

function pricing(detail: FindingDetail, rule: string): OwedCheck[] {
  const out: OwedCheck[] = [];
  const price = /contracted price \((\$[\d,]+\.\d{2}) through ([^)]+)\)/.exec(rule);
  if (price) out.push({ text: `The contract fixes the price at ${price[1]} through ${price[2]}`, passed: true });
  const over = detail.evidence.filter((e) => e.kind === "transaction" && /charged .*, contract allows/.test(e.detail)).length;
  if (over > 0) out.push({ text: over === 1 ? "A charge came in above it" : `${Count(over)} charges came in above it`, passed: true });
  if (/no credit for the difference has posted/i.test(rule)) out.push({ text: `No credit for the difference ${posted(detail)}`, passed: true });
  return out;
}

/** An unknown rule still reads as sentences: no "(s)", no "(window: …)" asides. */
function generic(rule: string): OwedCheck[] {
  return rule
    .replace(/\s*\((?:window|rule|threshold)[^)]*\)/gi, "")
    .replace(/(\d+) (\w+?)\(s\)/g, (_, n: string, word: string) => `${n} ${n === "1" ? word : `${word}s`}`)
    .split(/;\s+|\.\s+/)
    .map((s) => s.trim().replace(/\.$/, ""))
    .filter(Boolean)
    .map((s) => ({ text: s.charAt(0).toUpperCase() + s.slice(1), passed: true }));
}

export function owedChecks(detail: FindingDetail): OwedCheck[] {
  const rule = detail.evidence.find((e) => e.kind === "rule");
  const family = rule?.ref.split("/")[0] ?? "";
  const text = rule?.detail ?? "";
  let out: OwedCheck[];
  if (family === "duplicates" || (!rule && detail.leak_type === "duplicate_charge")) out = duplicates(detail, text);
  else if (family === "promises") out = promises(detail, text);
  else if (family === "outages") out = outages(detail, text);
  else if (family === "pricing") out = pricing(detail, text);
  else out = generic(text);
  if (detail.outcome === "needs_review" && !out.some((c) => !c.passed)) out.push({ text: "Confirm it before you claim", passed: false });
  return out;
}
