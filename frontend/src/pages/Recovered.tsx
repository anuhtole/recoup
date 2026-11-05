import { useEffect, useMemo, useState } from "react";
import { api, type Finding, type Summary, type TimelineEvent } from "../api";
import { PageHeader, RollingMoney, VendorTile } from "../components/ui";
import { formatDate, formatMoney } from "../format";
import { cn } from "@/lib/utils";

// Statuses that have a story after the request left: the activity feed is built from their timelines.
const ACTIVE = new Set(["sent", "vendor_agreed", "info_requested", "vendor_declined", "recovered"]);

interface Activity {
  key: string;
  at: string;
  finding: Finding;
  kind: "recovered" | "reply" | "sent";
  title: string;
  detail: string | null;
}

/** Each case's sent, reply and recovered events, fetched from the cases that have them. Existing data only. */
function useActivity(findings: Finding[], version: number) {
  const active = useMemo(() => findings.filter((f) => ACTIVE.has(f.status)), [findings]);
  const key = active.map((f) => `${f.id}:${f.status}`).join(",");
  const [items, setItems] = useState<Activity[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let isCurrent = true;
    setError(false);
    Promise.all(active.map((f) => api.finding(f.id)))
      .then((details) => {
        if (!isCurrent) return;
        const out: Activity[] = [];
        details.forEach((d, i) => {
          d.timeline
            .filter((e): e is TimelineEvent & { kind: Activity["kind"] } => !e.is_future && (e.kind === "recovered" || e.kind === "reply" || e.kind === "sent"))
            .forEach((e, j) => out.push({ key: `${d.id}-${j}-${e.kind}`, at: e.at, finding: active[i], kind: e.kind, title: e.title, detail: e.detail }));
        });
        out.sort((a, b) => b.at.localeCompare(a.at) || (a.kind === "recovered" ? -1 : 1));
        setItems(out);
      })
      .catch(() => isCurrent && setError(true));
    return () => {
      isCurrent = false;
    };
    // `key` captures which cases and statuses are in play; `version` refetches after any action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);
  return { items, error };
}

function headline(a: Activity): string {
  if (a.kind === "recovered") return `${a.finding.merchant} credit posted`;
  if (a.kind === "sent") return `Request sent to ${a.finding.merchant}`;
  const verdict = /replied: (\w[\w ]*)/.exec(a.title)?.[1];
  if (verdict === "agreed") return `${a.finding.merchant} agreed to refund`;
  if (verdict === "declined") return `${a.finding.merchant} declined`;
  if (verdict) return `${a.finding.merchant} ${verdict.replace(/_/g, " ")}`;
  return `${a.finding.merchant} replied`;
}

function sub(a: Activity): string {
  if (a.kind === "sent") return a.title.replace(/^Sent to /, "To ");
  if (a.kind === "recovered") return "Confirmed in your ledger";
  return a.detail ?? a.title;
}

const DOT: Record<Activity["kind"], string> = {
  recovered: "bg-mint-ink",
  reply: "bg-ink",
  sent: "border border-dim bg-paper",
};

/** Link-style activity: what came back and what is on its way, grouped by day, each row opening its case. */
export function Recovered({ summary, findings, version }: { summary: Summary; findings: Finding[]; version: number }) {
  const { items, error } = useActivity(findings, version);
  const { currency } = summary;
  const agreed = findings.filter((f) => f.status === "vendor_agreed").reduce((s, f) => s + f.amount_minor, 0);
  const recoveredCount = findings.filter((f) => f.status === "recovered").length;
  const groups = useMemo(() => {
    const map = new Map<string, Activity[]>();
    for (const item of items ?? []) {
      const day = item.at.slice(0, 10);
      map.set(day, [...(map.get(day) ?? []), item]);
    }
    return [...map.entries()];
  }, [items]);

  return (
    <>
      <PageHeader crumbs={<span>Recoup / Recovered</span>} title="Recovered" />
      <section aria-label="Recovered totals" className="on-ink grid grid-cols-1 overflow-hidden rounded-md bg-panel text-white sm:grid-cols-3">
        <div className="flex flex-col gap-2 px-5 py-5">
          <p className="label m-0 text-sub">Recovered · {recoveredCount}</p>
          <p className="m-0 text-28 font-semibold tracking-[-0.03em]">
            <RollingMoney minor={summary.recovered_minor} currency={currency} className="text-mint" />
          </p>
        </div>
        <div className="flex flex-col gap-2 border-t border-rule px-5 py-5 sm:border-l sm:border-t-0">
          <p className="label m-0 text-sub">Vendor agreed</p>
          <p className="figure m-0 text-28 font-semibold tracking-[-0.03em]">{formatMoney(agreed, currency)}</p>
        </div>
        <div className="flex flex-col gap-2 border-t border-rule px-5 py-5 sm:border-l sm:border-t-0">
          <p className="label m-0 text-sub">In flight</p>
          <p className="figure m-0 text-28 font-semibold tracking-[-0.03em]">{formatMoney(summary.in_flight_minor, currency)}</p>
        </div>
      </section>

      <section aria-label="Activity" className="card overflow-hidden">
        <header className="flex min-h-12 items-center justify-between gap-4 border-b border-line px-5">
          <h2 className="m-0 text-14 font-semibold tracking-[-0.01em]">Activity</h2>
          <span className="label text-dim">Newest first</span>
        </header>
        {error ? (
          <p className="m-0 px-5 py-10 text-center text-14 text-dim">Couldn't load the activity. Try again in a moment.</p>
        ) : items === null ? (
          <p className="m-0 px-5 py-10 text-center text-14 text-dim">Loading activity…</p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <p className="m-0 max-w-[46ch] text-14 text-dim text-balance">
              Nothing sent yet. Requests you send, vendor replies and credits that post show up here, newest first.
            </p>
            <a
              href="#/claims"
              className="inline-flex h-8 items-center rounded-sm border border-line bg-paper px-3 text-13 font-medium transition-colors hover:border-line-strong hover:bg-wash"
            >
              Review claims
            </a>
          </div>
        ) : (
          <div className="flex flex-col">
            {groups.map(([day, rows]) => (
              <div key={day} className="flex flex-col">
                <h3 className="label m-0 border-b border-line bg-wash px-5 py-2 text-dim">{formatDate(day)}</h3>
                <ul className="m-0 flex flex-col p-0">
                  {rows.map((a) => {
                    const amount = a.kind === "recovered" ? (a.finding.recovered_minor ?? a.finding.amount_minor) : a.finding.amount_minor;
                    return (
                      <li key={a.key} className="list-none border-b border-line last:border-b-0">
                        <a
                          href={`#/claims/${a.finding.id}`}
                          data-activity={a.kind}
                          className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-5 py-3 transition-colors hover:bg-wash"
                        >
                          <VendorTile name={a.finding.merchant} />
                          <span className="flex min-w-0 flex-col">
                            <span className="flex min-w-0 items-center gap-2">
                              <span aria-hidden className={cn("size-1.5 flex-none rounded-full", DOT[a.kind])} />
                              <span className="truncate text-14 font-medium">{headline(a)}</span>
                            </span>
                            <span className="truncate pl-3.5 text-13 text-dim">{sub(a)}</span>
                          </span>
                          <span className="flex flex-col items-end">
                            <span className={cn("figure text-14 font-medium", a.kind === "recovered" ? "text-mint-ink" : "text-ink")}>
                              {a.kind === "recovered" ? "+" : ""}
                              {formatMoney(amount, a.finding.currency)}
                            </span>
                            <span className="label text-dim">{a.kind === "recovered" ? "Recovered" : a.kind === "sent" ? "In flight" : "Reply"}</span>
                          </span>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
