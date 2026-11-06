import { Check, Circle } from "lucide-react";
import type { FindingDetail } from "../../api";
import { owedChecks } from "../../lib/checks";
import { cn } from "@/lib/utils";
import { Section } from "../Section";

/** What Recoup checked, in plain words: a tick for each thing that holds, an amber ring for what a person must confirm. */
export function WhyOwed({ detail }: { detail: FindingDetail }) {
  const items = owedChecks(detail);
  if (items.length === 0) return null;
  return (
    <Section title="Why it's owed">
      <ul className="m-0 flex flex-col gap-2.5 p-0 pt-3">
        {items.map((item) => (
          <li key={item.text} className="flex list-none items-start gap-3 text-14">
            <span className={cn("mt-0.5 grid size-4 flex-none place-items-center rounded-full", item.passed ? "text-ink" : "border border-amber text-amber-ink")}>
              {item.passed ? <Check aria-hidden className="size-3" strokeWidth={3} /> : <Circle aria-hidden className="size-1.5 fill-current" />}
            </span>
            <span className={item.passed ? "text-ink" : "font-medium text-amber-ink"}>
              <span className="sr-only">{item.passed ? "Checked: " : "To confirm: "}</span>
              {item.text}
              {item.code && <span className="ref ml-1.5 text-13">{item.code}</span>}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
