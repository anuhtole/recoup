import { AnimatePresence, motion, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useEffect, useState } from "react";
import type { Finding, LeakType, Summary } from "../api";
import { formatMoney } from "../format";
import { type Snapshot, useSummaryHistory } from "../hooks/useSummaryHistory";
import { SPRING } from "../motion";
import { LineSparkline } from "./charts/sparkline";
import { cn } from "@/lib/utils";

const FLOW_KEY = "recoup.flow";

/** A money figure that rolls to its new value on a spring (a jump under reduced motion). */
function RollingMoney({ minor, currency, className }: { minor: number; currency: string; className?: string }) {
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
};

// Four steps of the one primary blue, darkest for the largest share.
const SHADES = [
  "var(--primary)",
  "color-mix(in srgb, var(--primary) 62%, var(--base))",
  "color-mix(in srgb, var(--primary) 38%, var(--base))",
  "color-mix(in srgb, var(--primary) 20%, var(--base))",
];

/** Ready to claim, split by the kind of leak: one stacked bar and the same numbers as a list. */
function ByType({ findings, total, currency }: { findings: Finding[]; total: number; currency: string }) {
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
      <p className="text-14 font-semibold">Ready to claim, by type</p>
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

export function Metrics({ summary, findings }: { summary: Summary; findings: Finding[] }) {
  const history = useSummaryHistory(summary);
  // The breakdown is a detail: closed by default, and the choice is remembered for the session.
  const [showFlow, setShowFlow] = useState(() => {
    try {
      return sessionStorage.getItem(FLOW_KEY) === "open";
    } catch {
      return false;
    }
  });
  const toggleFlow = (open: boolean) => {
    setShowFlow(open);
    try {
      sessionStorage.setItem(FLOW_KEY, open ? "open" : "closed");
    } catch {
      // Storage unavailable; the toggle still works for this page.
    }
  };
  const strip: { key: keyof Omit<Snapshot, "as_of">; label: string; value: number; className?: string }[] = [
    { key: "in_flight", label: "In flight", value: summary.in_flight_minor },
    {
      key: "recovered",
      label: "Recovered",
      value: summary.recovered_minor,
      className: summary.recovered_minor > 0 ? "text-money-ink" : undefined,
    },
    { key: "expired", label: "Missed", value: summary.expired_minor, className: "text-dim" },
  ];

  return (
    <section aria-label="Totals" className="flex flex-col gap-2 sm:gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div className="min-w-0">
          <p className="text-14 text-dim">Ready to claim</p>
          <div className="flex items-end gap-4">
            <RollingMoney
              minor={summary.claimable_minor}
              currency={summary.currency}
              className="figure text-26 font-semibold tracking-[-0.02em] sm:text-40 sm:tracking-[-0.03em]"
            />
            {/* One snapshot per demo advance; a single point draws no line. */}
            {history.length > 1 && (
              <div className="mb-2 w-24 flex-none sm:w-28">
                <LineSparkline
                  data={history}
                  dataKey="claimable"
                  height={28}
                  strokeWidth={1.5}
                  color="var(--dim)"
                  endDot
                  crosshair={false}
                  aria-label={`Ready to claim after each two-week step: ${history
                    .map((h) => formatMoney(h.claimable, summary.currency))
                    .join(", ")}`}
                />
              </div>
            )}
          </div>
        </div>
        <dl className="m-0 grid w-full grid-cols-3 gap-4 sm:flex sm:w-auto sm:gap-8">
          {strip.map((item) => (
            <div key={item.key} className="min-w-0">
              <dt className="truncate text-12 text-dim sm:text-14">{item.label}</dt>
              <dd className="m-0">
                <RollingMoney
                  minor={item.value}
                  currency={summary.currency}
                  className={cn("figure text-16 font-semibold sm:text-20", item.className)}
                />
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="flex flex-col">
        <button
          type="button"
          aria-expanded={showFlow}
          aria-controls="money-flow"
          onClick={() => toggleFlow(!showFlow)}
          className="inline-flex items-center gap-2 self-start py-1 text-14 font-medium text-dim transition-[transform,color] duration-150 hover:text-ink active:scale-[0.97]"
        >
          {showFlow ? "Hide where the money went" : "See where the money went"}
          <svg
            viewBox="0 0 16 16"
            aria-hidden
            className={cn("size-4 transition-transform duration-200", showFlow && "rotate-180")}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>
        <AnimatePresence initial={false}>
          {showFlow && (
            <motion.div
              key="flow"
              id="money-flow"
              className="overflow-hidden"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={SPRING}
            >
              <div className="mt-2 max-w-[720px] rounded-card bg-tint p-5">
                <ByType findings={findings} total={summary.claimable_minor} currency={summary.currency} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
