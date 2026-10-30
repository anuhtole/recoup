import { AnimatePresence, motion, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useEffect, useState } from "react";
import type { Summary } from "../api";
import { formatMoney } from "../format";
import { useMediaQuery } from "../hooks/useIsNarrow";
import { type Snapshot, useSummaryHistory } from "../hooks/useSummaryHistory";
import { SPRING } from "../motion";
import { LineSparkline } from "./charts/sparkline";
import { SankeyChart, SankeyLink, SankeyNode } from "./charts/sankey";
import { cn } from "@/lib/utils";

const FLOW_KEY = "recoup.flow";

interface Tile {
  key: keyof Omit<Snapshot, "as_of">;
  label: string;
  isMoneyBack?: boolean;
  isMuted?: boolean;
}

const TILES: Tile[] = [
  { key: "claimable", label: "Ready to claim" },
  { key: "in_flight", label: "Waiting on vendors" },
  { key: "recovered", label: "Recovered", isMoneyBack: true },
  { key: "expired", label: "Missed", isMuted: true },
];

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

function Flow({ summary }: { summary: Summary }) {
  const reduce = useReducedMotion();
  const requested = summary.in_flight_minor + summary.recovered_minor;
  const found = summary.claimable_minor + requested + summary.expired_minor;
  const nodes = [
    { name: "Found", category: "source" as const },
    { name: "Ready to claim" },
    { name: "Missed" },
    { name: "Requested" },
    { name: "Recovered" },
  ];
  const links = [
    { source: 0, target: 1, value: summary.claimable_minor },
    { source: 0, target: 2, value: summary.expired_minor },
    { source: 0, target: 3, value: requested },
    { source: 3, target: 4, value: summary.recovered_minor },
  ].filter((link) => link.value > 0);
  // Keep only nodes that carry money, and renumber the links to match.
  const used = [...new Set(links.flatMap((l) => [l.source, l.target]))].sort((a, b) => a - b);
  const data = {
    nodes: used.map((i) => nodes[i]),
    links: links.map((l) => ({ ...l, source: used.indexOf(l.source), target: used.indexOf(l.target) })),
  };
  // One-line labels that carry their amount, so small flows never stack two lines on each other.
  const totals = [found, summary.claimable_minor, summary.expired_minor, requested, summary.recovered_minor];
  const labelled = {
    ...data,
    nodes: used.map((i) => ({ ...nodes[i], name: `${nodes[i].name}  ${formatMoney(totals[i], summary.currency)}` })),
  };
  if (found === 0 || data.links.length === 0) {
    return <p className="py-6 text-sm text-dim">The flow appears once Recoup finds money owed.</p>;
  }
  const colourOf = ["var(--ink)", "var(--ink)", "var(--dim)", "var(--dim)", "var(--money)"];
  const colour = (index: number) => colourOf[used[index]];
  return (
    <SankeyChart
      data={labelled}
      aspectRatio="11 / 1"
      nodeWidth={6}
      nodePadding={24}
      margin={{ top: 6, right: 190, bottom: 6, left: 130 }}
      className="min-h-[104px]"
      animationDuration={reduce ? 0 : 700}
      revealSignature={data.links.map((l) => l.value).join(",")}
    >
      <SankeyLink strokeOpacity={0.1} fadedOpacity={0.05} getNodeColor={(_, i) => colour(i)} />
      <SankeyNode lineCap={3} showValueLabels={false} getNodeColor={(_, i) => colour(i)} />
    </SankeyChart>
  );
}

