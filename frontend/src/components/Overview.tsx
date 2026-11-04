import type { ReactNode } from "react";
import type { Finding, Summary } from "../api";
import { daysLeftLabel, formatMoney } from "../format";
import { orderStage } from "../queue";
import { LEAK_LABEL } from "../theme";
import { Button } from "./Button";
import { Deadline } from "./Chip";
import { ByType, HeadlineHero } from "./Metrics";

interface Props {
  summary: Summary;
  findings: Finding[];
  onOpenCase: (id: number) => void;
  onReview: () => void;
}

function Panel({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="glass-lg flex min-w-0 flex-col gap-4 rounded-panel p-4 sm:p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-16 font-semibold">{title}</h2>
        {aside && <span className="text-14 text-dim">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-row bg-tint px-4 py-3 text-14 text-dim">{children}</p>;
}

/** Ready to claim by vendor, largest first. */
function TopVendors({ findings, currency }: { findings: Finding[]; currency: string }) {
  const byVendor = new Map<string, { amount: number; count: number }>();
  for (const f of findings.filter((f) => f.stage === "todo")) {
    const entry = byVendor.get(f.merchant) ?? { amount: 0, count: 0 };
    byVendor.set(f.merchant, { amount: entry.amount + f.amount_minor, count: entry.count + 1 });
  }
  const rows = [...byVendor.entries()].sort((a, b) => b[1].amount - a[1].amount).slice(0, 5);
  if (rows.length === 0) return <Empty>Vendors that owe you money will be ranked here.</Empty>;
  const largest = rows[0][1].amount;
  return (
    <ol className="m-0 flex flex-col gap-1 p-0">
      {rows.map(([vendor, { amount, count }]) => (
        <li key={vendor} className="flex list-none flex-col gap-3 py-4">
          <div className="flex items-baseline justify-between gap-4 text-16">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="truncate">{vendor}</span>
              <span className="flex-none text-14 text-dim">{count === 1 ? "1 case" : `${count} cases`}</span>
            </span>
            <span className="figure font-medium">{formatMoney(amount, currency)}</span>
          </div>
          <span aria-hidden className="h-1 rounded-full bg-tint">
            <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(2, (amount / largest) * 100)}%` }} />
          </span>
        </li>
      ))}
    </ol>
  );
}

function Progress({ findings, currency, onOpenCase }: { findings: Finding[]; currency: string; onOpenCase: (id: number) => void }) {
  const waiting = findings.filter((f) => f.stage === "waiting");
  const waitingAmount = waiting.reduce((sum, f) => sum + f.amount_minor, 0);
  // The list API has no recovery date, so the newest cases come first.
  const recovered = findings
    .filter((f) => f.status === "recovered")
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
    .slice(0, 5);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h3 className="text-14 text-dim">Waiting on vendors</h3>
        {waiting.length === 0 ? (
          <Empty>Requests you send wait here until the vendor replies.</Empty>
        ) : (
          <p className="flex items-baseline justify-between gap-4 rounded-row bg-tint px-4 py-3 text-16">
            <span>{waiting.length === 1 ? "1 request" : `${waiting.length} requests`}</span>
            <span className="figure font-medium">{formatMoney(waitingAmount, currency)}</span>
          </p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-14 text-dim">Recently recovered</h3>
        {recovered.length === 0 ? (
          <Empty>Money confirmed back in your ledger will show here.</Empty>
        ) : (
          <ul className="-mx-4 m-0 flex flex-col gap-1 p-0">
            {recovered.map((f) => (
              <li key={f.id} className="list-none">
                <button
                  type="button"
                  onClick={() => onOpenCase(f.id)}
                  className="flex w-full items-baseline justify-between gap-4 rounded-row px-4 py-3 text-left text-16 transition-colors hover:bg-tint-hover"
                >
                  <span className="min-w-0 truncate">{f.merchant}</span>
                  <span className="figure font-medium text-money-ink">+{formatMoney(f.recovered_minor ?? f.amount_minor, f.currency)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** The landing page: what is owed, what expires first, where it comes from, and what has come back. */
export function Overview({ summary, findings, onOpenCase, onReview }: Props) {
  const { live } = orderStage(findings, "todo");
  const expiring = live.filter((f) => f.days_left !== null).slice(0, 5);
  return (
    <div className="flex flex-col gap-6">
      <HeadlineHero
        summary={summary}
        live={live}
        action={
          live.length > 0 && (
            <Button variant="primary" onClick={onReview}>
              Review {live.length} {live.length === 1 ? "claim" : "claims"}
            </Button>
          )
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Expiring soon" aside="Fewest days left">
          {expiring.length === 0 ? (
            <Empty>Claims with a deadline will be listed here, the most urgent first.</Empty>
          ) : (
            <ul className="-mx-4 m-0 flex flex-col gap-1 p-0">
              {expiring.map((f) => (
                <li key={f.id} className="list-none">
                  <button
                    type="button"
                    data-expiring-id={f.id}
                    onClick={() => onOpenCase(f.id)}
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 rounded-row px-4 py-3 text-left transition-[transform,background-color] duration-150 hover:bg-tint-hover active:scale-[0.99]"
                  >
                    <span className="min-w-0 truncate text-16 font-medium">{f.merchant}</span>
                    <span className="figure text-right text-16 font-medium">{formatMoney(f.amount_minor, f.currency)}</span>
                    <span className="min-w-0 truncate text-14 text-dim">{LEAK_LABEL[f.leak_type]}</span>
                    <span className="text-right">
                      <Deadline label={daysLeftLabel(f.days_left) ?? ""} daysLeft={f.days_left} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Top vendors">
          <TopVendors findings={findings} currency={summary.currency} />
        </Panel>

        <Panel title="Where it comes from" aside={formatMoney(summary.claimable_minor, summary.currency)}>
          <ByType findings={findings} total={summary.claimable_minor} currency={summary.currency} />
        </Panel>

        <Panel title="Progress">
          <Progress findings={findings} currency={summary.currency} onOpenCase={onOpenCase} />
        </Panel>
      </div>
    </div>
  );
}
