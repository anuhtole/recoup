import { Check, Circle } from "lucide-react";
import type { FindingDetail } from "../../api";
import { plural } from "../../format";
import { cn } from "@/lib/utils";
import { needsCustomerConfirmation, parseQuote } from "./cite";

interface CheckItem {
  text: string;
  passed: boolean;
}

const sentence = (text: string) => {
  const t = text.trim().replace(/\.$/, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** The checks behind a case, from its own evidence: the detector's rule, then each kind of record it matched. */
export function checksFor(detail: FindingDetail): CheckItem[] {
  const items: CheckItem[] = [];
  for (const rule of detail.evidence.filter((e) => e.kind === "rule")) {
    for (const clause of rule.detail.split(/;\s+/)) if (clause.trim()) items.push({ text: sentence(clause), passed: true });
  }
  const charges = detail.transactions.filter((t) => t.amount_minor > 0).length;
  if (charges > 0) items.push({ text: `Matched ${plural(charges, "charge")} in your ledger`, passed: true });
  if (detail.evidence.some((e) => e.kind === "email" && parseQuote(e.detail)))
    items.push({ text: "Vendor's words checked word for word against the original email", passed: true });
  if (detail.evidence.some((e) => e.kind === "contract")) items.push({ text: "Credit terms found in the contract", passed: true });
  const incidents = detail.evidence.filter((e) => e.kind === "incident").length;
  if (incidents > 0) items.push({ text: `${plural(incidents, "incident")} on the vendor's status page`, passed: true });
  if (needsCustomerConfirmation(detail.leak_type, detail.reason)) items.push({ text: "Confirm the outage affected you", passed: false });
  if (detail.outcome === "needs_review") items.push({ text: "A person should confirm it before claiming", passed: false });
  return items;
}

/** Ramp-style rationale: what Recoup checked, and how many checks passed. */
export function HowFound({ detail }: { detail: FindingDetail }) {
  const items = checksFor(detail);
  if (items.length === 0) return null;
  const passed = items.filter((i) => i.passed).length;
  const rule = detail.evidence.find((e) => e.kind === "rule")?.ref;
  return (
    <section aria-label="How Recoup found this" className="card">
      <header className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line px-5 py-2">
        <h2 className="m-0 text-14 font-semibold tracking-[-0.01em]">How Recoup found this</h2>
        <span className="label text-dim">
          {passed} of {items.length} checks{rule ? ` · ${rule}` : ""}
        </span>
      </header>
      <ul className="m-0 flex flex-col gap-2.5 px-5 py-4">
        {items.map((item) => (
          <li key={item.text} className="flex list-none items-start gap-3 text-14">
            <span
              className={cn(
                "mt-0.5 grid size-4 flex-none place-items-center rounded-xs",
                item.passed ? "bg-ink text-mint" : "border border-amber text-amber-ink",
              )}
            >
              {item.passed ? <Check aria-hidden className="size-3" strokeWidth={3} /> : <Circle aria-hidden className="size-1.5 fill-current" />}
            </span>
            <span className={item.passed ? "text-ink" : "text-amber-ink"}>
              <span className="sr-only">{item.passed ? "Passed: " : "Open: "}</span>
              {item.text}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
