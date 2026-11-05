import { AnimatePresence, motion } from "motion/react";
import { Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Finding, LeakType } from "../api";
import { Button } from "../components/Button";
import { DaysTag, MonoDate, PageHeader, Pill, VendorTile } from "../components/ui";
import { formatMoney, plural } from "../format";
import { SPRING } from "../motion";
import { countsFor, filterRows, referenceOf, rowsFor, type Tab, TABS } from "../queue";
import { isUrgent, LEAK_CHIP, LEAK_LABEL, statusOf } from "../theme";
import { cn } from "@/lib/utils";

const EMPTY: Record<Tab, string> = {
  todo: "Nothing needs you right now. New cases show up here after Run detection.",
  waiting: "Requests you send wait here until the vendor replies or the money lands.",
  done: "Recovered and dismissed cases collect here.",
  closed: "No claim windows have closed.",
};

const TYPES = Object.keys(LEAK_CHIP) as LeakType[];
const TYPING = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export interface ClaimsParams {
  tab: Tab;
  q: string;
  type: LeakType | null;
}

export function readParams(params: Record<string, string>): ClaimsParams {
  const tab = (TABS.find((t) => t.id === params.tab)?.id ?? "todo") as Tab;
  const type = TYPES.includes(params.type as LeakType) ? (params.type as LeakType) : null;
  return { tab, q: params.q ?? "", type };
}

export function writeParams(p: ClaimsParams): Record<string, string> {
  const out: Record<string, string> = {};
  if (p.tab !== "todo") out.tab = p.tab;
  if (p.q) out.q = p.q;
  if (p.type) out.type = p.type;
  return out;
}

/** The ids of the list as it is filtered now, for prev/next on the case page. */
export function visibleIds(findings: Finding[], p: ClaimsParams): number[] {
  return filterRows(rowsFor(findings, p.tab), p.q, p.type).map((f) => f.id);
}

interface Props {
  findings: Finding[];
  params: ClaimsParams;
  onParams: (next: ClaimsParams) => void;
  onOpen: (id: number) => void;
  isBusy: boolean;
  onBulkDraft: (ids: number[]) => Promise<boolean>;
  onBulkDismiss: (ids: number[], reason: string) => Promise<boolean>;
}

const canDraft = (f: Finding) => ["draft", "follow_up", "escalate"].includes(f.next_action.kind);
const canDismiss = (f: Finding) => !["recovered", "dismissed", "expired"].includes(f.status);

function Tabs({ tab, counts, onTab }: { tab: Tab; counts: Record<Tab, number>; onTab: (t: Tab) => void }) {
  return (
    <div role="tablist" aria-label="Claim stages" className="-mx-4 flex overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0">
      <div className="flex flex-none gap-1 rounded-sm border border-line bg-paper p-1">
      {TABS.map((t) => {
        const active = t.id === tab;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onTab(t.id)}
            className={cn(
              "relative flex h-8 flex-none items-center justify-center gap-2 whitespace-nowrap rounded-xs px-3 text-13 font-medium transition-colors",
              active ? "text-white" : "text-dim hover:bg-wash hover:text-ink",
            )}
          >
            {active && <motion.span layoutId="claims-tab" transition={SPRING} aria-hidden className="absolute inset-0 rounded-xs bg-panel" />}
            <span className="relative">{t.label}</span>
            <span className={cn("ref relative text-11", active ? "text-mint" : "text-dim")}>{counts[t.id]}</span>
          </button>
        );
      })}
      </div>
    </div>
  );
}

function SearchField({ value, onChange, inputRef }: { value: string; onChange: (v: string) => void; inputRef: React.RefObject<HTMLInputElement> }) {
  return (
    <label className="relative flex h-9 w-full items-center md:w-72">
      <span className="sr-only">Search vendors or references</span>
      <Search aria-hidden className="pointer-events-none absolute left-3 size-4 text-dim" strokeWidth={1.75} />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            if (value) onChange("");
            e.currentTarget.blur();
          }
        }}
        placeholder="Search vendors or references"
        className="h-full w-full rounded-sm border border-line bg-paper pl-9 pr-10 text-14 text-ink placeholder:text-dim transition-colors hover:border-line-strong focus-visible:border-ink focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      <kbd aria-hidden className="ref pointer-events-none absolute right-2 grid h-5 min-w-5 place-items-center rounded-xs border border-line px-1 text-11 text-dim">
        /
      </kbd>
    </label>
  );
}

