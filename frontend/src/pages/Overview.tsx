import { ArrowRight, Download } from "lucide-react";
import type { Finding, LeakType, Summary } from "../api";
import { Button } from "../components/Button";
import { Money } from "../components/Money";
import { hasRecoveryChart, RecoveryChart } from "../components/RecoveryChart";
import { Section, SectionLink } from "../components/Section";
import { TopBarActions } from "../components/shell/TopBarActions";
import { VendorLogo } from "../components/VendorLogo";
import { daysHint, formatDate, formatMoney, plural } from "../format";
import { useSummaryHistory } from "../hooks/useSummaryHistory";
import { vendorName } from "../lib/vendors";
import { rowsFor } from "../queue";
import { isUrgent, LEAK_GROUP, LEAK_LABEL } from "../theme";
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

/** A figure in the stat line: muted "—" for zero, so nothing reads as an empty box. */
function Stat({ label, minor, currency, tone }: { label: string; minor: number; currency: string; tone?: "mint" }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-dim">{label}</span>{" "}
      {minor > 0 ? (
        <span className={cn("figure font-medium", tone === "mint" ? "text-mint-ink" : "text-ink")}>{formatMoney(minor, currency)}</span>
      ) : (
        <>
          <span aria-hidden className="text-dim">
            —
          </span>
          <span className="sr-only">none</span>
        </>
      )}
    </span>
  );
}

function Hero({ summary, live, ready, missed, onReview }: { summary: Summary; live: Finding[]; ready: number; missed: number; onReview: () => void }) {
  const history = useSummaryHistory(summary);
  const soon = urgency(live);
  const { currency } = summary;
  return (
    <section aria-labelledby="hero-label" className="flex flex-col gap-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
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
                <span aria-hidden className="text-line-strong">
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
          <Button variant="primary" size="lg" onClick={onReview} className="w-full sm:w-auto">
            Review claims
            <ArrowRight aria-hidden className="size-4" strokeWidth={2} />
          </Button>
        )}
      </div>
      <p className="m-0 flex flex-wrap gap-x-3 gap-y-1 text-13">
        <Stat label="In flight" minor={summary.in_flight_minor} currency={currency} />
        <span aria-hidden className="text-line-strong">
          ·
        </span>
        <Stat label="Recovered" minor={summary.recovered_minor} currency={currency} tone="mint" />
        <span aria-hidden className="text-line-strong">
          ·
        </span>
        <Stat label="Missed" minor={missed} currency={currency} />
      </p>
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
            <th scope="col" className="py-2.5 pr-3 font-medium">
              Vendor
            </th>
            <th scope="col" className="hidden w-[30%] py-2.5 pr-3 font-medium sm:table-cell">
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
              <td className="py-2.5 pr-3">
                <a href={`#/claims/${f.id}`} className="flex min-w-0 items-center gap-3 font-medium" onClick={(e) => e.stopPropagation()}>
                  <VendorLogo name={f.merchant} />
                  <span className="truncate">{vendorName(f.merchant)}</span>
                </a>
              </td>
              <td className="hidden truncate py-2.5 pr-3 text-dim sm:table-cell">{LEAK_LABEL[f.leak_type]}</td>
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

function ByType({ live, currency }: { live: Finding[]; currency: string }) {
  const sums = new Map<LeakType, { amount: number; count: number }>();
  for (const f of live) {
    const entry = sums.get(f.leak_type) ?? { amount: 0, count: 0 };
    sums.set(f.leak_type, { amount: entry.amount + f.amount_minor, count: entry.count + 1 });
  }
  const rows = [...sums.entries()].sort((a, b) => b[1].amount - a[1].amount);
  const total = rows.reduce((sum, [, r]) => sum + r.amount, 0);
  if (rows.length === 0 || total === 0) return null;
  return (
    <Section title="By type">
      <ul className="m-0 flex flex-col p-0 pt-1">
        {rows.map(([type, { amount, count }]) => {
          const share = (amount / total) * 100;
          return (
            <li key={type} className="grid list-none grid-cols-[minmax(0,1fr)_56px_20px_96px] items-center gap-x-3 py-2.5 text-14 sm:grid-cols-[minmax(0,1fr)_80px_24px_104px]">
              <span className="min-w-0 truncate">{LEAK_GROUP[type]}</span>
              <span role="img" aria-label={`${Math.round(share)}% of open claims`} className="h-1 overflow-hidden rounded-xs bg-ground">
                <span className="block h-full rounded-xs bg-ink" style={{ width: `${Math.max(3, share)}%` }} />
              </span>
              <span className="figure text-right text-13 text-dim">
                {count}
                <span className="sr-only"> {count === 1 ? "claim" : "claims"}</span>
              </span>
              <span className="figure text-right font-medium">{formatMoney(amount, currency)}</span>
            </li>
          );
        })}
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
            {count > 1 && <span className="flex-none text-13 text-dim">{plural(count, "claim")}</span>}
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
    <Section title="Recently recovered" meta={<SectionLink href="#/recovered">All activity</SectionLink>}>
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

/** The landing page: what is open, what expires first, where it comes from. Each figure appears once. */
export function Overview({ summary, findings, onReview, onExport }: Props) {
  // Open means a claim you can still make: inside its window. Closed windows count as missed,
  // matching the Claims list and its "Window closed" tab.
  const live = rowsFor(findings, "todo");
  const ready = live.reduce((sum, f) => sum + f.amount_minor, 0);
  const closedOpen = rowsFor(findings, "closed")
    .filter((f) => f.status !== "expired")
    .reduce((sum, f) => sum + f.amount_minor, 0);
  const missed = summary.expired_minor + closedOpen;
  return (
    <div className="flex flex-col gap-12">
      <TopBarActions>
        <Button size="sm" onClick={onExport} disabled={live.length === 0} title="Download the open claims as a CSV file">
          <Download aria-hidden className="size-3.5" strokeWidth={2} />
          Export
        </Button>
      </TopBarActions>
      <Hero summary={summary} live={live} ready={ready} missed={missed} onReview={onReview} />
      <div className="grid grid-cols-1 items-start gap-x-12 gap-y-12 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
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
