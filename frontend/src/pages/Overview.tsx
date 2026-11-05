import { ArrowRight } from "lucide-react";
import type { Finding, LeakType, Sources, Summary } from "../api";
import { Button } from "../components/Button";
import { RecoveryChart } from "../components/RecoveryChart";
import { configured, relativeTime, sourcesHealth, StatusDot } from "../components/Sources";
import { DaysTag, Empty, Label, Module, PageHeader, RollingMoney, VendorTile } from "../components/ui";
import { formatMoney, formatShortDate, plural } from "../format";
import { useSummaryHistory } from "../hooks/useSummaryHistory";
import { rowsFor } from "../queue";
import { LEAK_GROUP, LEAK_LABEL } from "../theme";
import { cn } from "@/lib/utils";

interface Props {
  summary: Summary;
  findings: Finding[];
  sources: Sources | null;
  isSyncing: boolean;
  onSync: () => void;
  onReview: () => void;
}

/** The second line of the hero: the most urgent thing, in plain words. */
function urgency(live: Finding[]): { text: string; urgent: boolean } {
  const days = live.map((f) => f.days_left).filter((d): d is number => d !== null && d >= 0);
  if (days.length === 0) return { text: live.length > 0 ? "No deadline coming up" : "Nothing is waiting on you", urgent: false };
  const today = days.filter((d) => d === 0).length;
  if (today) return { text: today === 1 ? "1 claim expires today" : `${today} claims expire today`, urgent: true };
  const tomorrow = days.filter((d) => d === 1).length;
  if (tomorrow) return { text: tomorrow === 1 ? "1 claim expires tomorrow" : `${tomorrow} claims expire tomorrow`, urgent: true };
  const week = days.filter((d) => d <= 7).length;
  if (week) return { text: week === 1 ? "1 claim expires this week" : `${week} claims expire this week`, urgent: true };
  return { text: `Next deadline in ${Math.min(...days)} days`, urgent: false };
}

function Hero({ summary, ready, live, onReview }: { summary: Summary; ready: number; live: Finding[]; onReview: () => void }) {
  const history = useSummaryHistory(summary);
  const soon = urgency(live);
  const { currency } = summary;
  const first = history[0];
  const delta = first ? summary.recovered_minor - first.recovered : 0;
  const since = first && history.length > 1 ? formatShortDate(first.as_of) : null;
  return (
    <section aria-label="Ready to claim" className="card relative overflow-hidden">
      <div aria-hidden className="ticks absolute inset-y-0 left-0 w-3" />
      <div className="flex flex-col gap-5 py-6 pl-10 pr-5 md:pl-12 md:pr-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex min-w-0 flex-col">
            <Label>Ready to claim</Label>
            <p className="m-0 mt-2 text-44 font-semibold tracking-[-0.035em] md:text-64">
              <RollingMoney minor={ready} currency={currency} />
            </p>
            <p className="m-0 mt-3 text-14">
              {delta > 0 ? (
                <>
                  <span className="figure font-medium text-mint-ink">+{formatMoney(delta, currency)}</span>{" "}
                  <span className="text-dim">recovered {since ? `since ${since}` : "so far"}</span>
                </>
              ) : summary.recovered_minor > 0 ? (
                <>
                  <span className="figure font-medium text-mint-ink">{formatMoney(summary.recovered_minor, currency)}</span>{" "}
                  <span className="text-dim">recovered so far</span>
                </>
              ) : (
                <span className="text-dim">Nothing back yet. Send a request and it lands here.</span>
              )}
            </p>
          </div>
          <div className="flex flex-col gap-2 lg:items-end">
            <p className={cn("label m-0", soon.urgent ? "text-amber-ink" : "text-dim")}>{soon.text}</p>
            {live.length > 0 && (
              <Button variant="primary" size="lg" onClick={onReview} className="w-full lg:w-auto">
                Review {plural(live.length, "claim")}
                <ArrowRight aria-hidden className="size-4" strokeWidth={2} />
              </Button>
            )}
          </div>
        </div>
        <RecoveryChart history={history} currency={currency} />
      </div>
    </section>
  );
}

