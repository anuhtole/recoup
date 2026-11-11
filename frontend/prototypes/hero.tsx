// Prototype only: three Overview hero options behind a picker (keys 1–3). Nothing in the app imports this.
import { useEffect, useMemo, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig, motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import "./hero.css";
import type { Finding, Summary } from "../src/api";
import { Button } from "../src/components/Button";
import { Money } from "../src/components/Money";
import { hasRecoveryChart, RecoveryChart } from "../src/components/RecoveryChart";
import { Shell } from "../src/components/shell/Shell";
import { formatDate, formatMoney, plural, setReferenceYear } from "../src/format";
import { useCases } from "../src/hooks/useCases";
import { useSources } from "../src/hooks/useSources";
import { useRecoveryHistory } from "../src/hooks/useSummaryHistory";
import { cn } from "../src/lib/utils";
import { SPRING } from "../src/motion";
import { Overview } from "../src/pages/Overview";
import { countsFor, rowsFor } from "../src/queue";
import { isUrgent } from "../src/theme";

interface HeroData {
  summary: Summary;
  findings: Finding[];
  live: Finding[];
  ready: number;
  missed: number;
  onReview: () => void;
}

/* ---------- shared pieces (copies of what Overview.tsx's hero uses today) ---------- */

function urgency(live: Finding[]): string | null {
  const days = live.map((f) => f.days_left).filter((d): d is number => d !== null && d >= 0);
  const count = (pred: (d: number) => boolean) => days.filter(pred).length;
  const today = count((d) => d === 0);
  if (today) return today === 1 ? "1 expires today" : `${today} expire today`;
  const tomorrow = count((d) => d === 1);
  if (tomorrow) return tomorrow === 1 ? "1 expires tomorrow" : `${tomorrow} expire tomorrow`;
  const week = count((d) => d <= 7);
  if (week) return week === 1 ? "1 expires this week" : `${week} expire this week`;
  return null;
}

function dayIso(asOf: string, offset: number): string {
  const date = new Date(`${asOf.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function Headline({ id, data, isOnInk = false }: { id: string; data: HeroData; isOnInk?: boolean }) {
  const { summary, live, ready } = data;
  const soon = urgency(live);
  return (
    <>
      <h2 id={id} className={cn("m-0 text-13 font-medium", isOnInk ? "text-sub" : "text-dim")}>
        Open claims
      </h2>
      {ready > 0 ? (
        <p className="m-0 mt-1 text-44 font-semibold tracking-[-0.02em] md:text-56">
          <Money minor={ready} currency={summary.currency} roll />
        </p>
      ) : (
        <p className={cn("m-0 mt-1 text-28 font-semibold", isOnInk ? "text-sub" : "text-dim")}>—</p>
      )}
      <p className="m-0 mt-2 flex flex-wrap items-center gap-x-2 text-14">
        <span>{live.length > 0 ? plural(live.length, "claim") : "Nothing to claim right now"}</span>
        {soon && (
          <>
            <span aria-hidden className={isOnInk ? "text-sub" : "text-line-strong"}>
              ·
            </span>
            <span className={cn("inline-flex items-center gap-1.5 font-medium", isOnInk ? "text-amber" : "text-amber-ink")}>
              <span aria-hidden className="size-1.5 rounded-full bg-amber" />
              {soon}
            </span>
          </>
        )}
      </p>
    </>
  );
}

function ReviewButton({ data, className }: { data: HeroData; className?: string }) {
  if (data.live.length === 0) return null;
  return (
    <Button variant="primary" size="lg" onClick={data.onReview} className={className}>
      Review claims
      <ArrowRight aria-hidden className="size-4" strokeWidth={2} />
    </Button>
  );
}

function Totals({ data, isOnInk = false, className }: { data: HeroData; isOnInk?: boolean; className?: string }) {
  const { summary, missed } = data;
  const stats = [
    { label: "In flight", minor: summary.in_flight_minor },
    { label: "Recovered", minor: summary.recovered_minor, tone: "mint" as const },
    { label: "Window closed", minor: missed, href: "/#/claims?tab=closed" },
  ].filter((stat) => stat.minor > 0);
  if (stats.length === 0) return null;
  const quiet = isOnInk ? "text-sub" : "text-dim";
  return (
    <p data-totals className={cn("m-0 flex flex-wrap gap-x-3 gap-y-1 text-13", className)}>
      {stats.map((stat, i) => {
        const body = (
          <>
            {stat.label}{" "}
            <span className={cn("figure font-medium", stat.tone === "mint" ? (isOnInk ? "text-mint" : "text-mint-ink") : quiet)}>
              {formatMoney(stat.minor, summary.currency)}
            </span>
          </>
        );
        return (
          <span key={stat.label} className="flex gap-x-3">
            {i > 0 && (
              <span aria-hidden className={isOnInk ? "text-sub" : "text-line-strong"}>
                ·
              </span>
            )}
            {stat.href ? (
              <a
                href={stat.href}
                className={cn(
                  "whitespace-nowrap underline decoration-transparent underline-offset-4 transition-colors",
                  quiet,
                  isOnInk ? "hover:text-white hover:decoration-sub" : "hover:text-ink hover:decoration-line-strong",
                )}
              >
                {body}
              </a>
            ) : (
              <span className={cn("whitespace-nowrap", quiet)}>{body}</span>
            )}
          </span>
        );
      })}
    </p>
  );
}

function History({ data }: { data: HeroData }) {
  const history = useRecoveryHistory(data.summary, data.findings);
  if (!hasRecoveryChart(history)) return null;
  return <RecoveryChart history={history} currency={data.summary.currency} />;
}

/* ---------- 1 · Deadline timeline ---------- */

interface Week {
  index: number;
  minor: number;
  count: number;
  isUrgent: boolean;
  range: string;
  month: string;
}

function weekBins(live: Finding[], asOf: string): Week[] {
  const dated = live.filter((f) => f.days_left !== null && f.days_left >= 0);
  const last = Math.max(0, ...dated.map((f) => f.days_left ?? 0));
  const size = Math.min(26, Math.max(8, Math.ceil((last + 1) / 7)));
  const weeks: Week[] = Array.from({ length: size }, (_, index) => {
    const from = dayIso(asOf, index * 7);
    const to = dayIso(asOf, index * 7 + 6);
    // A month label sits under the first week, and under each week that holds the 1st of a month.
    const starts = to.slice(8) <= "07" && from.slice(5, 7) !== to.slice(5, 7) ? to : from.slice(8) === "01" ? from : null;
    const labelled = index === 0 ? from : starts;
    return {
      index,
      minor: 0,
      count: 0,
      isUrgent: false,
      range: `${formatDate(from, "short")} – ${formatDate(to, "short")}`,
      month: labelled ? new Date(`${labelled}T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" }) : "",
    };
  });
  for (const f of dated) {
    const week = weeks[Math.min(size - 1, Math.floor((f.days_left ?? 0) / 7))];
    week.minor += f.amount_minor;
    week.count += 1;
    week.isUrgent = week.isUrgent || isUrgent(f.days_left);
  }
  return weeks;
}

