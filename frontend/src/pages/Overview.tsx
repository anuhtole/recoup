import { useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, Download } from "lucide-react";
import type { Finding, LeakType, Summary } from "../api";
import { Button } from "../components/Button";
import { Money } from "../components/Money";
import { hasRecoveryChart, RecoveryChart } from "../components/RecoveryChart";
import { Section, SectionLink } from "../components/Section";
import { TopBarActions } from "../components/shell/TopBarActions";
import { VendorLogo } from "../components/VendorLogo";
import { daysHint, formatDate, formatMoney, plural } from "../format";
import { useRecoveryHistory } from "../hooks/useSummaryHistory";
import { vendorName } from "../lib/vendors";
import { SPRING } from "../motion";
import { rowsFor } from "../queue";
import { typeGroup, typeLabel } from "../lib/claimTypes";
import { isUrgent } from "../theme";
import { cn } from "@/lib/utils";

interface Props {
  summary: Summary;
  findings: Finding[];
  onReview: () => void;
  onExport: () => void;
}

/** The most urgent deadline, in plain words, or null when nothing is close. */
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

/** A figure in the stat line, in --dim like its label; money back is mint. Zero stats aren't shown at all. */
function Stat({ label, minor, currency, tone, href }: { label: string; minor: number; currency: string; tone?: "mint"; href?: string }) {
  const body = (
    <>
      {label} <span className={cn("figure font-medium", tone === "mint" ? "text-mint-ink" : "text-dim")}>{formatMoney(minor, currency)}</span>
    </>
  );
  return href ? (
    <a href={href} className="whitespace-nowrap text-dim underline decoration-transparent underline-offset-4 transition-colors hover:text-ink hover:decoration-line-strong">
      {body}
    </a>
  ) : (
    <span className="whitespace-nowrap text-dim">{body}</span>
  );
}

// The hero's deadline buckets, soonest first: each is a column of figures and a segment of the bar.
const BUCKETS = [
  { key: "week", label: "This week", holds: (d: number | null) => d !== null && d <= 7, fill: "bg-amber" },
  { key: "month", label: "Next 30 days", holds: (d: number | null) => d !== null && d > 7 && d <= 30, fill: "bg-mint-ink" },
  { key: "later", label: "Later", holds: (d: number | null) => d === null || d > 30, fill: "bg-mint" },
] as const;

