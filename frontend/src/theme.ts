import type { LeakType, Outcome, Status } from "./api";

// Plain-language labels. Every colour, font and radius lives in index.css.

export const LEAK_LABEL: Record<LeakType, string> = {
  duplicate_charge: "Duplicate charge",
  missing_refund: "Refund never arrived",
  charged_after_cancellation: "Billed after cancelling",
  sla_credit: "Outage credit",
};

export const OUTCOME_LABEL: Record<Outcome, string> = {
  recoverable: "Recoverable",
  needs_review: "Needs review",
  not_recoverable: "Not recoverable",
};

export const STATUS_LABEL: Record<Status, string> = {
  open: "New",
  drafted: "Draft ready",
  sent: "Sent",
  vendor_agreed: "Vendor agreed",
  info_requested: "Info requested",
  vendor_declined: "Declined",
  recovered: "Recovered",
  dismissed: "Dismissed",
  expired: "Expired",
};
