import { useEffect, useState } from "react";
import type { Summary } from "../api";

export interface Snapshot {
  as_of: string;
  claimable: number;
  in_flight: number;
  recovered: number;
  expired: number;
}

const KEY = "recoup.summary-history";

function read(): Snapshot[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Snapshot[]) : [];
  } catch {
    return [];
  }
}

function snapshot(summary: Summary): Snapshot {
  return {
    as_of: summary.as_of,
    claimable: summary.claimable_minor,
    in_flight: summary.in_flight_minor,
    recovered: summary.recovered_minor,
    expired: summary.expired_minor,
  };
}

/**
 * One snapshot of the totals per demo date, kept for this browser session, so the tiles can draw
 * how each total moved with every "Advance 2 weeks". Same date: the latest totals replace the last
 * point. An earlier date (the demo was reset) starts the history again.
 */
export function useSummaryHistory(summary: Summary): Snapshot[] {
  const [history, setHistory] = useState<Snapshot[]>(read);

  useEffect(() => {
    setHistory((previous) => {
      const next = snapshot(summary);
      const last = previous[previous.length - 1];
      let updated: Snapshot[];
      if (!last || next.as_of < last.as_of) updated = [next];
      else if (next.as_of === last.as_of) updated = [...previous.slice(0, -1), next];
      else updated = [...previous, next];
      try {
        sessionStorage.setItem(KEY, JSON.stringify(updated));
      } catch {
        // Storage can be unavailable (private mode); the sparklines just start fresh.
      }
      return updated;
    });
  }, [summary]);

  return history;
}
