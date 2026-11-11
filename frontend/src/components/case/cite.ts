import type { Email, Evidence, FindingDetail, Transaction } from "../../api";
import { formatClock, formatDate, formatMoney } from "../../format";

// "Amazon wrote on 2026-06-02: "…"" is how the API words a verified vendor quote.
const QUOTE = /^(.*?) wrote on (\d{4}-\d{2}-\d{2}): "(.*)"$/s;

export interface VendorQuote {
  vendor: string;
  day: string;
  quote: string;
}

export function parseQuote(detail: string): VendorQuote | null {
  const match = QUOTE.exec(detail);
  return match ? { vendor: match[1], day: match[2], quote: match[3] } : null;
}

export type Source =
  | { kind: "charge"; transactions: Transaction[] }
  | { kind: "email"; evidence: Evidence; quote: VendorQuote; email: Email | null }
  | { kind: "contract"; evidence: Evidence }
  | { kind: "incident"; items: Evidence[] };

export interface Citation {
  n: number;
  /** Index in the reason just after the claim, where the footnote goes. */
  at: number;
  source: Source;
}

export interface CitedReason {
  parts: (string | Citation)[];
  citations: Citation[];
  /** Footnote number for each evidence ref or transaction id, so evidence can echo it. */
  numberOf: Map<string, number>;
}

/** Words too small to carry a footnote mark. */
const LITTLE = new Set(["a", "an", "the", "of", "for", "at", "by", "to", "on", "in", "and", "or", "over", "under", "but"]);

interface Span {
  start: number;
  end: number;
  source: Source;
}

/**
 * Numbers every claim in the reason sentence that has matching evidence: a date that matches a
 * charge or the vendor's email, the uptime figure (the outage incidents), the commitment (the
 * contract), and failing a date, the amount the charges add up to.
 */
