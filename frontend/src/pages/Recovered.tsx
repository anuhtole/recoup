import { FastForward } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, type Finding, type Summary, type TimelineEvent } from "../api";
import { Button } from "../components/Button";
import { Money } from "../components/Money";
import { Section, SectionLink } from "../components/Section";
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
  /** The request this event belongs to went to the card issuer, not the vendor. */
  viaIssuer: boolean;
}

const time = (iso: string) => new Date(iso).getTime();

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
          const sent = d.drafts.filter((x) => x.status === "sent" && x.sent_at).sort((a, b) => time(a.sent_at as string) - time(b.sent_at as string));
          // Which channel an event rode on: the last request sent at or before it.
          const channelAt = (at: string) => sent.filter((x) => time(x.sent_at as string) <= time(at)).at(-1)?.channel;
          d.timeline
            .filter((e): e is TimelineEvent & { kind: Activity["kind"] } => !e.is_future && (e.kind === "recovered" || e.kind === "reply" || e.kind === "sent"))
            .forEach((e, j) =>
              out.push({
                key: `${d.id}-${j}-${e.kind}`,
                at: e.at,
                finding: { ...active[i], status: d.status },
                kind: e.kind,
                title: e.title,
                detail: e.detail,
                viaIssuer: channelAt(e.at) === "card_dispute",
              }),
            );
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

/**
 * One line per event, in the words of who did it. A request that went to the card issuer reads as a
 * dispute ("Dispute filed with your card issuer", "Card issuer issued a provisional credit"), not as the vendor.
 */
function headline(a: Activity): string {
  const vendor = vendorName(a.finding.merchant);
  if (a.kind === "recovered") return `${vendor} credit posted`;
  if (a.kind === "sent") return a.viaIssuer ? "Dispute filed with your card issuer" : `Request sent to ${vendor}`;
  const who = a.viaIssuer ? "Card issuer" : vendor;
  if (/agreed/.test(a.title)) return a.viaIssuer ? "Card issuer issued a provisional credit" : `${vendor} agreed to refund`;
  if (/declined/.test(a.title)) return `${who} declined`;
  if (/more details|info/.test(a.title)) return `${who} asked for more details`;
  return `${who} replied`;
}

function sub(a: Activity): string {
  if (a.kind === "sent") return a.viaIssuer ? `${vendorName(a.finding.merchant)} · ${a.title.replace(/^Sent to /, "to ")}` : a.title.replace(/^Sent to /, "To ");
  if (a.kind === "recovered") return "Confirmed in your ledger";
  return a.detail ?? a.title;
}

const WAITING = new Set(["sent", "vendor_agreed", "info_requested"]);
/** The right-hand label follows where the claim is now: a sent request is "In flight" only while it is. */
function kindLabel(a: Activity): string {
  if (a.kind === "recovered") return "Recovered";
  if (a.kind === "reply") return "Reply";
  return WAITING.has(a.finding.status) ? "In flight" : "Sent";
}

/** A total in the page's header row. Zero totals aren't shown at all. */
function Stat({ label, minor, currency, note, tone }: { label: string; minor: number; currency: string; note?: string; tone?: "mint" }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="m-0 text-13 text-dim">{label}</p>
      <p className={cn("m-0 text-28 font-semibold tracking-[-0.02em]", tone === "mint" && "text-mint-ink")}>
        <Money minor={minor} currency={currency} roll={tone === "mint"} />
      </p>
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
  const totals = [
    { label: "Recovered", minor: summary.recovered_minor, tone: "mint" as const, note: recoveredCount > 0 ? plural(recoveredCount, "claim") : undefined },
    { label: "Vendor agreed", minor: agreed },
    { label: "In flight", minor: summary.in_flight_minor },
  ].filter((t) => t.minor > 0);
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
      {totals.length > 0 && (
        <section aria-label="Recovered totals" className="flex flex-wrap gap-x-12 gap-y-6">
          {totals.map((t) => (
            <Stat key={t.label} {...t} currency={currency} />
          ))}
        </section>
      )}

      {items !== null && items.length === 0 && !error ? (
        // Nothing yet: one quiet row where the feed will be, not a header over an empty hero.
        <div className="flex flex-col items-start gap-3 border-y border-line py-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0 text-14 text-dim">Requests you send and refunds that land show up here.</p>
          <div className="flex flex-none items-center gap-3 text-14">
            {summary.demo_mode && (
              <Button size="sm" variant="ghost" onClick={onAdvance} isBusy={isAdvancing} busyLabel="Advancing…">
                <FastForward aria-hidden className="size-3.5" strokeWidth={2} />
                Advance 2 weeks
              </Button>
            )}
            <SectionLink href="#/claims">Review claims</SectionLink>
          </div>
        </div>
      ) : (
      <Section title="Activity">
        {error ? (
          <p className="m-0 py-10 text-center text-14 text-dim">Couldn't load the activity. Try again in a moment.</p>
        ) : items === null ? (
          <p className="m-0 py-10 text-center text-14 text-dim">Loading activity…</p>
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
                            <span className="text-12 text-dim">{kindLabel(a)}</span>
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
      )}
    </div>
  );
}
