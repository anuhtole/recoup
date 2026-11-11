// The real figures the agent speaks from: everything here is read off the findings and the summary.
import type { Finding, Status, Summary } from "../api";
import { vendorName } from "../lib/vendors";
import { rowsFor } from "../queue";

export const sum = (rows: Finding[]) => rows.reduce((t, f) => t + f.amount_minor, 0);

/** A claim is urgent when its deadline is this close. */
export const URGENT_DAYS = 30;
/** How many vendors the bars show. */
export const MAX_BARS = 5;

/** A request that has left: with the vendor, answered, or paid back. */
const OUT = new Set<Status>(["sent", "vendor_agreed", "info_requested", "vendor_declined", "recovered"]);
export const isOut = (f: Finding) => OUT.has(f.status);
/** A claim that can still be drafted and sent. */
export const isSendable = (f: Finding) => f.outcome === "recoverable" && (f.status === "open" || f.status === "drafted");

export interface VendorShare {
  name: string;
  minor: number;
  count: number;
}

export interface Facts {
  /** Open claims, soonest deadline first. */
  live: Finding[];
  ready: number;
  recovered: number;
  inFlight: number;
  missed: number;
  soonest: Finding | null;
  /** Due within 30 days, and the ones of those that can be sent. */
  due30: Finding[];
  urgent: Finding[];
  /** The vendors that owe the most, largest first, at most five. */
  vendors: VendorShare[];
  vendorCount: number;
}

export function factsOf(summary: Summary, findings: Finding[]): Facts {
  const live = rowsFor(findings, "todo");
  const byVendor = new Map<string, VendorShare>();
  for (const f of live) {
    const name = vendorName(f.merchant);
    const row = byVendor.get(name) ?? { name, minor: 0, count: 0 };
    row.minor += f.amount_minor;
    row.count += 1;
    byVendor.set(name, row);
  }
  const ranked = [...byVendor.values()].sort((a, b) => b.minor - a.minor);
  const due30 = live.filter((f) => f.days_left !== null && f.days_left <= URGENT_DAYS);
  return {
    live,
    ready: sum(live),
    recovered: summary.recovered_minor,
    inFlight: summary.in_flight_minor,
    missed: summary.expired_minor + sum(rowsFor(findings, "closed").filter((f) => f.status !== "expired")),
    soonest: live.find((f) => f.days_left !== null) ?? null,
    due30,
    urgent: due30.filter(isSendable),
    vendors: ranked.slice(0, MAX_BARS),
    vendorCount: ranked.length,
  };
}

/**
 * The requests the agent sent, in the order they went: the ones it tracked by id, or, when that list is
 * gone (a new browser tab), every request that is out.
 */
export function requestsOf(findings: Finding[], batch: number[]): Finding[] {
  const byId = new Map(findings.map((f) => [f.id, f]));
  const mine = batch.map((id) => byId.get(id)).filter((f): f is Finding => f !== undefined && isOut(f));
  return mine.length > 0 ? mine : findings.filter(isOut);
}

export interface Outcome {
  rows: Finding[];
  refunded: Finding[];
  agreed: Finding[];
  waiting: Finding[];
  /** Back with you: the vendor asked for details, or declined. */
  onYou: Finding[];
  /** Money that has posted to the ledger. */
  back: number;
}

export function outcomeOf(rows: Finding[]): Outcome {
  const refunded = rows.filter((f) => f.status === "recovered");
  return {
    rows,
    refunded,
    agreed: rows.filter((f) => f.status === "vendor_agreed"),
    waiting: rows.filter((f) => f.status === "sent"),
    onYou: rows.filter((f) => f.status === "info_requested" || f.status === "vendor_declined"),
    back: refunded.reduce((t, f) => t + (f.recovered_minor ?? f.amount_minor), 0),
  };
}
