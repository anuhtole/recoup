import type { Email, Evidence, FindingDetail, Transaction } from "../../api";
import { formatDate, formatMoney } from "../../format";

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
    if (!claim(formatDate(txn.posted_at), { kind: "charge", transactions: [txn] })) uncited.push(txn);
  }
  if (uncited.length > 0 && uncited.length === detail.transactions.length) {
    const total = uncited.reduce((sum, t) => sum + Math.abs(t.amount_minor), 0);
    const source: Source = { kind: "charge", transactions: uncited };
    if (!claim(formatMoney(total, uncited[0].currency), source)) {
      claimPattern(/\$[\d,]+\.\d{2}/g, source);
    }
  }

  const incidents = detail.evidence.filter((e) => e.kind === "incident");
  if (incidents.length > 0) claimPattern(/\d+(?:\.\d+)?% uptime/g, { kind: "incident", items: incidents });

  const contract = detail.evidence.find((e) => e.kind === "contract");
  if (contract) claimPattern(/\d+(?:\.\d+)?% commitment|commitment|contract/g, { kind: "contract", evidence: contract });

  spans.sort((a, b) => a.start - b.start);
  const citations = spans.map((span, i) => ({ n: i + 1, at: span.end, source: span.source }));
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
