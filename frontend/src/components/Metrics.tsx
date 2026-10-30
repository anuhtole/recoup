import { AnimatePresence, motion, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useEffect, useState } from "react";
import type { Summary } from "../api";
import { formatMoney } from "../format";
import { type Snapshot, useSummaryHistory } from "../hooks/useSummaryHistory";
import { SPRING } from "../motion";
import { LineSparkline } from "./charts/sparkline";
import { SankeyChart, SankeyLink, SankeyNode } from "./charts/sankey";
import { cn } from "@/lib/utils";

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
      aspectRatio="8 / 1"
      nodeWidth={6}
      nodePadding={20}
      margin={{ top: 10, right: 190, bottom: 10, left: 130 }}
      className="mt-2 min-h-[120px]"
      animationDuration={reduce ? 0 : 700}
      revealSignature={data.links.map((l) => l.value).join(",")}
    >
      <SankeyLink strokeOpacity={0.1} fadedOpacity={0.05} getNodeColor={(_, i) => colour(i)} />
      <SankeyNode lineCap={3} showValueLabels={false} getNodeColor={(_, i) => colour(i)} />
    </SankeyChart>
  );
}

export function Metrics({ summary }: { summary: Summary }) {
  const history = useSummaryHistory(summary);
  const [showFlow, setShowFlow] = useState(false);
  const values: Record<Tile["key"], number> = {
    claimable: summary.claimable_minor,
    in_flight: summary.in_flight_minor,
    recovered: summary.recovered_minor,
    expired: summary.expired_minor,
  };

  return (
    <section aria-label="Totals" className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {TILES.map((tile) => (
          <div key={tile.key} className="glass flex min-w-0 flex-col rounded-card px-5 py-4">
            <p className="truncate text-[13px] text-dim">{tile.label}</p>
            <div className="mt-1 flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
              <RollingMoney
                minor={values[tile.key]}
                currency={summary.currency}
                className={cn(
                  "figure truncate text-[22px] leading-tight tracking-[-0.02em] sm:text-[26px]",
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

      <div className="glass rounded-card px-5 py-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-[13px] font-medium text-dim">Where the money is</h2>
          <button
            type="button"
            aria-expanded={showFlow}
            onClick={() => setShowFlow((open) => !open)}
            className="rounded-full px-3 py-1.5 text-[13px] font-medium text-ink transition-[transform,background-color] duration-150 hover:bg-tint active:scale-[0.97] min-[900px]:hidden"
          >
            {showFlow ? "Hide the flow" : "See the flow"}
          </button>
        </div>
        <div className="hidden min-[900px]:block">
          <Flow summary={summary} />
        </div>
        <AnimatePresence initial={false}>
          {showFlow && (
            <motion.div
              key="flow"
              className="min-[900px]:hidden"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={SPRING}
            >
              <div className="-mx-2 overflow-x-auto px-2">
                <div className="min-w-[560px]">
                  <Flow summary={summary} />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
