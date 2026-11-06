import { useMemo } from "react";
import type { Finding, Summary } from "../api";

export interface Snapshot {
  /** A demo-clock date, YYYY-MM-DD. */
  as_of: string;
  /** Money back by that date, cumulative. */
  recovered: number;
}

/**
 * Money back over time, from the server's own records: each recovered claim's credit date
 * (`recovered_at`) and amount, summed by date, plus today's total on the as-of date. Every viewer and
 * every tab sees the same line, and a fresh tab after "Advance 2 weeks" has it too.
 */
export function recoveryHistory(summary: Summary, findings: Finding[]): Snapshot[] {
  const byDay = new Map<string, number>();
  for (const f of findings) {
    if (f.status !== "recovered" || !f.recovered_at) continue;
    const day = f.recovered_at.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + (f.recovered_minor ?? f.amount_minor));
  }
  let total = 0;
  const points = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([as_of, amount]) => ({ as_of, recovered: (total += amount) }));
  const last = points.at(-1);
  if (last && summary.as_of > last.as_of) points.push({ as_of: summary.as_of, recovered: last.recovered });
  return points;
}

export function useRecoveryHistory(summary: Summary, findings: Finding[]): Snapshot[] {
  return useMemo(() => recoveryHistory(summary, findings), [summary, findings]);
}
