import { motion, useReducedMotion, useSpring, useTransform } from "motion/react";
import { type ReactNode, useEffect } from "react";
import type { Finding, LeakType, Summary } from "../api";
import { formatMoney } from "../format";
import { cn } from "@/lib/utils";


/** A money figure that rolls to its new value on a spring (a jump under reduced motion). */
export function RollingMoney({ minor, currency, className }: { minor: number; currency: string; className?: string }) {
  const reduce = useReducedMotion();
  const value = useSpring(minor, { bounce: 0, duration: 0.9 });
  const text = useTransform(value, (v) => formatMoney(Math.round(v), currency));
  useEffect(() => {
    if (reduce) value.jump(minor);
    else value.set(minor);
  }, [minor, reduce, value]);
  return (
    <motion.span className={className} aria-label={formatMoney(minor, currency)}>
      {text}
    </motion.span>
  );
}

const TYPE_LABEL: Record<LeakType, string> = {
  duplicate_charge: "Duplicate charges",
  missing_refund: "Missed refunds",
  charged_after_cancellation: "Billed after cancelling",
  sla_credit: "Outage credits",
  price_overcharge: "Price above contract",
};

// One step of the primary pine per leak type, darkest for the largest share.
const SHADES = [
  "var(--primary)",
  "color-mix(in srgb, var(--primary) 66%, var(--base))",
  "color-mix(in srgb, var(--primary) 46%, var(--base))",
  "color-mix(in srgb, var(--primary) 30%, var(--base))",
  "color-mix(in srgb, var(--primary) 18%, var(--base))",
];

/** Ready to claim, split by the kind of leak: one stacked bar and the same numbers as a list. */
export function ByType({ findings, total, currency }: { findings: Finding[]; total: number; currency: string }) {
  const sums = new Map<LeakType, { amount: number; count: number }>();
  for (const f of findings.filter((f) => f.stage === "todo")) {
    const entry = sums.get(f.leak_type) ?? { amount: 0, count: 0 };
    sums.set(f.leak_type, { amount: entry.amount + f.amount_minor, count: entry.count + 1 });
  }
  const rows = [...sums.entries()].sort((a, b) => b[1].amount - a[1].amount);
  if (rows.length === 0 || total === 0) {
    return <p className="text-14 text-dim">Nothing is ready to claim right now.</p>;
  }
  const share = (amount: number) => (amount / total) * 100;
  return (
    <div className="flex flex-col gap-4">
      <div aria-hidden className="flex h-3 gap-1 overflow-hidden rounded-full">
        {rows.map(([type, { amount }], i) => (
          <span key={type} className="h-full" style={{ width: `max(${share(amount)}%, 8px)`, background: SHADES[i] }} />
        ))}
      </div>
      <ul className="m-0 flex flex-col gap-1 p-0">
        {rows.map(([type, { amount, count }], i) => (
          <li key={type} className="grid list-none grid-cols-[12px_minmax(0,1fr)_auto] items-center gap-x-3 py-1 text-14">
            <span aria-hidden className="size-3 rounded-full" style={{ background: SHADES[i] }} />
            <span className="min-w-0">
              {TYPE_LABEL[type]} <span className="text-dim">· {count}</span>
            </span>
            <span className="figure text-right">
              {formatMoney(amount, currency)} <span className="inline-block w-10 text-dim">{Math.round(share(amount))}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The second line of the headline: the most urgent thing, in plain words. */
function urgency(live: Finding[]): string {
  const days = live.map((f) => f.days_left).filter((d): d is number => d !== null && d >= 0);
  if (days.length === 0) return live.length > 0 ? "No claim has a deadline coming up." : "Nothing is waiting on you.";
  const today = days.filter((d) => d === 0).length;
  if (today) return today === 1 ? "One claim expires today." : `${today} claims expire today.`;
  const tomorrow = days.filter((d) => d === 1).length;
  if (tomorrow) return tomorrow === 1 ? "One claim expires tomorrow." : `${tomorrow} claims expire tomorrow.`;
  const week = days.filter((d) => d <= 7).length;
  if (week) return week === 1 ? "One claim expires this week." : `${week} claims expire this week.`;
  const next = Math.min(...days);
  return `The next deadline is in ${next} days.`;
}

/** Overview headline: what vendors owe as a sentence, then how much of everything found has come back. */
export function HeadlineHero({ summary, live, action }: { summary: Summary; live: Finding[]; action?: ReactNode }) {
  const { claimable_minor: ready, in_flight_minor: inFlight, recovered_minor: recovered, expired_minor: missed, currency } = summary;
  const total = ready + inFlight + recovered + missed;
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0);
  return (
    <section aria-label="Totals" className="flex min-w-0 flex-col gap-4">
      {/* The headline and the one action share a row; the bar below spans the full width, edge to edge with the panels. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="m-0 min-w-0 text-26 font-semibold tracking-[-0.02em] sm:text-40 sm:tracking-[-0.03em]">
          Vendors owe you <RollingMoney minor={ready} currency={currency} className="figure text-primary" />.
          <span className="block text-dim">{urgency(live)}</span>
        </h1>
        {action && <div className="flex-none sm:mb-1">{action}</div>}
      </div>
      <div className="flex flex-col gap-2">
        <div
          role="img"
          aria-label={`${formatMoney(recovered, currency)} recovered and ${formatMoney(inFlight, currency)} in flight out of ${formatMoney(total, currency)} found`}
          className="flex h-2 overflow-hidden rounded-full bg-line"
        >
          <span className="h-full bg-money transition-[width] duration-700" style={{ width: `${pct(recovered)}%` }} />
          <span
            className="h-full transition-[width] duration-700"
            style={{ width: `${pct(inFlight)}%`, background: "color-mix(in srgb, var(--primary) 45%, var(--base))" }}
          />
        </div>
        <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 text-14 text-dim">
          <span>
            <RollingMoney minor={recovered} currency={currency} className={cn("figure font-medium", recovered > 0 ? "text-money-ink" : "text-ink")} />{" "}
            recovered · <RollingMoney minor={inFlight} currency={currency} className="figure font-medium text-ink" /> in flight
          </span>
          <span>
            <RollingMoney minor={missed} currency={currency} className="figure" /> missed
          </span>
        </div>
      </div>
    </section>
  );
}