/** The ink data band: the four totals and how much of everything found is back or on its way. */
function Band({ summary, ready, missed }: { summary: Summary; ready: number; missed: number }) {
  const { in_flight_minor: inFlight, recovered_minor: recovered, currency } = summary;
  const total = ready + inFlight + recovered + missed;
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0);
  const cells = [
    { label: "Ready", value: ready, className: "text-white" },
    { label: "In flight", value: inFlight, className: "text-white" },
    { label: "Recovered", value: recovered, className: "text-mint" },
    { label: "Missed", value: missed, className: "text-sub" },
  ];
  return (
    <section aria-label="Totals" className="on-ink overflow-hidden rounded-md bg-panel text-white">
      <dl className="m-0 grid grid-cols-2 lg:grid-cols-4">
        {cells.map((cell, i) => (
          <div
            key={cell.label}
            className={cn(
              "flex flex-col gap-2 px-5 py-5",
              i % 2 === 1 && "border-l border-rule",
              i >= 2 && "border-t border-rule lg:border-t-0",
              i === 2 && "lg:border-l",
            )}
          >
            <dt className="label text-sub">{cell.label}</dt>
            <dd className="m-0 text-20 font-semibold tracking-[-0.02em] md:text-28">
              <RollingMoney minor={cell.value} currency={currency} className={cell.className} />
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-col gap-2 border-t border-rule px-5 py-4">
        <div
          role="img"
          aria-label={`${formatMoney(recovered, currency)} recovered and ${formatMoney(inFlight, currency)} in flight out of ${formatMoney(total, currency)} found`}
          className="flex h-1.5 gap-0.5 overflow-hidden rounded-xs bg-rule"
        >
          <span className="h-full bg-mint transition-[width] duration-700" style={{ width: `${pct(recovered)}%` }} />
          <span className="h-full bg-mint/40 transition-[width] duration-700" style={{ width: `${pct(inFlight)}%` }} />
        </div>
        <p className="label m-0 flex flex-wrap justify-between gap-x-4 text-sub">
          <span>
            <span className="text-mint">{Math.round(pct(recovered))}% back</span> · {Math.round(pct(inFlight))}% in flight
          </span>
          <span className="figure">{formatMoney(total, currency)} found</span>
        </p>
      </div>
    </section>
  );
}

// Ink steps for the breakdown, darkest for the largest share. Mint stays reserved for money back.
const SHADES = ["var(--ink)", "#4a524d", "#7d8680", "#aab2ac", "#d3d8d4"];

function ByType({ todo, currency }: { todo: Finding[]; currency: string }) {
  const sums = new Map<LeakType, { amount: number; count: number }>();
  for (const f of todo) {
    const entry = sums.get(f.leak_type) ?? { amount: 0, count: 0 };
    sums.set(f.leak_type, { amount: entry.amount + f.amount_minor, count: entry.count + 1 });
  }
  const rows = [...sums.entries()].sort((a, b) => b[1].amount - a[1].amount);
  const total = rows.reduce((sum, [, r]) => sum + r.amount, 0);
  if (rows.length === 0 || total === 0) return <Empty>Nothing is ready to claim right now.</Empty>;
  const share = (amount: number) => (amount / total) * 100;
  return (
    <div className="flex flex-col gap-4">
      <div aria-hidden className="flex h-2 gap-0.5 overflow-hidden rounded-xs">
        {rows.map(([type, { amount }], i) => (
          <span key={type} className="h-full" style={{ width: `max(${share(amount)}%, 6px)`, background: SHADES[i] }} />
        ))}
      </div>
      <ul className="m-0 flex flex-col p-0">
        {rows.map(([type, { amount, count }], i) => (
          <li key={type} className="grid list-none grid-cols-[8px_minmax(0,1fr)_auto_44px] items-center gap-x-3 border-b border-line py-3 text-14 last:border-b-0">
            <span aria-hidden className="size-2 rounded-xs" style={{ background: SHADES[i] }} />
            <span className="min-w-0 truncate">
              {LEAK_GROUP[type]} <span className="ref text-13 text-dim">· {count}</span>
            </span>
            <span className="figure text-right font-medium">{formatMoney(amount, currency)}</span>
            <span className="ref text-right text-13 text-dim">{Math.round(share(amount))}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TopVendors({ todo, currency }: { todo: Finding[]; currency: string }) {
  const byVendor = new Map<string, { amount: number; count: number }>();
  for (const f of todo) {
    const entry = byVendor.get(f.merchant) ?? { amount: 0, count: 0 };
    byVendor.set(f.merchant, { amount: entry.amount + f.amount_minor, count: entry.count + 1 });
  }
  const rows = [...byVendor.entries()].sort((a, b) => b[1].amount - a[1].amount).slice(0, 5);
  if (rows.length === 0) return <Empty>Vendors that owe you money will be ranked here.</Empty>;
  const largest = rows[0][1].amount;
  return (
    <ol className="m-0 flex flex-col p-0">
      {rows.map(([vendor, { amount, count }]) => (
        <li key={vendor} className="flex list-none items-center gap-3 border-b border-line py-3 last:border-b-0">
          <VendorTile name={vendor} />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-start justify-between gap-4 text-14 sm:items-baseline">
              <span className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-1">
                <span className="truncate font-medium">{vendor}</span>
                <span className="ref flex-none text-11 font-normal text-dim sm:text-13">
                  <span className="hidden sm:inline">· </span>
                  {plural(count, "case")}
                </span>
              </span>
              <span className="figure font-medium">{formatMoney(amount, currency)}</span>
            </div>
            <span aria-hidden className="h-1 rounded-xs bg-ground">
              <span className="block h-full rounded-xs bg-ink" style={{ width: `${Math.max(2, (amount / largest) * 100)}%` }} />
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

function NeedsAction({ live }: { live: Finding[] }) {
  const rows = live.filter((f) => f.days_left !== null).slice(0, 5);
  if (rows.length === 0) return <Empty>Claims with a deadline will be listed here, the most urgent first.</Empty>;
  return (
    <ul className="-mx-5 m-0 flex flex-col p-0">
      {rows.map((f) => (
        <li key={f.id} className="list-none border-b border-line last:border-b-0">
          <a
            href={`#/claims/${f.id}`}
            data-needs-id={f.id}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-5 py-3 transition-colors hover:bg-wash"
          >
            <span className="min-w-0 truncate text-14 font-medium">{f.merchant}</span>
            <span className="figure text-right text-14 font-medium">{formatMoney(f.amount_minor, f.currency)}</span>
            <span className="min-w-0 truncate text-13 text-dim">{LEAK_LABEL[f.leak_type]}</span>
            <span className="text-right">
              <DaysTag days={f.days_left} />
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function RecentlyRecovered({ findings }: { findings: Finding[] }) {
  // The list API has no recovery date, so the newest cases come first.
  const rows = findings
    .filter((f) => f.status === "recovered")
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
    .slice(0, 4);
  if (rows.length === 0) return <Empty>Money confirmed back in your ledger will show here.</Empty>;
  return (
    <ul className="-mx-5 m-0 flex flex-col p-0">
      {rows.map((f) => (
        <li key={f.id} className="list-none border-b border-line last:border-b-0">
          <a href={`#/claims/${f.id}`} className="flex items-center justify-between gap-4 px-5 py-3 text-14 transition-colors hover:bg-wash">
            <span className="min-w-0 truncate font-medium">{f.merchant}</span>
            <span className="figure font-medium text-mint-ink">+{formatMoney(f.recovered_minor ?? f.amount_minor, f.currency)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function SourcesModule({ sources, isSyncing, onSync }: { sources: Sources | null; isSyncing: boolean; onSync: () => void }) {
  const on = sources ? configured(sources) : [];
  return (
    <Module title="Sources" aside={<a href="#/sources" className="inline-flex min-h-6 items-center font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-current">Manage</a>}>
      <ul className="m-0 flex flex-col gap-2 p-0">
        {(sources?.connectors ?? []).map((c) => (
          <li key={c.key} className="flex list-none items-center justify-between gap-3 text-14">
            <span className="flex min-w-0 items-center gap-2">
              <StatusDot health={!c.configured ? "none" : c.last_sync && !c.last_sync.ok ? "attention" : c.last_sync ? "ok" : "none"} className={c.configured && c.last_sync?.ok ? "bg-mint-ink" : undefined} />
              <span className="truncate">{c.key === "ramp" ? "Ramp" : c.key === "gmail" ? "Gmail" : "Status pages"}</span>
            </span>
            <span className="ref text-13 text-dim">{!c.configured ? "Not connected" : c.last_sync ? relativeTime(c.last_sync.finished_at) : "Connected, never synced"}</span>
          </li>
        ))}
        {!sources && <li className="list-none text-14 text-dim">Loading sources…</li>}
      </ul>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-4">
        <span className="flex items-center gap-2 text-13 text-dim">
          <StatusDot health={sourcesHealth(sources)} className={sourcesHealth(sources) === "ok" ? "bg-mint-ink" : undefined} />
          {sources ? `${on.length} of ${sources.connectors.length} connected` : "—"}
        </span>
        <Button size="sm" onClick={onSync} isBusy={isSyncing} busyLabel="Syncing…">
          Sync now
        </Button>
      </div>
    </Module>
  );
}

/** The landing page: what is owed, what expires first, where it comes from, and what has come back. */
export function Overview({ summary, findings, sources, isSyncing, onSync, onReview }: Props) {
  // Ready means a claim you can still make: open and inside its window. Closed windows count as missed,
  // matching the Claims list and its "Window closed" tab.
  const live = rowsFor(findings, "todo");
  const ready = live.reduce((sum, f) => sum + f.amount_minor, 0);
  const closedOpen = rowsFor(findings, "closed")
    .filter((f) => f.status !== "expired")
    .reduce((sum, f) => sum + f.amount_minor, 0);
  const missed = summary.expired_minor + closedOpen;
  return (
    <>
      <PageHeader crumbs={<span>Recoup / Overview</span>} title="Overview" />
      <Hero summary={summary} ready={ready} live={live} onReview={onReview} />
      <Band summary={summary} ready={ready} missed={missed} />
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Module title="Where it comes from" aside={<span className="figure">{formatMoney(ready, summary.currency)}</span>}>
            <ByType todo={live} currency={summary.currency} />
          </Module>
          <Module title="Top vendors" aside="Ready to claim" bodyClassName="py-1">
            <TopVendors todo={live} currency={summary.currency} />
          </Module>
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <Module title="Needs action" aside="Fewest days left" bodyClassName="py-0">
            <NeedsAction live={live} />
          </Module>
          <Module
            title="Recently recovered"
            aside={<a href="#/recovered" className="inline-flex min-h-6 items-center font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-current">All activity</a>}
            bodyClassName={findings.some((f) => f.status === "recovered") ? "py-0" : undefined}
          >
            <RecentlyRecovered findings={findings} />
          </Module>
          <SourcesModule sources={sources} isSyncing={isSyncing} onSync={onSync} />
        </div>
      </div>
    </>
  );
}
