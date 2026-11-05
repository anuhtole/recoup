import { motion } from "motion/react";
import type { Snapshot } from "../hooks/useSummaryHistory";
import { formatMoney, formatShortDate } from "../format";

const H = 88;
const W = 1000;

/**
 * Money back over time, one point per demo date: a line with a soft wash under it and no gridlines.
 * With one point, or nothing back yet, it is a flat dashed baseline that says it will fill in.
 */
export function RecoveryChart({ history, currency }: { history: Snapshot[]; currency: string }) {
  const points = history.map((s) => ({ at: s.as_of, v: s.recovered }));
  const max = Math.max(...points.map((p) => p.v), 0);
  const isFlat = points.length < 2 || max === 0;
  const first = points[0];
  const last = points[points.length - 1];

  if (isFlat || !first || !last) {
    return (
      <figure className="m-0 flex flex-col gap-2" aria-label="Recovered over time">
        <svg viewBox={`0 0 ${W} 8`} preserveAspectRatio="none" className="h-2 w-full" aria-hidden>
          <line x1="0" x2={W} y1="7" y2="7" stroke="var(--line-strong)" strokeDasharray="4 6" vectorEffect="non-scaling-stroke" />
        </svg>
        <figcaption className="flex items-center justify-between gap-4 text-13 text-dim">
          <span>Chart fills in as money comes back.</span>
          {last && <span className="ref text-11 uppercase">{formatShortDate(last.at)}</span>}
        </figcaption>
      </figure>
    );
  }

  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => H - 4 - (v / max) * (H - 12);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;
  return (
    <figure
      className="m-0 flex flex-col gap-2"
      aria-label={`Recovered over time: ${formatMoney(first.v, currency)} on ${formatShortDate(first.at)}, ${formatMoney(last.v, currency)} on ${formatShortDate(last.at)}`}
    >
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[88px] w-full overflow-visible" aria-hidden>
          <motion.path
            d={area}
            fill="var(--mint-wash)"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          />
          <motion.path
            d={line}
            fill="none"
            stroke="var(--mint-ink)"
            strokeWidth={2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            // pathLength can't be used here: it miscounts with a non-scaling stroke and stops short.
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />
          <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} stroke="var(--line)" vectorEffect="non-scaling-stroke" />
        </svg>
        <span
          aria-hidden
          className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-mint-ink ring-4 ring-mint-wash"
          style={{ left: "100%", top: `${(y(last.v) / H) * 100}%` }}
        />
      </div>
      <figcaption className="ref flex items-center justify-between gap-4 text-11 uppercase text-dim">
        <span>{formatShortDate(first.at)}</span>
        <span>{formatShortDate(last.at)}</span>
      </figcaption>
    </figure>
  );
}