const BAR_AREA = 120;

function Timeline({ data }: { data: HeroData }) {
  const { live, summary } = data;
  const weeks = useMemo(() => weekBins(live, summary.as_of), [live, summary.as_of]);
  const peak = Math.max(1, ...weeks.map((w) => w.minor));
  const first = Math.max(0, weeks.findIndex((w) => w.count > 0));
  const [hover, setHover] = useState<number | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const active = hover ?? picked ?? first;
  const isFocused = hover !== null || picked !== null;
  const week = weeks[active];

  const step = (dir: 1 | -1) => {
    let i = active + dir;
    while (i >= 0 && i < weeks.length && weeks[i].count === 0) i += dir;
    if (i >= 0 && i < weeks.length) setPicked(i);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowRight") step(1);
    else if (event.key === "ArrowLeft") step(-1);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <figure className="m-0 flex min-w-0 flex-col gap-3" aria-label="Open claims by the week they are due">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-13">
        <span className="font-medium text-dim">Due by week</span>
        <span aria-live="polite" className="figure">
          <span className={cn("font-medium", week.isUrgent && "text-amber-ink")}>{week.range}</span>
          <span className="text-dim"> · {week.count > 0 ? plural(week.count, "claim") : "Nothing due"}</span>
          {week.count > 0 && (
            <>
              <span className="text-dim"> · </span>
              <span className="font-medium">{formatMoney(week.minor, summary.currency)}</span>
            </>
          )}
        </span>
      </figcaption>
      <div
        role="listbox"
        tabIndex={0}
        aria-label="Weeks. Use the left and right arrow keys."
        aria-activedescendant={`hero-week-${active}`}
        onKeyDown={onKeyDown}
        onPointerLeave={() => setHover(null)}
        onBlur={() => setPicked(null)}
        className="flex items-end gap-1 rounded-xs border-b border-line md:gap-1.5"
        style={{ height: BAR_AREA }}
      >
        {weeks.map((w) => (
          <div
            key={w.index}
            id={`hero-week-${w.index}`}
            role="option"
            aria-selected={w.index === active}
            aria-label={`${w.range}: ${w.count > 0 ? `${plural(w.count, "claim")}, ${formatMoney(w.minor, summary.currency)}` : "nothing due"}`}
            onPointerEnter={() => setHover(w.index)}
            onClick={() => setPicked(w.index)}
            className="flex h-full min-w-0 flex-1 items-end"
          >
            {w.count > 0 ? (
              <motion.div
                initial={{ scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{ ...SPRING, delay: w.index * 0.02 }}
                style={{ height: Math.max(4, Math.round((w.minor / peak) * BAR_AREA)), originY: 1 }}
                className={cn(
                  "w-full rounded-t-xs transition-opacity duration-150",
                  w.isUrgent ? "bg-amber" : "bg-ink",
                  isFocused && w.index !== active && "opacity-25",
                )}
              />
            ) : (
              <div className={cn("h-0.5 w-full bg-line transition-opacity duration-150", isFocused && w.index === active && "bg-line-strong")} />
            )}
          </div>
        ))}
      </div>
      <div aria-hidden className="flex gap-1 text-12 text-dim md:gap-1.5">
        {weeks.map((w) => (
          <span key={w.index} className="min-w-0 flex-1 whitespace-nowrap">
            {w.month}
          </span>
        ))}
      </div>
    </figure>
  );
}

function HeroTimeline({ data }: { data: HeroData }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-x-12 gap-y-8 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] xl:items-end">
        <div className="flex min-w-0 flex-col">
          <Headline id="hero-1" data={data} />
          <ReviewButton data={data} className="mt-6 w-full sm:w-auto sm:self-start" />
          <Totals data={data} className="mt-5" />
        </div>
        {data.live.length > 0 && <Timeline data={data} />}
      </div>
      <History data={data} />
    </div>
  );
}

