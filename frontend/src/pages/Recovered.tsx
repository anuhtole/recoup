import { FastForward } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, type Finding, type Summary, type TimelineEvent } from "../api";
import { Button } from "../components/Button";
import { Money } from "../components/Money";
import { Section } from "../components/Section";
import { VendorLogo } from "../components/VendorLogo";
import { formatDate, formatMoney, plural } from "../format";
import { vendorName } from "../lib/vendors";
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
  const vendor = vendorName(a.finding.merchant);
  if (a.kind === "recovered") return `${vendor} credit posted`;
  if (a.kind === "sent") return `Request sent to ${vendor}`;
  const verdict = /replied: (\w[\w ]*)/.exec(a.title)?.[1];
  if (verdict === "agreed") return `${vendor} agreed to refund`;
  if (verdict === "declined") return `${vendor} declined`;
  if (verdict) return `${vendor} ${verdict.replace(/_/g, " ")}`;
  return `${vendor} replied`;
}

function sub(a: Activity): string {
  if (a.kind === "sent") return a.title.replace(/^Sent to /, "To ");
  if (a.kind === "recovered") return "Confirmed in your ledger";
  return a.detail ?? a.title;
}

const KIND_LABEL: Record<Activity["kind"], string> = { recovered: "Recovered", reply: "Reply", sent: "In flight" };

/** A total in the stat row: muted "—" when it is zero, so nothing reads as an empty box. */
function Stat({ label, minor, currency, note, tone }: { label: string; minor: number; currency: string; note?: string; tone?: "mint" }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="m-0 text-13 text-dim">{label}</p>
      {minor > 0 ? (
        <p className={cn("m-0 text-28 font-semibold tracking-[-0.02em]", tone === "mint" && "text-mint-ink")}>
          <Money minor={minor} currency={currency} roll={tone === "mint"} />
        </p>
      ) : (
        <p className="m-0 flex h-8 items-center text-20 text-dim">
          <span aria-hidden>—</span>
          <span className="sr-only">None</span>
        </p>
      )}
      {note && <p className="m-0 text-13 text-dim">{note}</p>}
    </div>
  );
}

interface Props {
  summary: Summary;
  findings: Finding[];
  version: number;
  isAdvancing: boolean;
  onAdvance: () => void;
}

/** What came back and what is on its way, grouped by day; each row opens its case. */
export function Recovered({ summary, findings, version, isAdvancing, onAdvance }: Props) {
  const { items, error } = useActivity(findings, version);
  const { currency } = summary;
  const agreed = findings.filter((f) => f.status === "vendor_agreed").reduce((s, f) => s + f.amount_minor, 0);
  const recoveredCount = findings.filter((f) => f.status === "recovered").length;
  const hasTotals = summary.recovered_minor > 0 || agreed > 0 || summary.in_flight_minor > 0;
  const groups = useMemo(() => {
    const map = new Map<string, Activity[]>();
    for (const item of items ?? []) {
      const day = item.at.slice(0, 10);
      map.set(day, [...(map.get(day) ?? []), item]);
    }
    return [...map.entries()];
  }, [items]);

  return (
    <div className="flex flex-col gap-12">
      {hasTotals && (
        <section aria-label="Recovered totals" className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          <Stat label="Recovered" minor={summary.recovered_minor} currency={currency} tone="mint" note={recoveredCount > 0 ? plural(recoveredCount, "claim") : undefined} />
          <Stat label="Vendor agreed" minor={agreed} currency={currency} />
          <Stat label="In flight" minor={summary.in_flight_minor} currency={currency} />
        </section>
      )}

      <Section title="Activity">
        {error ? (
          <p className="m-0 py-10 text-center text-14 text-dim">Couldn't load the activity. Try again in a moment.</p>
        ) : items === null ? (
          <p className="m-0 py-10 text-center text-14 text-dim">Loading activity…</p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <p className="m-0 text-14 text-dim">Nothing sent yet.</p>
            {summary.demo_mode && (
              <Button size="sm" onClick={onAdvance} isBusy={isAdvancing} busyLabel="Advancing…">
                <FastForward aria-hidden className="size-3.5" strokeWidth={2} />
                Advance 2 weeks
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col">
            {groups.map(([day, rows]) => (
              <div key={day} className="flex flex-col">
                <h3 className="m-0 pb-1 pt-5 text-13 font-medium text-dim">{formatDate(day)}</h3>
                <ul className="m-0 flex flex-col p-0">
                  {rows.map((a) => {
                    const amount = a.kind === "recovered" ? (a.finding.recovered_minor ?? a.finding.amount_minor) : a.finding.amount_minor;
                    return (
                      <li key={a.key} className="list-none border-b border-line">
                        <a
                          href={`#/claims/${a.finding.id}`}
                          data-activity={a.kind}
                          className="-mx-2 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 rounded-sm px-2 py-3 transition-colors hover:bg-wash"
                        >
                          <VendorLogo name={a.finding.merchant} />
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate text-14 font-medium">{headline(a)}</span>
                            <span className="truncate text-13 text-dim">{sub(a)}</span>
                          </span>
                          <span className="flex flex-col items-end">
                            <span className={cn("figure text-14 font-medium", a.kind === "recovered" ? "text-mint-ink" : "text-ink")}>
                              {a.kind === "recovered" ? "+" : ""}
                              {formatMoney(amount, a.finding.currency)}
                            </span>
                            <span className="text-12 text-dim">{KIND_LABEL[a.kind]}</span>
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
      </Section>
    </div>
  );
}
