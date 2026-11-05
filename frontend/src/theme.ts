import type { Finding, LeakType } from "./api";
import { isWindowClosed } from "./queue";

// Plain-language labels and the status vocabulary. Every colour, font and radius lives in index.css.

export const LEAK_LABEL: Record<LeakType, string> = {
  duplicate_charge: "Duplicate charge",
  missing_refund: "Refund never arrived",
  charged_after_cancellation: "Billed after cancelling",
  sla_credit: "Outage credit",
  price_overcharge: "Price above contract",
};

/** Plural headings for breakdowns. */
export const LEAK_GROUP: Record<LeakType, string> = {
  duplicate_charge: "Duplicate charges",
  missing_refund: "Missed refunds",
  charged_after_cancellation: "Billed after cancelling",
  sla_credit: "Outage credits",
  price_overcharge: "Price above contract",
};

/** Short names for the type filter chips. */
export const LEAK_CHIP: Record<LeakType, string> = {
  duplicate_charge: "Duplicates",
  missing_refund: "Refunds",
  charged_after_cancellation: "After cancelling",
  sla_credit: "Outages",
  price_overcharge: "Price",
};

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
      return { label: "Info requested", tone: "amber" };
    case "vendor_declined":
      return { label: "Declined", tone: "amber" };
    case "dismissed":
      return { label: "Dismissed", tone: "muted" };
    case "expired":
      return { label: "Expired", tone: "muted" };
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