function TypeChips({ type, onType }: { type: LeakType | null; onType: (t: LeakType | null) => void }) {
  const chip = (active: boolean) =>
    cn(
      "h-8 flex-none whitespace-nowrap rounded-xs border px-3 text-13 transition-colors",
      active
        ? "border-ink bg-paper font-medium text-ink underline decoration-2 underline-offset-[6px]"
        : "border-line bg-paper text-dim hover:border-line-strong hover:text-ink",
    );
  return (
    <div role="group" aria-label="Filter by type" className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0">
      <button type="button" aria-pressed={type === null} onClick={() => onType(null)} className={chip(type === null)}>
        All types
      </button>
      {TYPES.map((t) => (
        <button key={t} type="button" aria-pressed={type === t} onClick={() => onType(type === t ? null : t)} className={chip(type === t)}>
          {LEAK_CHIP[t]}
        </button>
      ))}
    </div>
  );
}

/** A checkbox with a 40px hit area, so a near miss selects instead of opening the case. */
function Check({ checked, indeterminate, onChange, label, onInk }: { checked: boolean; indeterminate?: boolean; onChange: () => void; label: string; onInk?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate);
  }, [indeterminate]);
  return (
    <label className="grid size-10 cursor-pointer place-items-center" onClick={(e) => e.stopPropagation()}>
      <input
        ref={ref}
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={onChange}
        className={cn("size-4 cursor-pointer rounded-xs", onInk ? "accent-mint" : "accent-ink")}
      />
    </label>
  );
}

function RespondBy({ f, onInk }: { f: Finding; onInk: boolean }) {
  if (!f.recover_by) return <span className={onInk ? "text-sub" : "text-dim"}>—</span>;
  const closed = f.days_left !== null && f.days_left < 0;
  const urgent = isUrgent(f.days_left);
  return (
    <span className="flex flex-col leading-tight">
      <MonoDate iso={f.recover_by} className={cn("text-13", onInk ? "text-white" : "text-ink")} />
      <span
        className={cn(
          "ref text-11",
          closed ? (onInk ? "text-sub" : "text-dim") : urgent ? (onInk ? "text-amber" : "text-amber-ink") : onInk ? "text-sub" : "text-dim",
        )}
      >
        {closed ? "Closed" : f.days_left === 0 ? "Today" : f.days_left === 1 ? "1 day left" : `${f.days_left} days left`}
      </span>
    </span>
  );
}