function Hero({ summary, findings, live, ready, missed, onReview }: { summary: Summary; findings: Finding[]; live: Finding[]; ready: number; missed: number; onReview: () => void }) {
  const history = useRecoveryHistory(summary, findings);
  // Pointing at a bucket (its column or its bar segment) dims the other two.
  const [focus, setFocus] = useState<string | null>(null);
  const soon = urgency(live);
  const { currency } = summary;
  const buckets = BUCKETS.map((bucket) => {
    const rows = live.filter((f) => bucket.holds(f.days_left));
    return { ...bucket, count: rows.length, minor: rows.reduce((sum, f) => sum + f.amount_minor, 0) };
  });
  const dim = (key: string) => focus !== null && focus !== key && "opacity-30";
  // Only figures that are there: no "—" placeholders. Closed windows link to their tab.
  const stats = [
    { label: "In flight", minor: summary.in_flight_minor },
    { label: "Recovered", minor: summary.recovered_minor, tone: "mint" as const },
    { label: "Window closed", minor: missed, href: "#/claims?tab=closed" },
  ].filter((stat) => stat.minor > 0);
  return (
    <section aria-labelledby="hero-label" className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-x-12 gap-y-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] xl:items-end">
        <div className="flex min-w-0 flex-col">
          <h2 id="hero-label" className="m-0 text-13 font-medium text-dim">
            Open claims
          </h2>
          {ready > 0 ? (
            <p className="m-0 mt-1 text-44 font-semibold tracking-[-0.02em] md:text-56">
              <Money minor={ready} currency={currency} roll />
            </p>
          ) : (
            <p className="m-0 mt-1 text-28 font-semibold text-dim">—</p>
          )}
          <p className="m-0 mt-2 flex flex-wrap items-center gap-x-2 text-14">
            <span>{live.length > 0 ? plural(live.length, "claim") : "Nothing to claim right now"}</span>
            {soon && (
              <>
                <span aria-hidden className="text-dim">
                  ·
                </span>
                <span className="inline-flex items-center gap-1.5 font-medium text-amber-ink">
                  <span aria-hidden className="size-1.5 rounded-full bg-amber" />
                  {soon}
                </span>
              </>
            )}
          </p>
        </div>
        {live.length > 0 && (
          <dl data-buckets className="m-0 grid grid-cols-3" onPointerLeave={() => setFocus(null)}>
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
                    <span className="figure text-16 font-semibold tracking-[-0.01em] md:text-20">{formatMoney(bucket.minor, currency)}</span>
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
      {/* The same three buckets as one bar, each segment as wide as its money. The figures above carry the data. */}
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
        {live.length > 0 && (
          <Button variant="primary" size="lg" onClick={onReview} className="w-full sm:w-auto">
            Review claims
            <ArrowRight aria-hidden className="size-4" strokeWidth={2} />
          </Button>
        )}
        {stats.length > 0 && (
          <p data-totals className="m-0 flex flex-wrap gap-x-3 gap-y-1 text-13">
            {stats.map((stat, i) => (
              <span key={stat.label} className="flex gap-x-3">
                {i > 0 && (
                  <span aria-hidden className="text-dim">
                    ·
                  </span>
                )}
                <Stat {...stat} currency={currency} />
              </span>
            ))}
          </p>
        )}
      </div>
      {hasRecoveryChart(history) && <RecoveryChart history={history} currency={currency} />}
    </section>
  );
}

/** Under a respond-by date: days left, amber while it is three days or fewer. */
function Days({ days }: { days: number | null }) {
  const hint = daysHint(days);
  if (!hint) return null;
  return <span className={cn("block text-12", isUrgent(days) ? "font-medium text-amber-ink" : "text-dim")}>{hint}</span>;
}

function ExpiringSoon({ live }: { live: Finding[] }) {
  const rows = live.filter((f) => f.recover_by !== null).slice(0, 5);
  if (rows.length === 0) return null;
  return (
    <Section title="Expiring soon" meta={<SectionLink href="#/claims">View all</SectionLink>}>
      <table className="w-full table-fixed border-collapse text-14">
        <thead>
          <tr className="text-left text-12 text-dim">
            <th scope="col" className="min-w-[160px] py-2.5 pr-3 font-medium">
              Vendor
            </th>
            <th scope="col" className="hidden w-[30%] py-2.5 pr-3 font-medium xl:table-cell">
              Type
            </th>
            <th scope="col" className="w-24 py-2.5 pr-3 font-medium">
              Respond by
            </th>
            <th scope="col" className="w-28 py-2.5 text-right font-medium">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => (
            <tr
              key={f.id}
              data-needs-id={f.id}
              onClick={() => (window.location.hash = `#/claims/${f.id}`)}
              className="cursor-pointer border-t border-line transition-colors hover:bg-wash"
            >
              <td className="min-w-[160px] py-2.5 pr-3">
                <a href={`#/claims/${f.id}`} className="flex min-w-0 items-center gap-3 font-medium" onClick={(e) => e.stopPropagation()}>
                  <VendorLogo name={f.merchant} />
                  <span className="truncate">{vendorName(f.merchant)}</span>
                </a>
              </td>
              <td className="hidden truncate py-2.5 pr-3 text-dim xl:table-cell">{typeLabel(f.leak_type)}</td>
              <td className="py-2.5 pr-3">
                <span className="figure block text-13">{formatDate(f.recover_by as string, "short")}</span>
                <Days days={f.days_left} />
              </td>
              <td className="figure py-2.5 text-right font-medium">{formatMoney(f.amount_minor, f.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

// The stacked bar's segments, largest first: the green share ramp from the tokens.
const SHARE_TINTS = ["var(--share-1)", "var(--share-2)", "var(--share-3)", "var(--share-4)", "var(--share-5)"];

/**
 * Open money by type: one thin stacked bar under the header (each segment a type, in row order), then a
 * row per type with its swatch, "9 claims" and the amount.
 */
function ByType({ live, currency }: { live: Finding[]; currency: string }) {
  const sums = new Map<LeakType, { amount: number; count: number }>();
  for (const f of live) {
    const entry = sums.get(f.leak_type) ?? { amount: 0, count: 0 };
    sums.set(f.leak_type, { amount: entry.amount + f.amount_minor, count: entry.count + 1 });
  }
  const rows = [...sums.entries()].sort((a, b) => b[1].amount - a[1].amount);
  const total = rows.reduce((sum, [, r]) => sum + r.amount, 0);
  if (rows.length === 0 || total === 0) return null;
  const tint = (i: number) => SHARE_TINTS[Math.min(i, SHARE_TINTS.length - 1)];
  return (
    <Section title="By type">
      <div
        role="img"
        aria-label={`Share of open claims: ${rows.map(([type, r]) => `${typeGroup(type)} ${Math.round((r.amount / total) * 100)}%`).join(", ")}`}
        className="mt-3 flex h-1.5 gap-px overflow-hidden rounded-xs"
      >
        {rows.map(([type, { amount }], i) => (
          <span key={type} className="block h-full" style={{ width: `${(amount / total) * 100}%`, background: tint(i) }} />
        ))}
      </div>
      <ul className="m-0 flex flex-col p-0 pt-1">
        {rows.map(([type, { amount, count }], i) => (
          <li key={type} className="grid list-none grid-cols-[8px_minmax(0,1fr)_auto_96px] items-center gap-x-3 py-2.5 text-14 sm:grid-cols-[8px_minmax(0,1fr)_auto_104px]">
            <span aria-hidden className="size-2 rounded-xs" style={{ background: tint(i) }} />
            <span className="min-w-0 truncate">{typeGroup(type)}</span>
            <span className="figure text-right text-13 text-dim">{plural(count, "claim")}</span>
            <span className="figure text-right font-medium">{formatMoney(amount, currency)}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function TopVendors({ live, currency }: { live: Finding[]; currency: string }) {
  const byVendor = new Map<string, { merchant: string; amount: number; count: number }>();
  for (const f of live) {
    const name = vendorName(f.merchant);
    const entry = byVendor.get(name) ?? { merchant: f.merchant, amount: 0, count: 0 };
    byVendor.set(name, { ...entry, amount: entry.amount + f.amount_minor, count: entry.count + 1 });
  }
  const rows = [...byVendor.entries()].sort((a, b) => b[1].amount - a[1].amount).slice(0, 5);
  if (rows.length === 0) return null;
  return (
    <Section title="Top vendors">
      <ol className="m-0 flex flex-col p-0 pt-1">
        {rows.map(([name, { merchant, amount, count }]) => (
          <li key={name} className="flex list-none items-center gap-3 py-2 text-14">
            <VendorLogo name={merchant} />
            <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
            <span className="flex-none text-13 text-dim">{plural(count, "claim")}</span>
            <span className="figure w-24 flex-none text-right font-medium">{formatMoney(amount, currency)}</span>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function RecentlyRecovered({ findings }: { findings: Finding[] }) {
  // The list API has no recovery date, so the newest cases come first.
  const rows = findings
    .filter((f) => f.status === "recovered")
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
    .slice(0, 4);
  if (rows.length === 0) return null;
  return (
    <Section title="Recently recovered" meta={<SectionLink href="#/recovered">View all</SectionLink>}>
      <ul className="m-0 flex flex-col p-0 pt-1">
        {rows.map((f) => (
          <li key={f.id} className="list-none">
            <a href={`#/claims/${f.id}`} className="-mx-2 flex items-center gap-3 rounded-sm px-2 py-2 text-14 transition-colors hover:bg-wash">
              <VendorLogo name={f.merchant} />
              <span className="min-w-0 flex-1 truncate font-medium">{vendorName(f.merchant)}</span>
              <span className="figure font-medium text-mint-ink">+{formatMoney(f.recovered_minor ?? f.amount_minor, f.currency)}</span>
            </a>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Nothing found at all: one quiet row, the same pattern as the Recovered page's empty state. */
function NothingFound() {
  return (
    <div className="flex flex-col items-start gap-3 border-y border-line py-5 sm:flex-row sm:items-center sm:justify-between">
      <p className="m-0 text-14 text-dim">Nothing found yet. Run a scan from the Agent tab to look for money you are owed.</p>
      <div className="flex flex-none items-center gap-3 text-14">
        <SectionLink href="#/agent">Open Agent</SectionLink>
      </div>
    </div>
  );
}

/** The landing page: what is open, what expires first, where it comes from. Each figure appears once. */
export function Overview({ summary, findings, onReview, onExport }: Props) {
  // Open means a claim you can still make: inside its window. Closed windows count as missed,
  // matching the Claims list and its "Window closed" tab.
  const live = rowsFor(findings, "todo");
  const ready = live.reduce((sum, f) => sum + f.amount_minor, 0);
  // The server's total covers expired claims and never-sent ones whose window has closed.
  const missed = summary.expired_minor;
  if (findings.length === 0) {
    return (
      <div className="flex flex-col gap-12">
        <NothingFound />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-12">
      <TopBarActions>
        {/* Not on phones (a CSV there is rarely what you want); ⌘K still has "Export open claims". */}
        <Button size="sm" onClick={onExport} disabled={live.length === 0} title="Download the open claims as a CSV file" className="max-md:hidden">
          <Download aria-hidden className="size-3.5" strokeWidth={2} />
          Export
        </Button>
      </TopBarActions>
      <Hero summary={summary} findings={findings} live={live} ready={ready} missed={missed} onReview={onReview} />
      {/* Two columns only where both have room (1280px and up); below that they stack. */}
      <div className="grid grid-cols-1 items-start gap-x-12 gap-y-12 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ExpiringSoon live={live} />
        <div className="flex min-w-0 flex-col gap-10">
          <ByType live={live} currency={summary.currency} />
          <TopVendors live={live} currency={summary.currency} />
          <RecentlyRecovered findings={findings} />
        </div>
      </div>
    </div>
  );
}
