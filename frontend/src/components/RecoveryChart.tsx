import { motion } from "motion/react";
import type { Snapshot } from "../hooks/useSummaryHistory";
import { formatDate, formatMoney } from "../format";

const H = 64;
const W = 1000;
const DAY = 86_400_000;

/**
 * True when there is a line worth drawing: two or more real points, and the total actually moved between
 * them. One credit and today's unchanged total would draw a flat bar that says less than the stat line.
 */
export function hasRecoveryChart(history: Snapshot[]): boolean {
  return history.length >= 2 && history.some((s) => s.recovered > 0) && new Set(history.map((s) => s.recovered)).size >= 2;
}

/**
 * Money back over time: a mint line through each real point, spaced by date, with a soft wash under it,
 * the latest total labelled at its dot, and no gridlines. With fewer than two points it is absent.
 */
export function RecoveryChart({ history, currency }: { history: Snapshot[]; currency: string }) {
  if (!hasRecoveryChart(history)) return null;
  const points = history.map((s) => ({ t: Date.parse(`${s.as_of}T12:00:00Z`), at: s.as_of, v: s.recovered }));
  const max = Math.max(...points.map((p) => p.v));
  const first = points[0];
  const last = points[points.length - 1];
  const span = Math.max(DAY, last.t - first.t);

  const x = (t: number) => ((t - first.t) / span) * W;
  const y = (v: number) => H - 4 - (v / max) * (H - 12);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;
  const top = (y(last.v) / H) * 100;
  return (
    <figure
      className="m-0 flex flex-col gap-2"
      aria-label={`Recovered over time: ${formatMoney(first.v, currency)} on ${formatDate(first.at)}, ${formatMoney(last.v, currency)} on ${formatDate(last.at)}`}
    >
      <div className="relative pr-1">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-16 w-full overflow-visible" aria-hidden>
          <motion.path d={area} fill="var(--mint-wash)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, ease: "easeOut" }} />
          <motion.path
            d={line}
            fill="none"
            stroke="var(--mint-ink)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />
        </svg>
        <span
          aria-hidden
          className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-mint-ink ring-4 ring-mint-wash"
          style={{ left: "100%", top: `${top}%` }}
        />
        <span
          aria-hidden
          className="figure absolute right-0 -translate-y-full whitespace-nowrap pb-2 text-12 font-medium text-mint-ink"
          style={{ top: `${top}%` }}
        >
          {formatMoney(last.v, currency)}
        </span>
      </div>
      <figcaption className="figure flex items-center justify-between gap-4 text-12 text-dim">
        <span>{formatDate(first.at, "short")}</span>
        <span>{formatDate(last.at, "short")}</span>
      </figcaption>
    </figure>
  );
}