function Table({
  rows,
  cursor,
  selected,
  onToggle,
  onToggleAll,
  onOpen,
}: {
  rows: Finding[];
  cursor: number | null;
  selected: Set<number>;
  onToggle: (id: number) => void;
  onToggleAll: () => void;
  onOpen: (id: number) => void;
}) {
  const all = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const some = rows.some((r) => selected.has(r.id));
  return (
    <table className="w-full table-fixed border-collapse text-left">
      <colgroup>
        <col className="w-14" />
        <col className="lg:w-[36%]" />
        <col className="hidden lg:table-column" />
        <col className="w-[136px]" />
        <col className="w-[136px]" />
        <col className="w-[160px]" />
      </colgroup>
      <thead>
        <tr className="h-10 border-b border-line">
          <th scope="col" className="pl-2">
            <Check checked={all} indeterminate={!all && some} onChange={onToggleAll} label="Select all" />
          </th>
          <th scope="col" className="label px-3 font-medium text-dim">Vendor</th>
          <th scope="col" className="label hidden px-3 font-medium text-dim lg:table-cell">Type</th>
          <th scope="col" className="label px-3 text-right font-medium text-dim">Amount</th>
          <th scope="col" className="label px-3 font-medium text-dim">Respond by</th>
          <th scope="col" className="label pl-3 pr-4 font-medium text-dim">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((f) => {
          const on = cursor === f.id;
          const isSelected = selected.has(f.id);
          const reference = referenceOf(f.reason);
          const status = statusOf(f);
          const amount = f.status === "recovered" ? (f.recovered_minor ?? f.amount_minor) : f.amount_minor;
          return (
            <tr
              key={f.id}
              data-case-id={f.id}
              data-cursor={on || undefined}
              aria-selected={isSelected}
              onClick={() => onOpen(f.id)}
              className={cn(
                "h-14 cursor-pointer border-b border-line transition-colors duration-100 last:border-b-0",
                on ? "on-ink bg-panel text-white" : isSelected ? "bg-mint-wash/60" : "hover:bg-wash",
              )}
            >
              <td className={cn("relative pl-2", on && "shadow-[inset_2px_0_0_var(--mint)]")}>
                <Check checked={isSelected} onChange={() => onToggle(f.id)} label={`Select ${f.merchant}`} onInk={on} />
              </td>
              <td className="px-3">
                <div className="flex min-w-0 items-center gap-3">
                  <VendorTile name={f.merchant} className={on ? "bg-panel-2 text-mint" : undefined} />
                  <div className="flex min-w-0 flex-col leading-tight">
                    <a
                      href={`#/claims/${f.id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onOpen(f.id);
                      }}
                      className="inline-flex min-h-6 max-w-full items-center truncate text-14 font-medium focus-visible:outline-offset-4"
                    >
                      {f.merchant}
                    </a>
                    <span className={cn("ref truncate text-11", on ? "text-sub" : "text-dim")}>
                      {reference ?? `CASE-${String(f.id).padStart(4, "0")}`}
                      <span className="lg:hidden"> · {LEAK_LABEL[f.leak_type]}</span>
                    </span>
                  </div>
                </div>
              </td>
              <td className={cn("hidden truncate px-3 text-13 lg:table-cell", on ? "text-sub" : "text-dim")}>{LEAK_LABEL[f.leak_type]}</td>
              <td className={cn("figure px-3 text-right text-14 font-medium", on ? "text-mint" : f.status === "recovered" && "text-mint-ink")}>
                {formatMoney(amount, f.currency)}
              </td>
              <td className="px-3">
                <RespondBy f={f} onInk={on} />
              </td>
              <td className="pl-3 pr-4">
                {/* Only exceptions get a pill; "New" is the default state of every open row. */}
                {status.label !== "New" && <Pill label={status.label} tone={status.tone} onInk={on} />}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function PhoneList({ rows, onOpen }: { rows: Finding[]; onOpen: (id: number) => void }) {
  return (
    <ul className="m-0 flex flex-col p-0">
      {rows.map((f) => {
        const status = statusOf(f);
        const amount = f.status === "recovered" ? (f.recovered_minor ?? f.amount_minor) : f.amount_minor;
        const reference = referenceOf(f.reason);
        return (
          <li key={f.id} className="list-none border-b border-line last:border-b-0">
            <a
              href={`#/claims/${f.id}`}
              data-case-id={f.id}
              onClick={(e) => {
                e.preventDefault();
                onOpen(f.id);
              }}
              className="flex items-start gap-3 px-4 py-4 transition-colors active:bg-wash"
            >
              <VendorTile name={f.merchant} />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-14 font-medium">{f.merchant}</span>
                  <span className={cn("figure flex-none text-14 font-medium", f.status === "recovered" && "text-mint-ink")}>{formatMoney(amount, f.currency)}</span>
                </span>
                <span className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-13 text-dim">
                    {LEAK_LABEL[f.leak_type]}
                    {reference && <span className="ref text-11"> · {reference}</span>}
                  </span>
                  {f.stage === "todo" && f.days_left !== null && f.days_left >= 0 ? (
                    <DaysTag days={f.days_left} />
                  ) : (
                    status.label !== "New" && <Pill label={status.label} tone={status.tone} />
                  )}
                </span>
                {/* Exceptions (needs review, draft ready) get their own line, so the type never truncates. */}
                {f.stage === "todo" && f.days_left !== null && f.days_left >= 0 && status.label !== "New" && (
                  <span className="flex">
                    <Pill label={status.label} tone={status.tone} />
                  </span>
                )}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function BulkBar({
  rows,
  isBusy,
  onClear,
  onDraft,
  onDismiss,
}: {
  rows: Finding[];
  isBusy: boolean;
  onClear: () => void;
  onDraft: () => void;
  onDismiss: (reason: string) => void;
}) {
  const [isDismissing, setIsDismissing] = useState(false);
  const [reason, setReason] = useState("");
  const draftable = rows.filter(canDraft).length;
  const dismissable = rows.filter(canDismiss).length;
  return (
    <motion.div
      role="region"
      aria-label="Bulk actions"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 24 }}
      transition={SPRING}
      className="on-ink float fixed bottom-20 left-4 right-4 z-30 flex flex-wrap items-center gap-2 rounded-md border border-rule bg-panel p-2 pl-4 text-white md:bottom-6 md:left-[calc(50%+120px)] md:right-auto md:-translate-x-1/2"
    >
      {isDismissing ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim()) onDismiss(reason.trim());
          }}
        >
          <label htmlFor="bulk-reason" className="text-13 text-sub">
            Why are these {dismissable} not owed?
          </label>
          <input
            id="bulk-reason"
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setIsDismissing(false);
              }
            }}
            maxLength={500}
            placeholder="One reason, kept in each history"
            className="h-8 w-64 rounded-xs border border-rule bg-panel-2 px-3 text-13 text-white placeholder:text-sub focus-visible:border-mint focus-visible:outline-none"
          />
          <Button type="submit" size="sm" variant="ink" disabled={!reason.trim()} isBusy={isBusy}>
            Dismiss {dismissable}
          </Button>
          <Button size="sm" variant="ink-ghost" onClick={() => setIsDismissing(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <>
          <span className="ref pr-2 text-13">
            <span className="text-mint">{rows.length}</span> selected
          </span>
          <span aria-hidden className="h-5 w-px bg-rule" />
          <Button
            size="sm"
            variant="primary"
            disabled={draftable === 0}
            isBusy={isBusy}
            onClick={onDraft}
            title="Creates drafts only. Each one is still reviewed and sent on its own."
          >
            Draft {draftable > 0 && draftable !== rows.length ? `${draftable} ` : ""}requests
          </Button>
          <Button size="sm" variant="ink" disabled={dismissable === 0} onClick={() => setIsDismissing(true)}>
            Dismiss…
          </Button>
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear selection"
            className="grid size-8 place-items-center rounded-sm text-sub transition-colors hover:bg-panel-2 hover:text-white"
          >
            <X aria-hidden className="size-4" strokeWidth={1.75} />
          </button>
        </>
      )}
    </motion.div>
  );
}