/** The same flow as a list, for phones: nothing to clip at any width. */
function FlowList({ summary }: { summary: Summary }) {
  const money = (minor: number) => formatMoney(minor, summary.currency);
  const requested = summary.in_flight_minor + summary.recovered_minor;
  const found = summary.claimable_minor + requested + summary.expired_minor;
  const rows: { label: string; value: number; depth: 0 | 1 | 2; tone?: "money" | "dim" }[] = [
    { label: "Found", value: found, depth: 0 },
    { label: "Ready to claim", value: summary.claimable_minor, depth: 1 },
    { label: "Requested", value: requested, depth: 1 },
    { label: "Recovered", value: summary.recovered_minor, depth: 2, tone: "money" },
    { label: "Missed", value: summary.expired_minor, depth: 1, tone: "dim" },
  ];
  return (
    <ul className="m-0 flex flex-col p-0">
      {rows.map((row) => (
        <li
          key={row.label}
          className={cn(
            "flex list-none items-baseline justify-between gap-4 border-t border-line py-2.5 text-sm first:border-t-0 first:pt-0 last:pb-0",
            row.depth === 1 && "pl-4",
            row.depth === 2 && "pl-8",
          )}
        >
          <span className={cn("min-w-0 truncate", row.depth === 0 ? "font-medium" : "text-dim")}>
            {row.depth > 0 && <span aria-hidden className="mr-1.5 text-dim">↳</span>}
            {row.label}
          </span>
          <span
            className={cn(
              "figure flex-none",
              row.depth === 0 && "font-medium",
              row.tone === "money" && row.value > 0 && "text-money-ink",
              row.tone === "dim" && "text-dim",
            )}
          >
            {money(row.value)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Metrics({ summary }: { summary: Summary }) {
  const history = useSummaryHistory(summary);
  // The flow is a detail: closed by default, and the choice is remembered for the session.
  const [showFlow, setShowFlow] = useState(() => {
    try {
      return sessionStorage.getItem(FLOW_KEY) === "open";
    } catch {
      return false;
    }
  });
  const isPhone = useMediaQuery("(max-width: 639px)");
  const toggleFlow = (open: boolean) => {
    setShowFlow(open);
    try {
      sessionStorage.setItem(FLOW_KEY, open ? "open" : "closed");
    } catch {
      // Storage unavailable; the toggle still works for this page.
    }
  };
  const values: Record<Tile["key"], number> = {
    claimable: summary.claimable_minor,
    in_flight: summary.in_flight_minor,
    recovered: summary.recovered_minor,
    expired: summary.expired_minor,
  };

  return (
    <section aria-label="Totals" className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 min-[360px]:grid-cols-2 lg:grid-cols-4">
        {TILES.map((tile) => (
          <div key={tile.key} className="glass flex min-w-0 flex-col rounded-card px-5 py-4">
            <p className="truncate text-[13px] text-dim">{tile.label}</p>
            <div className="mt-1 flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
              <RollingMoney
                minor={values[tile.key]}
                currency={summary.currency}
                className={cn(
                  "figure truncate text-[22px] font-semibold leading-tight tracking-[-0.02em] sm:text-[26px]",
                  tile.isMoneyBack && values[tile.key] > 0 && "text-money",
                  tile.isMuted && "text-dim",
                )}
              />
              {/* One snapshot per demo advance; a single point draws no line. */}
              {history.length > 1 && (
                <div className="mb-1 w-20 flex-none">
                  <LineSparkline
                    data={history}
                    dataKey={tile.key}
                    height={26}
                    strokeWidth={1.5}
                    color={tile.isMoneyBack ? "var(--money)" : "var(--dim)"}
                    endDot
                    crosshair={false}
                    aria-label={`${tile.label} after each two-week step: ${history
                      .map((h) => formatMoney(h[tile.key], summary.currency))
                      .join(", ")}`}
                  />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col">
        <button
          type="button"
          aria-expanded={showFlow}
          aria-controls="money-flow"
          onClick={() => toggleFlow(!showFlow)}
          className="inline-flex items-center gap-1.5 self-start rounded-md py-1 text-[13px] font-medium text-dim transition-[transform,color] duration-150 hover:text-ink active:scale-[0.97]"
        >
          {showFlow ? "Hide where the money went" : "See where the money went"}
          <svg viewBox="0 0 16 16" aria-hidden className={cn("size-3.5 transition-transform duration-200", showFlow && "rotate-180")} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
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
              <div className="glass mt-2 rounded-card px-5 py-4">
                {isPhone ? <FlowList summary={summary} /> : <Flow summary={summary} />}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
