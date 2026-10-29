import type { CSSProperties } from "react";
import type { LeakType, Outcome, Status } from "./api";

export const COLORS = {
  backdrop: "#F5F0EB",
  surface: "#FFFFFF",
  sunken: "#FAF7F3",
  accent: "#7EB8D6",
  accentSoft: "#EAF4F9",
  accentInk: "#2C6A89",
  ink: "#1F1D1A",
  inkSoft: "#4A4640",
  inkDim: "#7A736A",
  border: "#E6DFD6",
  borderStrong: "#D5CCC0",
  good: "#2E6B4F",
  goodSoft: "#E4F1EA",
  warn: "#8A6416",
  warnSoft: "#F7EED9",
  muted: "#EFEBE6",
} as const;

export const FONTS = {
  serif: '"EB Garamond", Georgia, serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
} as const;

export const RADIUS = 10;

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

// Needs review is a normal state, so it gets a calm color, never an error red.
export const OUTCOME_COLORS: Record<Outcome, { fg: string; bg: string }> = {
  recoverable: { fg: COLORS.good, bg: COLORS.goodSoft },
  needs_review: { fg: COLORS.warn, bg: COLORS.warnSoft },
  not_recoverable: { fg: COLORS.inkDim, bg: COLORS.muted },
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

export const card: CSSProperties = {
  background: COLORS.surface,
  border: `1px solid ${COLORS.border}`,
  borderRadius: RADIUS,
};

export const eyebrow: CSSProperties = {
  fontFamily: FONTS.mono,
  fontSize: 11,
  letterSpacing: "0.07em",
  textTransform: "uppercase",
  color: COLORS.inkDim,
};

export const mono: CSSProperties = { fontFamily: FONTS.mono, fontSize: 12, color: COLORS.inkSoft };
