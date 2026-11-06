import type { LeakType } from "../api";

/**
 * One name per claim type, used on every screen (Overview, Claims, Case, ⌘K, CSV). The tag on one
 * claim and the heading over many come from the same noun: "Duplicate charge" / "Duplicate charges".
 */
export const CLAIM_TYPE: Record<LeakType, { one: string; many: string }> = {
  duplicate_charge: { one: "Duplicate charge", many: "Duplicate charges" },
  missing_refund: { one: "Missing refund", many: "Missing refunds" },
  charged_after_cancellation: { one: "Billed after cancelling", many: "Billed after cancelling" },
  sla_credit: { one: "Outage credit", many: "Outage credits" },
  price_overcharge: { one: "Price above contract", many: "Price above contract" },
};

export const CLAIM_TYPES = Object.keys(CLAIM_TYPE) as LeakType[];

/** "Duplicate charge": the tag on one claim. */
export const typeLabel = (type: LeakType) => CLAIM_TYPE[type].one;
/** "Duplicate charges": a heading or filter over many. */
export const typeGroup = (type: LeakType) => CLAIM_TYPE[type].many;