export function citeReason(detail: FindingDetail): CitedReason {
  const reason = detail.reason;
  const spans: Span[] = [];
  const isFree = (start: number, end: number) => spans.every((s) => end <= s.start || start >= s.end);
  const claim = (needle: string, source: Source): boolean => {
    let from = 0;
    while (needle) {
      const start = reason.indexOf(needle, from);
      if (start < 0) return false;
      const end = start + needle.length;
      if (isFree(start, end)) {
        spans.push({ start, end, source });
        return true;
      }
      from = end;
    }
    return false;
  };
  const claimPattern = (pattern: RegExp, source: Source): boolean => {
    for (const match of reason.matchAll(pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (isFree(start, end)) {
        spans.push({ start, end, source });
        return true;
      }
    }
    return false;
  };

  for (const evidence of detail.evidence.filter((e) => e.kind === "email")) {
    const quote = parseQuote(evidence.detail);
    if (!quote) continue;
    const email = detail.emails.find((e) => e.id === evidence.ref || evidence.ref.endsWith(e.id)) ?? null;
    claim(formatDate(quote.day), { kind: "email", evidence, quote, email });
  }

  const uncited: Transaction[] = [];
  for (const txn of detail.transactions) {
    const date = formatDate(txn.posted_at);
    if (claim(date, { kind: "charge", transactions: [txn] })) continue;
    // "charged twice on Jun 19": the second charge shares the first one's date, and its footnote.
    const sameDay = spans.find((sp) => sp.source.kind === "charge" && sp.source.transactions.some((t) => formatDate(t.posted_at) === date));
    if (sameDay && sameDay.source.kind === "charge") sameDay.source.transactions.push(txn);
    else uncited.push(txn);
  }
  // Some charges are dated in the sentence and some aren't ("3 charges since Jul 3"): cite them as one
  // group on the count, so every charge in the ledger carries a number, not just the first.
  if (uncited.length > 0 && uncited.length < detail.transactions.length) {
    const group: Source = { kind: "charge", transactions: detail.transactions };
    const singles = spans.filter((sp) => sp.source.kind === "charge");
    const kept = spans.filter((sp) => sp.source.kind !== "charge");
    spans.length = 0;
    spans.push(...kept);
    if (claimPattern(new RegExp(`\\b${detail.transactions.length} charges\\b`, "g"), group)) uncited.length = 0;
    else spans.push(...singles);
  }
  if (uncited.length > 0 && uncited.length === detail.transactions.length) {
    const total = uncited.reduce((sum, t) => sum + Math.abs(t.amount_minor), 0);
    const source: Source = { kind: "charge", transactions: uncited };
    if (!claim(formatMoney(total, uncited[0].currency), source)) {
      claimPattern(/\$[\d,]+\.\d{2}/g, source);
    }
  }

  const incidents = detail.evidence.filter((e) => e.kind === "incident");
  // "99.57% uptime" or "when uptime was 99.46%": the footnote goes on the word "uptime", never on a bare number.
  if (incidents.length > 0) claimPattern(/\d+(?:\.\d+)?% uptime|\buptime\b/g, { kind: "incident", items: incidents });

  const contract = detail.evidence.find((e) => e.kind === "contract");
  if (contract) claimPattern(/\d+(?:\.\d+)?% commitment|commitment|contract|agreement/g, { kind: "contract", evidence: contract });

  spans.sort((a, b) => a.start - b.start);
  // A mark right after an amount reads as a power ("$385.71³"), so it moves to a neighbouring word:
  // the one after ("a $37.48 credit¹ for May"), else the one before ("credit³, $385.71"), skipping
  // little words ("a", "in"). Dates and phrases that end in a word keep the mark where they end.
  const anchor = (span: Span) => {
    if (!/^\$[\d,]+\.\d{2}$/.test(reason.slice(span.start, span.end))) return span.end;
    const after = /^ ([A-Za-z]+)/.exec(reason.slice(span.end));
    if (after && !LITTLE.has(after[1].toLowerCase())) return span.end + after[0].length;
    const before = /([A-Za-z]+)[\s,;:]*$/.exec(reason.slice(0, span.start));
    if (before && !LITTLE.has(before[1].toLowerCase())) return (before.index ?? 0) + before[1].length;
    return span.end;
  };
  const citations = spans.map((span, i) => ({ n: i + 1, at: anchor(span), source: span.source })).sort((a, b) => a.at - b.at);
  const numberOf = new Map<string, number>();
  for (const c of citations) {
    const { source } = c;
    if (source.kind === "charge") source.transactions.forEach((t) => numberOf.set(t.id, c.n));
    else if (source.kind === "email" || source.kind === "contract") numberOf.set(source.evidence.ref, c.n);
    else source.items.forEach((e) => numberOf.set(e.ref, c.n));
  }

  const parts: (string | Citation)[] = [];
  let cursor = 0;
  for (const c of citations) {
    parts.push(reason.slice(cursor, c.at), c);
    cursor = c.at;
  }
  parts.push(reason.slice(cursor));
  return { parts: parts.filter((p) => p !== ""), citations, numberOf };
}

/** Finds the quoted sentence in the email body, tolerating line breaks and extra spaces. */
export function findQuote(body: string, quote: string): { start: number; end: number } | null {
  const words = quote.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (words.length === 0) return null;
  const match = new RegExp(words.join("\\s+")).exec(body);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}

/** An incident detail ends with its status-page URL; the sentence before it is what people read. */
export function splitIncident(detail: string): { text: string; url: string | null } {
  const match = /^(.*?)\s*(https?:\/\/\S+)\s*$/.exec(detail);
  return match ? { text: match[1].replace(/\.$/, ""), url: match[2] } : { text: detail, url: null };
}

/** "$1,234.56" → 123456 (minor units); null if it isn't a dollar amount. */
export function parseMoney(text: string): number | null {
  const match = /\$([\d,]+)\.(\d{2})/.exec(text);
  return match ? Number(match[1].replace(/,/g, "")) * 100 + Number(match[2]) : null;
}

export interface PriceComparison {
  contractMinor: number;
  lockedUntil: string | null;
  charges: { day: string; chargedMinor: number; allowedMinor: number; reference: string | null }[];
}

/**
 * A price-above-contract case, read from its evidence: each transaction row says
 * "2026-08-03 charged $528.00, contract allows $480.00 (FIG-202608)" and the rule names the
 * contracted price ("($480.00 through Dec 31, 2026)"). Null when anything doesn't parse, so the
 * caller falls back to the plain evidence rows.
 */
export function parsePriceComparison(evidence: Evidence[]): PriceComparison | null {
  const charges: PriceComparison["charges"] = [];
  for (const item of evidence.filter((e) => e.kind === "transaction")) {
    const match = /^(\d{4}-\d{2}-\d{2}) charged (\$[\d,]+\.\d{2}), contract allows (\$[\d,]+\.\d{2})(?: \(([^)]*)\))?/.exec(item.detail);
    if (!match) return null;
    const charged = parseMoney(match[2]);
    const allowed = parseMoney(match[3]);
    if (charged === null || allowed === null) return null;
    charges.push({ day: match[1], chargedMinor: charged, allowedMinor: allowed, reference: match[4] && match[4] !== "no reference" ? match[4] : null });
  }
  if (charges.length === 0) return null;
  const rule = evidence.find((e) => e.kind === "rule")?.detail ?? "";
  const lockedUntil = /through ([A-Z][a-z]{2} \d{1,2}, \d{4})/.exec(rule)?.[1] ?? null;
  return { contractMinor: charges[0].allowedMinor, lockedUntil, charges };
}

/**
 * Outage cases built from a public status page, which can't prove the customer was affected:
 * the detector words their reason around the vendor's published terms.
 */
export function needsCustomerConfirmation(leakType: string, reason: string): boolean {
  return leakType === "sla_credit" && /status page showed|published (commitment|terms)|If your site was affected/.test(reason);
}

/** "Elevated error rates…: 2026-08-11 16:05 to 18:15 UTC" → the name, and "Aug 11, 2026 · 4:05–6:15 PM UTC". */
export function incidentParts(text: string): { name: string; when: string | null } {
  const m = /^(.*?):\s*(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}) to (\d{2}):(\d{2}) UTC$/.exec(text);
  if (!m) return { name: text, when: null };
  const [h1, m1, h2, m2] = [m[3], m[4], m[5], m[6]].map(Number);
  const sameHalf = h1 < 12 === h2 < 12;
  return { name: m[1], when: `${formatDate(m[2])} · ${formatClock(h1, m1, !sameHalf)}–${formatClock(h2, m2)} UTC` };
}