/* ---------- 2 · Urgency breakdown ---------- */

const BUCKETS = [
  { key: "week", label: "This week", holds: (d: number | null) => d !== null && d <= 7, fill: "bg-amber" },
  { key: "month", label: "Next 30 days", holds: (d: number | null) => d !== null && d > 7 && d <= 30, fill: "bg-ink" },
  { key: "later", label: "Later", holds: (d: number | null) => d === null || d > 30, fill: "bg-line-strong" },
] as const;

function HeroBreakdown({ data }: { data: HeroData }) {
  const { live, summary } = data;
  const [focus, setFocus] = useState<string | null>(null);
  const buckets = BUCKETS.map((bucket) => {
    const rows = live.filter((f) => bucket.holds(f.days_left));
    return { ...bucket, count: rows.length, minor: rows.reduce((sum, f) => sum + f.amount_minor, 0) };
  });
  const dim = (key: string) => focus !== null && focus !== key && "opacity-30";

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-x-12 gap-y-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] xl:items-end">
        <div className="flex min-w-0 flex-col">
          <Headline id="hero-2" data={data} />
        </div>
        {live.length > 0 && (
          <dl className="m-0 grid grid-cols-3" onPointerLeave={() => setFocus(null)}>
            {buckets.map((bucket) => (
              <div
                key={bucket.key}
                onPointerEnter={() => setFocus(bucket.key)}
                className={cn("flex min-w-0 flex-col gap-1 border-l border-line pl-3 transition-opacity duration-150 md:pl-6", dim(bucket.key))}
              >
                <dt className="flex items-center gap-1.5 text-13 text-dim">
                  <span aria-hidden className={cn("size-2 shrink-0 rounded-full", bucket.fill)} />
                  <span className="truncate">{bucket.label}</span>
                </dt>
                <dd className="m-0 flex flex-col">
                  {bucket.count > 0 ? (
                    <span className="figure text-16 font-semibold tracking-[-0.01em] md:text-20">{formatMoney(bucket.minor, summary.currency)}</span>
                  ) : (
                    <span className="text-16 font-semibold text-dim md:text-20">—</span>
                  )}
                  <span className="text-13 text-dim">{bucket.count > 0 ? plural(bucket.count, "claim") : "None"}</span>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {live.length > 0 && (
        <motion.div
          aria-hidden
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={SPRING}
          style={{ originX: 0 }}
          className="flex h-3 gap-0.5"
          onPointerLeave={() => setFocus(null)}
        >
          {buckets
            .filter((bucket) => bucket.minor > 0)
            .map((bucket) => (
              <div
                key={bucket.key}
                onPointerEnter={() => setFocus(bucket.key)}
                style={{ flexGrow: bucket.minor }}
                className={cn("min-w-2 basis-0 rounded-xs transition-opacity duration-150", bucket.fill, dim(bucket.key))}
              />
            ))}
        </motion.div>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <ReviewButton data={data} className="w-full sm:w-auto" />
        <Totals data={data} />
      </div>
      <History data={data} />
    </div>
  );
}

/* ---------- 3 · Ink panel ---------- */

const CURVE_W = 1000;
const CURVE_H = 144;
const CURVE_TOP = 6;

function Runway({ data }: { data: HeroData }) {
  const { live, summary, ready } = data;
  const drops = useMemo(() => {
    const byDay = new Map<number, number>();
    for (const f of live) {
      if (f.days_left === null || f.days_left < 0) continue;
      byDay.set(f.days_left, (byDay.get(f.days_left) ?? 0) + f.amount_minor);
    }
    return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([day, minor]) => ({ day, minor }));
  }, [live]);
  const lastDay = drops.length > 0 ? drops[drops.length - 1].day : 1;
  const span = Math.max(1, lastDay * 1.04);
  const [scrub, setScrub] = useState<number | null>(null);
  const day = scrub ?? drops[0]?.day ?? 0;
  const left = (d: number) => drops.filter((drop) => drop.day > d).reduce((sum, drop) => sum + drop.minor, 0);
  const remaining = left(day);

  const x = (d: number) => (d / span) * CURVE_W;
  const y = (minor: number) => CURVE_TOP + (1 - minor / Math.max(1, ready)) * (CURVE_H - CURVE_TOP);
  let line = `M0 ${y(ready)}`;
  let running = ready;
  for (const drop of drops) {
    running -= drop.minor;
    line += ` H${x(drop.day)} V${y(running)}`;
  }
  line += ` H${CURVE_W}`;

  const onPointer = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const at = Math.round(((event.clientX - box.left) / box.width) * span);
    setScrub(Math.min(lastDay, Math.max(0, at)));
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const days = drops.map((drop) => drop.day);
    let next: number | undefined;
    if (event.key === "ArrowRight") next = days.find((d) => d > day);
    else if (event.key === "ArrowLeft") next = [...days].reverse().find((d) => d < day) ?? 0;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = lastDay;
    else return;
    event.preventDefault();
    event.stopPropagation();
    if (next !== undefined) setScrub(next);
  };

  const readout = `After ${formatDate(dayIso(summary.as_of, day), "short")}`;
  const amount = remaining > 0 ? formatMoney(remaining, summary.currency) : "Nothing left to claim";
  const isHot = isUrgent(day);

  return (
    <figure className="m-0 flex min-w-0 flex-col gap-3" aria-label="How much is still claimable as deadlines pass">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-13">
        <span className="font-medium text-sub">Still claimable if you wait</span>
        <span className="figure">
          <span className={cn("font-medium", isHot ? "text-amber" : "text-sub")}>{readout}</span>
          <span className="text-sub"> · </span>
          <span className="font-medium text-white">{amount}</span>
        </span>
      </figcaption>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Day"
        aria-valuemin={0}
        aria-valuemax={lastDay}
        aria-valuenow={day}
        aria-valuetext={`${readout}: ${amount}`}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={() => setScrub(null)}
        onBlur={() => setScrub(null)}
        onKeyDown={onKeyDown}
        className="relative h-36 touch-pan-y rounded-xs"
      >
        <svg viewBox={`0 0 ${CURVE_W} ${CURVE_H}`} preserveAspectRatio="none" className="size-full overflow-visible" aria-hidden>
          <motion.path
            d={`${line} V${CURVE_H} H0 Z`}
            fill="var(--mint)"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.1 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          />
          <motion.path
            d={line}
            fill="none"
            stroke="var(--mint)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />
        </svg>
        <span aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-rule" style={{ left: `${(x(day) / CURVE_W) * 100}%` }} />
        <span
          aria-hidden
          className={cn("pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-4 ring-panel", isHot ? "bg-amber" : "bg-mint")}
          style={{ left: `${(x(day) / CURVE_W) * 100}%`, top: `${(y(remaining) / CURVE_H) * 100}%` }}
        />
      </div>
      <div aria-hidden className="figure flex items-center justify-between gap-4 text-12 text-sub">
        <span>Today</span>
        <span>{formatDate(dayIso(summary.as_of, lastDay), "short")}</span>
      </div>
    </figure>
  );
}

function HeroInk({ data }: { data: HeroData }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="on-ink grid grid-cols-1 gap-x-12 gap-y-8 rounded-md bg-panel p-6 text-white md:p-8 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] xl:items-end">
        <div className="flex min-w-0 flex-col">
          <Headline id="hero-3" data={data} isOnInk />
          <ReviewButton data={data} className="mt-6 w-full sm:w-auto sm:self-start" />
          <Totals data={data} isOnInk className="mt-5" />
        </div>
        {data.live.length > 0 && <Runway data={data} />}
      </div>
      <History data={data} />
    </div>
  );
}

/* ---------- harness ---------- */

const VARIANTS: { name: string; render: (data: HeroData) => ReactNode }[] = [
  { name: "Deadline timeline", render: (data) => <HeroTimeline data={data} /> },
  { name: "Urgency breakdown", render: (data) => <HeroBreakdown data={data} /> },
  { name: "Ink panel", render: (data) => <HeroInk data={data} /> },
];

const START = Math.min(VARIANTS.length, Math.max(1, Number(/^#v(\d)$/.exec(location.hash)?.[1] ?? 1)));
const go = (hash: string) => location.assign(`/${hash}`);

function Harness() {
  const { summary, findings, error } = useCases();
  const { sources } = useSources();
  if (summary) setReferenceYear(summary.as_of);
  const isLoaded = summary !== null;

  // The picker looks for the variant sections when it boots, so it loads once they exist.
  useEffect(() => {
    if (!isLoaded || document.querySelector("script[data-picker]")) return;
    const script = document.createElement("script");
    script.src = "./picker.js";
    script.dataset.picker = "";
    document.body.appendChild(script);
  }, [isLoaded]);

  // Links inside the real Overview use the app's hash routes; send those to the app itself.
  useEffect(() => {
    const onHash = () => {
      if (location.hash.startsWith("#/")) go(location.hash);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const live = rowsFor(findings, "todo");
  const data: HeroData | null = summary && {
    summary,
    findings,
    live,
    ready: live.reduce((sum, f) => sum + f.amount_minor, 0),
    missed:
      summary.expired_minor +
      rowsFor(findings, "closed")
        .filter((f) => f.status !== "expired")
        .reduce((sum, f) => sum + f.amount_minor, 0),
    onReview: () => go("#/claims"),
  };

  return (
    <MotionConfig reducedMotion="user">
      <style>{`
        section[aria-labelledby="hero-label"] { display: none; }
        .on-ink .cents { color: var(--sub); }
      `}</style>
      <Shell
        page="overview"
        title="Overview"
        claimsCount={countsFor(findings).todo}
        summary={summary}
        sources={sources}
        findings={findings}
        isRunning={false}
        isAdvancing={false}
        onRun={() => {}}
        onAdvance={() => {}}
        onExport={() => {}}
        onOpenCase={(id) => go(`#/claims/${id}`)}
        onGo={(page) => go(`#/${page}`)}
      >
        {error && <p className="m-0 text-14 text-danger">{error}</p>}
        {data && (
          <div className="flex flex-col gap-12">
            {VARIANTS.map((variant, i) => (
              <section key={variant.name} data-variant={i + 1} data-name={variant.name} aria-labelledby={`hero-${i + 1}`} hidden={i + 1 !== START}>
                {variant.render(data)}
              </section>
            ))}
            <Overview summary={data.summary} findings={findings} onReview={data.onReview} onExport={() => {}} />
          </div>
        )}
      </Shell>
    </MotionConfig>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
