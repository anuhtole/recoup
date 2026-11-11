import { ArrowDown, ArrowUp, Download, FastForward, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { api, type Finding, type Summary } from "../api";
import { Button } from "../components/Button";
import { Money } from "../components/Money";
import { type Pick, RecoverySankey } from "../components/RecoverySankey";
import { Section, SectionLink } from "../components/Section";
import { Segmented, Tag } from "../components/ui";
import { VendorLogo } from "../components/VendorLogo";
import { formatDate, formatMoney, plural } from "../format";
import { typeLabel } from "../lib/claimTypes";
import { vendorName } from "../lib/vendors";
import { statusOf } from "../theme";
import { cn } from "@/lib/utils";

const DAY = 86_400_000;
// A request is in flight from the moment it is sent until its credit posts (or the vendor declines).
const IN_FLIGHT = new Set(["sent", "vendor_agreed", "info_requested"]);

const time = (iso: string) => new Date(iso).getTime();
const recoveredMinor = (f: Finding) => f.recovered_minor ?? f.amount_minor;
const sum = (rows: Finding[], of: (f: Finding) => number) => rows.reduce((t, f) => t + of(f), 0);

/** Days from the claim being flagged to its credit posting, or null when the dates can't say. */
function daysToRecover(f: Finding): number | null {
  if (!f.recovered_at) return null;
  const days = Math.round((time(f.recovered_at) - time(f.created_at)) / DAY);
  return days >= 0 ? days : null;
}

/** What a request's own case adds to its row: when it went out, to whom, and the last thing said back. */
interface Request {
  sentAt: string | null;
  /** The request went to the card issuer, not the vendor. */
  viaIssuer: boolean;
  reply: { at: string; text: string } | null;
}

/** Each in-flight claim's request, read from its case. Existing data only; nothing here changes anything. */
function useRequests(rows: Finding[], version: number): Map<number, Request> {
  const key = rows.map((f) => `${f.id}:${f.status}`).join(",");
  const [requests, setRequests] = useState<Map<number, Request>>(new Map());
  useEffect(() => {
    let isCurrent = true;
    Promise.all(rows.map((f) => api.finding(f.id)))
      .then((details) => {
        if (!isCurrent) return;
        const out = new Map<number, Request>();
        for (const d of details) {
          const sent = d.drafts.filter((x) => x.status === "sent" && x.sent_at).sort((a, b) => time(a.sent_at as string) - time(b.sent_at as string));
          const past = d.timeline.filter((e) => !e.is_future);
          const reply = past.filter((e) => e.kind === "reply").at(-1);
          out.set(d.id, {
            sentAt: sent[0]?.sent_at ?? past.find((e) => e.kind === "sent")?.at ?? null,
            viaIssuer: sent.at(-1)?.channel === "card_dispute",
            // The first line that isn't a greeting: what the vendor actually said.
            reply: reply ? { at: reply.at, text: (reply.detail ?? reply.title).split("\n").find((line) => line.trim() && !/^(hi|hello|dear)\b/i.test(line.trim())) ?? reply.title } : null,
          });
        }
        setRequests(out);
      })
      // The rows still show from the list; they just go without dates and replies.
      .catch(() => undefined);
    return () => {
      isCurrent = false;
    };
    // `key` captures which claims and statuses are in play; `version` refetches after any action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);
  return requests;
}

/** One figure in the header strip: a label, the number, and a line that says what it counts. */
function Stat({ label, children, note }: { label: string; children: ReactNode; note: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="m-0 text-13 text-dim">{label}</p>
      {/* A fixed height, so a plain number and a figure with small cents sit on the same line. */}
      <p className="figure m-0 flex h-8 items-center text-20 font-semibold tracking-[-0.01em] md:h-10 md:text-28 md:tracking-[-0.02em]">
        <span className="truncate">{children}</span>
      </p>
      <p className="m-0 truncate text-13 text-dim">{note}</p>
    </div>
  );
}

interface Sort<K extends string> {
  key: K;
  isDown: boolean;
}

function SortHead<K extends string>({ label, column, sort, onSort, className, isRight }: { label: string; column: K; sort: Sort<K>; onSort: (key: K) => void; className?: string; isRight?: boolean }) {
  const isActive = sort.key === column;
  const Arrow = sort.isDown ? ArrowDown : ArrowUp;
  return (
    <th scope="col" aria-sort={isActive ? (sort.isDown ? "descending" : "ascending") : "none"} className={cn("p-0 font-medium", className)}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn("flex h-9 w-full items-center gap-1 text-12 transition-colors hover:text-ink", isRight && "justify-end", isActive ? "text-ink" : "text-dim")}
      >
        {label}
        <Arrow aria-hidden className={cn("size-3 flex-none", !isActive && "invisible")} strokeWidth={2} />
      </button>
    </th>
  );
}

/** Sorted rows and the header's handler. Text sorts A to Z first; everything else largest first. */
function useSorted<K extends string>(rows: Finding[], first: K, textKey: K, value: (f: Finding, key: K) => number | string) {
  const [sort, setSort] = useState<Sort<K>>({ key: first, isDown: true });
  const onSort = (key: K) => setSort((now) => (now.key === key ? { key, isDown: !now.isDown } : { key, isDown: key !== textKey }));
  const sorted = useMemo(() => {
    const list = [...rows].sort((a, b) => {
      const x = value(a, sort.key);
      const y = value(b, sort.key);
      return x < y ? -1 : x > y ? 1 : a.id - b.id;
    });
    return sort.isDown ? list.reverse() : list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);
  return { sort, onSort, sorted };
}

const openClaim = (id: number) => {
  window.location.hash = `#/claims/${id}`;
};

/** The first cell of both tables: logo, name, and a line under it for what narrower tables drop. */
function VendorCell({ finding, children }: { finding: Finding; children: ReactNode }) {
  return (
    <td className="py-3 pr-3">
      <a href={`#/claims/${finding.id}`} onClick={(event) => event.stopPropagation()} className="flex min-w-0 items-center gap-3 rounded-sm">
        <VendorLogo name={finding.merchant} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{vendorName(finding.merchant)}</span>
          {children}
        </span>
      </a>
    </td>
  );
}

type RecoveredSort = "vendor" | "date" | "days" | "amount";

/**
 * Every recovered claim, sortable; a row opens its claim. Columns come and go with the table's own width,
 * not the window's.
 */
function RecoveredTable({ rows, currency }: { rows: Finding[]; currency: string }) {
  const { sort, onSort, sorted } = useSorted<RecoveredSort>(rows, "date", "vendor", (f, key) =>
    key === "vendor" ? vendorName(f.merchant).toLowerCase() : key === "amount" ? recoveredMinor(f) : key === "days" ? (daysToRecover(f) ?? -1) : (f.recovered_at ?? ""),
  );
  return (
    <div className="@container">
      <table className="w-full table-fixed border-collapse text-left text-14">
        <thead>
          <tr>
            <SortHead label="Vendor" column="vendor" sort={sort} onSort={onSort} />
            <th scope="col" className="hidden w-52 px-3 text-12 font-medium text-dim @2xl:table-cell">
              Type
            </th>
            <SortHead label="Recovered" column="date" sort={sort} onSort={onSort} className="hidden w-28 px-3 @md:table-cell" />
            <SortHead label="Time taken" column="days" sort={sort} onSort={onSort} className="hidden w-28 px-3 @lg:table-cell" />
            <SortHead label="Amount" column="amount" sort={sort} onSort={onSort} className="w-28" isRight />
          </tr>
        </thead>
        <tbody>
          {sorted.map((f) => {
            const days = daysToRecover(f);
            return (
              <tr key={f.id} data-recovered-id={f.id} onClick={() => openClaim(f.id)} className="cursor-pointer border-t border-line transition-colors hover:bg-wash">
                <VendorCell finding={f}>
                  <span className="truncate text-12 text-dim @2xl:hidden">
                    {typeLabel(f.leak_type)}
                    {f.recovered_at && <span className="@md:hidden"> · {formatDate(f.recovered_at, "short")}</span>}
                  </span>
                </VendorCell>
                <td className="hidden truncate px-3 text-dim @2xl:table-cell">{typeLabel(f.leak_type)}</td>
                <td className="figure hidden px-3 @md:table-cell">{f.recovered_at ? formatDate(f.recovered_at, "short") : "—"}</td>
                <td className="figure hidden px-3 text-dim @lg:table-cell">{days === null ? "—" : plural(days, "day")}</td>
                <td className="figure text-right font-medium text-mint-ink">+{formatMoney(recoveredMinor(f), f.currency)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-line-strong">
            <td className="py-3 pr-3 text-13 text-dim">{plural(rows.length, "claim")}</td>
            <td className="hidden @2xl:table-cell" />
            <td className="hidden @md:table-cell" />
            <td className="hidden @lg:table-cell" />
            <td className="figure text-right font-semibold">{formatMoney(sum(rows, recoveredMinor), currency)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// Where a request stands, in the order it moves. "Needs your reply" is the one stage that waits on you.
type StageKey = "waiting" | "needs" | "agreed";
const STAGES: { key: StageKey; label: string; dot: string }[] = [
  { key: "waiting", label: "Awaiting reply", dot: "bg-line-strong" },
  { key: "needs", label: "Needs your reply", dot: "bg-amber" },
  { key: "agreed", label: "Agreed, awaiting credit", dot: "bg-mint-ink" },
];
const stageOf = (f: Finding): StageKey => (f.status === "vendor_agreed" ? "agreed" : f.status === "info_requested" ? "needs" : "waiting");

/**
 * The money in flight as one bar, split by where each request stands, with the three stages under it as
 * buttons that filter the list.
 */
function StageBar({ rows, currency, stage, onStage }: { rows: Finding[]; currency: string; stage: StageKey | null; onStage: (stage: StageKey | null) => void }) {
  const parts = STAGES.map((s) => {
    const own = rows.filter((f) => stageOf(f) === s.key);
    return { ...s, count: own.length, minor: sum(own, (f) => f.amount_minor) };
  });
  return (
    <div className="flex flex-col gap-3 pt-5">
      <div aria-hidden className="flex h-3 gap-0.5 overflow-hidden rounded-xs">
        {parts
          .filter((p) => p.minor > 0)
          .map((p) => (
            <span key={p.key} className={cn("min-w-1 basis-0 transition-opacity duration-150 ease-out", p.dot, stage && stage !== p.key && "opacity-30")} style={{ flexGrow: p.minor }} />
          ))}
      </div>
      <div role="group" aria-label="Show one stage" className="grid gap-2 sm:grid-cols-3">
        {parts.map((p) => (
          <button
            key={p.key}
            type="button"
            aria-pressed={stage === p.key}
            disabled={p.count === 0}
            onClick={() => onStage(stage === p.key ? null : p.key)}
            className="flex min-h-11 items-start gap-2 rounded-sm border border-transparent px-2 py-2 text-left transition-colors hover:bg-wash disabled:opacity-50 disabled:hover:bg-transparent aria-pressed:border-line aria-pressed:bg-wash"
          >
            <span aria-hidden className={cn("mt-1.5 size-2 flex-none rounded-full", p.dot)} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-13 text-dim">{p.label}</span>
              <span className="figure text-16 font-semibold">{formatMoney(p.minor, currency)}</span>
              <span className="text-12 text-dim">{plural(p.count, "request")}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

const STEPS = ["Sent", "Vendor replied", "Vendor agreed", "Credit posted"];

/** A request's four steps as dots on a line: filled as far as it has got, amber where it waits on you. */
function Track({ finding }: { finding: Finding }) {
  const reached = finding.status === "vendor_agreed" ? 3 : finding.status === "info_requested" ? 2 : 1;
  const isOnYou = finding.status === "info_requested";
  return (
    <span role="img" aria-label={`Step ${reached} of ${STEPS.length}: ${STEPS[reached - 1]}`} className="flex items-center">
      {STEPS.map((step, i) => (
        <span key={step} className="flex flex-1 items-center last:flex-none">
          <span className={cn("size-2 flex-none rounded-full", i >= reached ? "bg-line-strong" : isOnYou && i === reached - 1 ? "bg-amber" : "bg-mint-ink")} />
          {i < STEPS.length - 1 && <span className={cn("h-0.5 flex-1", i < reached - 1 ? "bg-mint-ink" : "bg-line")} />}
        </span>
      ))}
    </span>
  );
}

/**
 * The next step in a few words; the server's full sentence ("No reply in 18 days; follow up") is the
 * cell's tooltip. A step that is yours to take is amber.
 */
function nextStep(f: Finding): { label: string; isOnYou: boolean } {
  if (f.status === "info_requested") return { label: "Reply to vendor", isOnYou: true };
  if (f.next_action.kind === "escalate") return { label: "Escalate", isOnYou: true };
  if (f.next_action.kind === "follow_up") return { label: "Follow up", isOnYou: true };
  return { label: f.status === "vendor_agreed" ? "Wait for the credit" : "Wait for a reply", isOnYou: false };
}

type FlightSort = "vendor" | "waiting" | "amount";

/** Every request that is out: how far it has got, how long it has waited, what the vendor last said, what is next. */
function InFlightTable({ rows, requests, asOf, currency }: { rows: Finding[]; requests: Map<number, Request>; asOf: string; currency: string }) {
  const now = time(`${asOf}T12:00:00Z`);
  const waited = (f: Finding): number | null => {
    const sentAt = requests.get(f.id)?.sentAt;
    return sentAt ? Math.max(0, Math.floor((now - time(sentAt)) / DAY)) : null;
  };
  const { sort, onSort, sorted } = useSorted<FlightSort>(rows, "waiting", "vendor", (f, key) =>
    key === "vendor" ? vendorName(f.merchant).toLowerCase() : key === "amount" ? f.amount_minor : (waited(f) ?? -1),
  );
  return (
    <div className="@container">
      <table className="w-full table-fixed border-collapse text-left text-14">
        <thead>
          <tr>
            <SortHead label="Vendor" column="vendor" sort={sort} onSort={onSort} />
            <th scope="col" className="hidden w-56 px-3 text-12 font-medium text-dim @lg:table-cell">
              Progress
            </th>
            <th scope="col" className="hidden px-3 text-12 font-medium text-dim @4xl:table-cell">
              Last reply
            </th>
            <SortHead label="Waiting" column="waiting" sort={sort} onSort={onSort} className="hidden w-28 px-3 @md:table-cell" />
            <th scope="col" className="hidden w-40 px-3 text-12 font-medium text-dim @3xl:table-cell">
              Next step
            </th>
            <SortHead label="Amount" column="amount" sort={sort} onSort={onSort} className="w-28" isRight />
          </tr>
        </thead>
        <tbody>
          {sorted.map((f) => {
            const request = requests.get(f.id);
            const days = waited(f);
            const status = statusOf(f).label;
            const next = nextStep(f);
            return (
              <tr key={f.id} data-inflight-id={f.id} onClick={() => openClaim(f.id)} className="cursor-pointer border-t border-line transition-colors hover:bg-wash">
                <VendorCell finding={f}>
                  <span className="truncate text-12 text-dim">
                    <span className="@lg:hidden">{status} · </span>
                    {days !== null && <span className="@md:hidden">{plural(days, "day")} · </span>}
                    {request?.viaIssuer ? "Card dispute" : typeLabel(f.leak_type)}
                  </span>
                </VendorCell>
                <td className="hidden px-3 @lg:table-cell">
                  <span className="flex flex-col gap-1.5">
                    <Track finding={f} />
                    <span className="truncate text-12 text-dim">
                      {status}
                      {request?.reply ? ` · ${formatDate(request.reply.at, "short")}` : request?.sentAt ? ` · ${formatDate(request.sentAt, "short")}` : ""}
                    </span>
                  </span>
                </td>
                <td className="hidden truncate px-3 text-13 text-dim @4xl:table-cell" title={request?.reply?.text}>
                  {request?.reply ? request.reply.text : "No reply yet"}
                </td>
                <td className="hidden px-3 @md:table-cell">
                  <span className="flex flex-col">
                    <span className="figure">{days === null ? "—" : plural(days, "day")}</span>
                    {request?.sentAt && <span className="figure truncate text-12 text-dim">since {formatDate(request.sentAt, "short")}</span>}
                  </span>
                </td>
                <td className="hidden truncate px-3 @3xl:table-cell" title={f.next_action.label}>
                  {next.isOnYou ? <Tag tone="amber">{next.label}</Tag> : <span className="text-13 text-dim">{next.label}</span>}
                </td>
                <td className="figure text-right font-medium">{formatMoney(f.amount_minor, f.currency)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-line-strong">
            <td className="py-3 pr-3 text-13 text-dim">{plural(rows.length, "request")}</td>
            <td className="hidden @lg:table-cell" />
            <td className="hidden @4xl:table-cell" />
            <td className="hidden @md:table-cell" />
            <td className="hidden @3xl:table-cell" />
            <td className="figure text-right font-semibold">{formatMoney(sum(rows, (f) => f.amount_minor), currency)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** The chip in a list's header that names the filter in force and clears it. */
function FilterChip({ kind, label, onClear }: { kind: string; label: string; onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="flex h-7 items-center gap-1.5 rounded-sm border border-line bg-paper pl-2.5 pr-1.5 text-13 text-ink transition-colors hover:border-line-strong hover:bg-wash"
    >
      <span className="text-dim">{kind}:</span>
      {label}
      <X aria-hidden className="size-3.5 text-dim" strokeWidth={2} />
      <span className="sr-only">Clear filter</span>
    </button>
  );
}

export type RecoveredView = "recovered" | "inflight";

/** #/recovered is the Recovered view; #/recovered?view=inflight opens on In flight. */
export const recoveredView = (params: Record<string, string>): RecoveredView => (params.view === "inflight" ? "inflight" : "recovered");

interface Props {
  summary: Summary;
  findings: Finding[];
  /** Which of the two views shows; it lives in the hash, so a link can land on either. */
  view: RecoveredView;
  onView: (view: RecoveredView) => void;
  version: number;
  isAdvancing: boolean;
  onAdvance: () => void;
  onExport: (rows: Finding[], noun: string) => void;
}

/**
 * Money that has left the to-do list, in two views. Recovered: what came back, where it came from and
 * every claim behind it. In flight: every request that is out, how far each has got and what is next.
 */
export function Recovered({ summary, findings, view, onView, version, isAdvancing, onAdvance, onExport }: Props) {
  const { currency } = summary;
  const [pick, setPick] = useState<Pick | null>(null);
  const [stage, setStage] = useState<StageKey | null>(null);

  const recovered = useMemo(() => findings.filter((f) => f.status === "recovered"), [findings]);
  const inFlight = useMemo(() => findings.filter((f) => IN_FLIGHT.has(f.status)), [findings]);
  const requests = useRequests(inFlight, version);

  // Recovered
  const matches = (f: Finding, p: Pick) => (p.kind === "vendor" ? vendorName(f.merchant) : typeLabel(f.leak_type)) === p.label;
  const livePick = pick && recovered.some((f) => matches(f, pick)) ? pick : null;
  const listed = livePick ? recovered.filter((f) => matches(f, livePick)) : recovered;
  const monthAgo = time(`${summary.as_of}T23:59:59Z`) - 30 * DAY;
  const recent = recovered.filter((f) => f.recovered_at && time(f.recovered_at) >= monthAgo);
  const timed = recovered.map(daysToRecover).filter((d): d is number => d !== null);
  const average = timed.length ? Math.round(timed.reduce((t, d) => t + d, 0) / timed.length) : null;
  const largest = recovered.reduce<Finding | null>((best, f) => (!best || recoveredMinor(f) > recoveredMinor(best) ? f : best), null);

  // In flight
  const liveStage = stage && inFlight.some((f) => stageOf(f) === stage) ? stage : null;
  const flying = liveStage ? inFlight.filter((f) => stageOf(f) === liveStage) : inFlight;
  const agreed = inFlight.filter((f) => stageOf(f) === "agreed");
  const needs = inFlight.filter((f) => stageOf(f) === "needs");
  // "In flight" everywhere in the app is money waiting on a vendor; a request waiting on you is counted beside it.
  const withVendor = inFlight.filter((f) => stageOf(f) !== "needs");
  const now = time(`${summary.as_of}T12:00:00Z`);
  const longest = inFlight.reduce<{ finding: Finding; days: number } | null>((best, f) => {
    const sentAt = requests.get(f.id)?.sentAt;
    if (!sentAt) return best;
    const days = Math.max(0, Math.floor((now - time(sentAt)) / DAY));
    return !best || days > best.days ? { finding: f, days } : best;
  }, null);

  const rows = view === "recovered" ? listed : flying;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="View"
          options={[
            { value: "recovered", label: "Recovered", count: recovered.length },
            { value: "inflight", label: "In flight", count: inFlight.length },
          ]}
          value={view}
          onChange={onView}
          className="w-full sm:w-72"
        />
        <Button size="sm" disabled={rows.length === 0} onClick={() => onExport(rows, view === "recovered" ? "recovered claim" : "request")}>
          <Download aria-hidden className="size-3.5 text-dim" strokeWidth={2} />
          Export CSV
        </Button>
      </div>

      {view === "recovered" ? (
        recovered.length === 0 ? (
          <div className="flex flex-col items-start gap-3 border-y border-line py-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="m-0 text-14 text-dim">Nothing has come back yet. A claim shows up here once its credit posts to your ledger.</p>
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
          <>
            <section aria-label="Recovered totals" className="grid grid-cols-2 gap-x-8 gap-y-6 border-y border-line py-5 lg:grid-cols-4">
              <Stat label="Recovered" note={plural(recovered.length, "claim")}>
                <span className="text-mint-ink">
                  <Money minor={sum(recovered, recoveredMinor)} currency={currency} roll />
                </span>
              </Stat>
              <Stat label="Last 30 days" note={recent.length === 0 ? "Nothing in this window" : plural(recent.length, "claim")}>
                <Money minor={sum(recent, recoveredMinor)} currency={currency} />
              </Stat>
              <Stat label="Average time to recover" note="From flagged to credit">
                {average === null ? "—" : plural(average, "day")}
              </Stat>
              <Stat label="Largest recovery" note={largest ? vendorName(largest.merchant) : "None yet"}>
                {largest ? <Money minor={recoveredMinor(largest)} currency={currency} /> : "—"}
              </Stat>
            </section>
            <Section title="Where it came from" meta={<span className="max-sm:hidden">Select a vendor or a type to filter the list</span>}>
              <RecoverySankey findings={recovered} currency={currency} pick={livePick} onPick={setPick} />
            </Section>
            <Section title="Recovered claims" meta={livePick ? <FilterChip kind={livePick.kind === "vendor" ? "Vendor" : "Type"} label={livePick.label} onClear={() => setPick(null)} /> : undefined}>
              <RecoveredTable rows={listed} currency={currency} />
            </Section>
          </>
        )
      ) : inFlight.length === 0 ? (
        <div className="flex flex-col items-start gap-3 border-y border-line py-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0 text-14 text-dim">Nothing is in flight. A request shows up here from the moment you send it until its credit posts.</p>
          <SectionLink href="#/claims">Review claims</SectionLink>
        </div>
      ) : (
        <>
          <section aria-label="In flight totals" className="grid grid-cols-2 gap-x-8 gap-y-6 border-y border-line py-5 lg:grid-cols-4">
            <Stat label="In flight" note={`${plural(withVendor.length, "request")} with the vendor`}>
              <Money minor={sum(withVendor, (f) => f.amount_minor)} currency={currency} />
            </Stat>
            <Stat label="Agreed by the vendor" note={agreed.length === 0 ? "None yet" : `${plural(agreed.length, "request")} awaiting credit`}>
              <span className={cn(agreed.length > 0 && "text-mint-ink")}>
                <Money minor={sum(agreed, (f) => f.amount_minor)} currency={currency} />
              </span>
            </Stat>
            <Stat label="Needs your reply" note={needs.length === 0 ? "Nothing to answer" : `${plural(needs.length, "request")} · the vendor asked for details`}>
              <span className={cn(needs.length > 0 && "text-amber-ink")}>
                <Money minor={sum(needs, (f) => f.amount_minor)} currency={currency} />
              </span>
            </Stat>
            <Stat label="Longest wait" note={longest ? vendorName(longest.finding.merchant) : "No send date yet"}>
              {longest ? plural(longest.days, "day") : "—"}
            </Stat>
          </section>
          <Section title="Where each request stands" meta={<span className="max-sm:hidden">Select a stage to filter the list</span>}>
            <StageBar rows={inFlight} currency={currency} stage={liveStage} onStage={setStage} />
          </Section>
          <Section
            title="Requests"
            meta={liveStage ? <FilterChip kind="Stage" label={STAGES.find((s) => s.key === liveStage)?.label ?? ""} onClear={() => setStage(null)} /> : undefined}
          >
            <InFlightTable rows={flying} requests={requests} asOf={summary.as_of} currency={currency} />
          </Section>
        </>
      )}
    </div>
  );
}