/** The full claims list: stage tabs, search and type in the hash, a keyboard-driven table, a bulk bar. */
export function Claims({ findings, params, onParams, onOpen, isBusy, onBulkDraft, onBulkDismiss }: Props) {
  const counts = useMemo(() => countsFor(findings), [findings]);
  const tabRows = useMemo(() => rowsFor(findings, params.tab), [findings, params.tab]);
  const rows = useMemo(() => filterRows(tabRows, params.q, params.type), [tabRows, params.q, params.type]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const search = useRef<HTMLInputElement>(null);
  const isFiltered = Boolean(params.q || params.type);

  // Selection belongs to the rows you can see.
  useEffect(() => {
    setSelected((current) => {
      const visible = new Set(rows.map((r) => r.id));
      const next = new Set([...current].filter((id) => visible.has(id)));
      return next.size === current.size ? current : next;
    });
    setCursor((c) => (c !== null && rows.some((r) => r.id === c) ? c : null));
  }, [rows]);

  const toggle = (id: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // j / k or arrows move, Enter opens, x selects, / searches, Escape clears the selection.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (TYPING.has(target.tagName) || target.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      if (event.key === "/") {
        event.preventDefault();
        search.current?.focus();
        return;
      }
      if (event.key === "Escape" && selected.size > 0) {
        setSelected(new Set());
        return;
      }
      if (rows.length === 0) return;
      const index = cursor === null ? -1 : rows.findIndex((r) => r.id === cursor);
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        setCursor(rows[Math.min(index + 1, rows.length - 1)].id);
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        setCursor(rows[Math.max(index - 1, 0)].id);
      } else if (event.key === "Enter" && cursor !== null) {
        event.preventDefault();
        onOpen(cursor);
      } else if (event.key === "x" && cursor !== null) {
        event.preventDefault();
        toggle(cursor);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, cursor, selected.size, onOpen]);

  // Keep the cursor row in view.
  useEffect(() => {
    if (cursor === null) return;
    document.querySelector(`tr[data-case-id="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const selectedRows = rows.filter((r) => selected.has(r.id));
  const set = (patch: Partial<ClaimsParams>) => onParams({ ...params, ...patch });

  return (
    <>
      <PageHeader
        crumbs={<span>Recoup / Claims</span>}
        title="Claims"
        meta={
          <p className="m-0 text-14 text-dim">
            <span className="figure font-medium text-ink">{formatMoney(rowsFor(findings, "todo").reduce((s, f) => s + f.amount_minor, 0))}</span> open to claim across{" "}
            {plural(counts.todo, "case")}, the most urgent first.
          </p>
        }
      />
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <Tabs tab={params.tab} counts={counts} onTab={(tab) => set({ tab })} />
          <SearchField value={params.q} onChange={(q) => set({ q })} inputRef={search} />
        </div>
        <TypeChips type={params.type} onType={(type) => set({ type })} />
      </div>

      <section aria-label="Claims list" className="card overflow-hidden" aria-keyshortcuts="j k ArrowDown ArrowUp Enter x /">
        {params.tab === "closed" && rows.length > 0 && (
          <p className="m-0 border-b border-line bg-wash px-4 py-3 text-13 text-dim">
            The card dispute window has passed on these. The vendor can still refund you directly.
          </p>
        )}
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <p className="m-0 max-w-[44ch] text-14 text-dim text-balance">
              {isFiltered
                ? `No ${TABS.find((t) => t.id === params.tab)?.label.toLowerCase()} claims match${params.q ? ` “${params.q}”` : ""}${params.type ? ` in ${LEAK_CHIP[params.type].toLowerCase()}` : ""}.`
                : EMPTY[params.tab]}
            </p>
            {isFiltered && (
              <Button size="sm" onClick={() => set({ q: "", type: null })}>
                Clear filters
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="hidden md:block">
              <Table
                rows={rows}
                cursor={cursor}
                selected={selected}
                onToggle={toggle}
                onToggleAll={() => setSelected(rows.every((r) => selected.has(r.id)) ? new Set() : new Set(rows.map((r) => r.id)))}
                onOpen={onOpen}
              />
            </div>
            <div className="md:hidden">
              <PhoneList rows={rows} onOpen={onOpen} />
            </div>
          </>
        )}
      </section>
      <p className="label m-0 hidden text-dim md:block">
        J / K to move · Enter to open · X to select · / to search
      </p>

      <AnimatePresence>
        {selectedRows.length > 0 && (
          <BulkBar
            key="bulk"
            rows={selectedRows}
            isBusy={isBusy}
            onClear={() => setSelected(new Set())}
            onDraft={() => void onBulkDraft(selectedRows.filter(canDraft).map((r) => r.id)).then((ok) => ok && setSelected(new Set()))}
            onDismiss={(reason) => void onBulkDismiss(selectedRows.filter(canDismiss).map((r) => r.id), reason).then((ok) => ok && setSelected(new Set()))}
          />
        )}
      </AnimatePresence>
    </>
  );
}
