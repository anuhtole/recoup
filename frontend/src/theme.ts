import type { Finding, LeakType } from "./api";
import { CLAIM_TYPES, typeGroup, typeLabel } from "./lib/claimTypes";
import { isWindowClosed } from "./queue";

// Plain-language labels and the status vocabulary. Every colour, font and radius lives in index.css.

/** The claim-type names live in lib/claimTypes.ts; these keep the older names working. */
export const LEAK_LABEL: Record<LeakType, string> = Object.fromEntries(CLAIM_TYPES.map((t) => [t, typeLabel(t)])) as Record<LeakType, string>;
export const LEAK_GROUP: Record<LeakType, string> = Object.fromEntries(CLAIM_TYPES.map((t) => [t, typeGroup(t)])) as Record<LeakType, string>;

/**
 * One small, fixed status vocabulary on one scale: mint = money coming back, amber = needs you or
 * needs review, neutral = waiting or new, muted = closed.
 */
export type Tone = "mint" | "amber" | "neutral" | "muted";

export function statusOf(finding: Pick<Finding, "status" | "outcome" | "days_left">): { label: string; tone: Tone } {
  switch (finding.status) {
    case "recovered":
      return { label: "Recovered", tone: "mint" };
    case "vendor_agreed":
      return { label: "Vendor agreed", tone: "mint" };
    case "sent":
      return { label: "Sent", tone: "neutral" };
    case "info_requested":
      return { label: "Needs info", tone: "amber" };
    case "vendor_declined":
      return { label: "Declined", tone: "amber" };
    case "dismissed":
      return { label: "Not owed", tone: "muted" };
    case "expired":
      return { label: "Window closed", tone: "muted" };
    case "drafted":
      return { label: "Draft ready", tone: "neutral" };
    case "open":
      if (isWindowClosed(finding as Finding)) return { label: "Window closed", tone: "muted" };
      if (finding.outcome === "needs_review") return { label: "Needs review", tone: "amber" };
      return { label: "New", tone: "neutral" };
  }
}

/** Three days or fewer is urgent: amber everywhere a deadline shows. */
export const URGENT_DAYS = 3;
export function isUrgent(daysLeft: number | null): boolean {
  return daysLeft !== null && daysLeft >= 0 && daysLeft <= URGENT_DAYS;
}
