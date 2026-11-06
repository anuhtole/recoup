import { AnimatePresence, motion } from "motion/react";
import { Check as CheckIcon, ChevronDown, Download, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Finding, LeakType } from "../api";
import { Button } from "../components/Button";
import { Menu, MenuItem, MenuSeparator } from "../components/shell/Menu";
import { Pill, Tag } from "../components/ui";
import { VendorLogo } from "../components/VendorLogo";
import { formatDate, formatMoney, plural } from "../format";
import { vendorName } from "../lib/vendors";
import { SPRING } from "../motion";
import { countsFor, filterRows, referenceOf, rowsFor, type Tab, TABS } from "../queue";
import { isUrgent, LEAK_CHIP, LEAK_LABEL, statusOf } from "../theme";
import { cn } from "@/lib/utils";

const EMPTY: Record<Tab, string> = {
  todo: "Nothing to do right now.",
  waiting: "Nothing is waiting on a vendor.",
  done: "Nothing recovered or dismissed yet.",
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
  /** Downloads the rows on screen as CSV. */
  onExport: (rows: Finding[]) => void;
  isBusy: boolean;
  onBulkDraft: (ids: number[]) => Promise<boolean>;
  onBulkDismiss: (ids: number[], reason: string) => Promise<boolean>;
}

const canDraft = (f: Finding) => ["draft", "follow_up", "escalate"].includes(f.next_action.kind);
const canDismiss = (f: Finding) => !["recovered", "dismissed", "expired"].includes(f.status);
const shownAmount = (f: Finding) => (f.status === "recovered" ? (f.recovered_minor ?? f.amount_minor) : f.amount_minor);

/** Under a respond-by date: "1 day left" while it is close, otherwise "29 days"; "Closed" once it has passed. */
function daysLine(days: number | null): string | null {
  if (days === null) return null;
  if (days < 0) return "Closed";
  if (days === 0) return "Last day";
  if (days <= 3) return days === 1 ? "1 day left" : `${days} days left`;
  return `${days} days`;
}

function Tabs({ tab, counts, onTab }: { tab: Tab; counts: Record<Tab, number>; onTab: (t: Tab) => void }) {
  return (
    <div role="tablist" aria-label="Claim stages" className="flex flex-none gap-6">
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
              "flex h-11 flex-none items-center gap-1.5 whitespace-nowrap text-14 font-medium transition-[color,box-shadow] duration-150",
              active ? "text-ink shadow-[inset_0_-2px_0_var(--ink)]" : "text-dim hover:text-ink",
            )}
          >
            {t.label}
            <span className={cn("figure text-13 font-normal", active ? "text-ink" : "text-dim")}>{counts[t.id]}</span>
          </button>
        );
      })}
    </div>
  );
}

function SearchField({ value, onChange, inputRef }: { value: string; onChange: (v: string) => void; inputRef: React.RefObject<HTMLInputElement> }) {
  return (
    <label className="relative flex h-8 min-w-0 flex-1 items-center md:w-56 md:flex-none">
      <span className="sr-only">Search vendors or references</span>
      <Search aria-hidden className="pointer-events-none absolute left-2.5 size-3.5 text-dim" strokeWidth={2} />
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
        placeholder="Search"
        className="h-full w-full rounded-sm border border-line bg-paper pl-8 pr-3 text-13 md:pr-9 text-ink placeholder:text-dim transition-colors hover:border-line-strong focus-visible:border-ink focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      <kbd aria-hidden className="kbd pointer-events-none absolute right-1.5 max-md:hidden">
        /
      </kbd>
    </label>
  );
}

/** The type filter: a chip that opens a menu; once set it reads "Type: Duplicates" with an × to clear it. */
function TypeFilter({ type, onType }: { type: LeakType | null; onType: (t: LeakType | null) => void }) {
  const chip = "flex h-8 items-center gap-1.5 border border-line bg-paper px-2.5 text-13 transition-colors hover:border-line-strong hover:bg-wash";
  const tick = <CheckIcon aria-hidden className="size-4 text-ink" strokeWidth={2} />;
  const choose = (close: () => void, next: LeakType | null) => {
    close();
    onType(next);
  };
  return (
    <div role="group" aria-label="Filter by type" className="flex flex-none">
      <Menu
        label="Type"
        align="start"
        triggerClassName={cn(chip, type ? "rounded-l-sm" : "rounded-sm text-dim")}
        trigger={
          type ? (
            <span className="whitespace-nowrap">
              <span className="text-dim">Type:</span> <span className="font-medium text-ink">{LEAK_CHIP[type]}</span>
            </span>
          ) : (
            <>
              <span>Type</span>
              <ChevronDown aria-hidden className="size-3.5" strokeWidth={2} />
            </>
          )
        }
      >
        {(close) => (
          <>
            <MenuItem checked={type === null} hint={type === null ? tick : undefined} onSelect={() => choose(close, null)}>
              All types
            </MenuItem>
            <MenuSeparator />
            {TYPES.map((t) => (
              <MenuItem key={t} checked={type === t} hint={type === t ? tick : undefined} onSelect={() => choose(close, t)}>
                {LEAK_CHIP[t]}
              </MenuItem>
            ))}
          </>
        )}
      </Menu>
      {type && (
        <button
          type="button"
          onClick={() => onType(null)}
          aria-label="Clear type filter"
          title="Clear type filter"
          className={cn(chip, "-ml-px rounded-r-sm px-1.5 text-dim hover:text-ink")}
        >
          <X aria-hidden className="size-3.5" strokeWidth={2} />
        </button>
      )}
    </div>
  );
}

/** A checkbox with a 40px hit area, so a near miss selects instead of opening the case. */
function Check({ checked, indeterminate, onChange, label }: { checked: boolean; indeterminate?: boolean; onChange: () => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate);
  }, [indeterminate]);
  return (
    <label className="grid size-10 cursor-pointer place-items-center" onClick={(e) => e.stopPropagation()}>
      <input ref={ref} type="checkbox" aria-label={label} checked={checked} onChange={onChange} className="size-4 cursor-pointer rounded-xs accent-ink" />
    </label>
  );
}

function RespondBy({ f }: { f: Finding }) {
  if (!f.recover_by) return <span className="text-dim">—</span>;
  const line = daysLine(f.days_left);
  return (
    <span className="flex flex-col">
      <span className="figure text-14 leading-5">{formatDate(f.recover_by, "short")}</span>
      {line && <span className={cn("text-12", isUrgent(f.days_left) ? "font-medium text-amber-ink" : "text-dim")}>{line}</span>}
    </span>
  );
}

/** The exception a To do row carries beside its vendor: "Needs review", "Draft ready", "Declined". */
function InlineStatus({ f }: { f: Finding }) {
  const status = statusOf(f);
  if (status.label === "New") return null;
  return <Tag tone={status.tone === "amber" ? "amber" : "neutral"}>{status.label}</Tag>;
}

function Total({ rows }: { rows: Finding[] }) {
  const total = rows.reduce((sum, f) => sum + shownAmount(f), 0);
  return (
    <span className="flex items-center justify-between gap-4 text-13 text-dim">
      <span>{plural(rows.length, "claim")}</span>
      <span>
        Total <span className="figure ml-1 text-14 font-medium text-ink">{formatMoney(total, rows[0]?.currency ?? "USD")}</span>
      </span>
    </span>
  );
}

function Table({
  rows,
  tab,
  cursor,
  selected,
  onToggle,
  onToggleAll,
  onOpen,
}: {
  rows: Finding[];
  tab: Tab;
  cursor: number | null;
  selected: Set<number>;
  onToggle: (id: number) => void;
  onToggleAll: () => void;
  onOpen: (id: number) => void;
}) {
  const all = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const some = rows.some((r) => selected.has(r.id));
  // Status only where it varies: every To do row is open, so its exceptions ride inline instead.
  const withStatus = tab !== "todo";
  return (
    <table className="w-full table-fixed border-collapse text-left">
      <colgroup>
        <col className="w-12" />
        <col className="lg:w-[36%]" />
        <col className="hidden lg:table-column" />
        <col className="w-[136px]" />
        {withStatus && <col className="w-[152px]" />}
        <col className="w-[136px]" />
      </colgroup>
      <thead>
        <tr className="h-10 border-b border-line text-12 text-dim">
          <th scope="col" className="pl-1">
            <Check checked={all} indeterminate={!all && some} onChange={onToggleAll} label="Select all" />
          </th>
          <th scope="col" className="px-3 font-medium">
            Vendor
          </th>
          <th scope="col" className="hidden px-3 font-medium lg:table-cell">
            Type
          </th>
          <th scope="col" className="px-3 font-medium">
            Respond by
          </th>
          {withStatus && (
            <th scope="col" className="px-3 font-medium">
              Status
            </th>
          )}
          <th scope="col" className="pl-3 pr-4 text-right font-medium">
            Amount
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((f) => {
          const on = cursor === f.id;
          const isSelected = selected.has(f.id);
          const reference = referenceOf(f.reason);
          const status = statusOf(f);
          return (
            <tr
              key={f.id}
              data-case-id={f.id}
              data-cursor={on || undefined}
              aria-selected={isSelected}
              onClick={() => onOpen(f.id)}
              className={cn(
                "h-13 cursor-pointer border-b border-line transition-colors duration-100",
                on ? "bg-wash" : isSelected ? "bg-ground/70" : "hover:bg-wash",
              )}
            >
              <td className={cn("pl-1", on && "shadow-[inset_2px_0_0_var(--ink)]")}>
                <Check checked={isSelected} onChange={() => onToggle(f.id)} label={`Select ${vendorName(f.merchant)}`} />
              </td>
              <td className="px-3">
                <div className="flex min-w-0 items-center gap-3">
                  <VendorLogo name={f.merchant} />
                  <div className="flex min-w-0 flex-col">
                    <span className="flex min-w-0 items-center gap-2">
                      <a
                        href={`#/claims/${f.id}`}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onOpen(f.id);
                        }}
                        className="min-w-0 truncate text-14 font-medium leading-5 focus-visible:outline-offset-4"
                      >
                        {vendorName(f.merchant)}
                      </a>
                      {tab === "todo" && <InlineStatus f={f} />}
                    </span>
                    <span className="truncate text-12 text-dim">
                      {reference && <span className="ref">{reference}</span>}
                      <span className="lg:hidden">
                        {reference && " · "}
                        {LEAK_LABEL[f.leak_type]}
                      </span>
                    </span>
                  </div>
                </div>
              </td>
              <td className="hidden truncate px-3 text-14 text-dim lg:table-cell">{LEAK_LABEL[f.leak_type]}</td>
              <td className="px-3">
                <RespondBy f={f} />
              </td>
              {withStatus && (
                <td className="px-3">
                  <Pill label={status.label} tone={status.tone} />
                </td>
              )}
              <td className={cn("figure pl-3 pr-4 text-right text-14 font-medium", f.status === "recovered" && "text-mint-ink")}>
                {formatMoney(shownAmount(f), f.currency)}
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr className="h-12">
          <td colSpan={withStatus ? 6 : 5} className="pl-4 pr-4">
            <Total rows={rows} />
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

function PhoneList({ rows, tab, onOpen }: { rows: Finding[]; tab: Tab; onOpen: (id: number) => void }) {
  return (
    <>
      <ul className="m-0 flex flex-col p-0">
        {rows.map((f) => {
          const status = statusOf(f);
          const line = daysLine(f.days_left);
          const reference = referenceOf(f.reason);
          return (
            <li key={f.id} className="list-none border-b border-line">
              <a
                href={`#/claims/${f.id}`}
                data-case-id={f.id}
                onClick={(e) => {
                  e.preventDefault();
                  onOpen(f.id);
                }}
                className="-mx-4 flex items-start gap-3 px-4 py-3.5 transition-colors active:bg-wash"
              >
                <VendorLogo name={f.merchant} className="mt-0.5" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-14 font-medium">{vendorName(f.merchant)}</span>
                      {tab === "todo" && <InlineStatus f={f} />}
                    </span>
                    <span className={cn("figure flex-none text-14 font-medium", f.status === "recovered" && "text-mint-ink")}>
                      {formatMoney(shownAmount(f), f.currency)}
                    </span>
                  </span>
                  <span className="flex items-baseline justify-between gap-3 text-13">
                    <span className="min-w-0 truncate text-dim">
                      {LEAK_LABEL[f.leak_type]}
                      {reference && <span className="ref text-12"> · {reference}</span>}
                    </span>
                    {tab === "todo"
                      ? line && <span className={cn("flex-none", isUrgent(f.days_left) ? "font-medium text-amber-ink" : "text-dim")}>{line}</span>
                      : <Pill label={status.label} tone={status.tone} />}
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
      <div className="py-3">
        <Total rows={rows} />
      </div>
    </>
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
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={SPRING}
      className="on-ink float fixed inset-x-4 bottom-20 z-30 mx-auto flex w-fit max-w-[calc(100vw-2rem)] flex-wrap items-center justify-center gap-1 rounded-md bg-panel p-1.5 pl-3.5 text-white md:bottom-6 md:left-58 md:right-0"
    >
      {isDismissing ? (
        <form
          className="flex flex-wrap items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim()) onDismiss(reason.trim());
          }}
        >
          <label htmlFor="bulk-reason" className="sr-only">
            Why {dismissable === 1 ? "it isn't" : "they aren't"} owed
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
            placeholder={dismissable === 1 ? "Why isn't it owed?" : `Why aren't these ${dismissable} owed?`}
            className="mr-1 h-8 w-64 rounded-sm border border-rule bg-panel-2 px-3 text-13 text-white placeholder:text-sub focus-visible:border-mint focus-visible:outline-none"
          />
          <Button type="submit" size="sm" variant="primary" disabled={!reason.trim()} isBusy={isBusy}>
            Dismiss {dismissable}
          </Button>
          <Button size="sm" variant="ink-ghost" onClick={() => setIsDismissing(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <>
          <span className="figure pr-2 text-13 text-sub">
            <span className="font-medium text-white">{rows.length}</span> selected
          </span>
          <Button
            size="sm"
            variant="primary"
            disabled={draftable === 0}
            isBusy={isBusy}
            onClick={onDraft}
            title="Drafts only. Each one is still reviewed and sent on its own."
          >
            Draft {draftable > 0 && draftable !== rows.length ? `${draftable} ` : ""}
            {draftable === 1 ? "request" : "requests"}
          </Button>
          <Button size="sm" variant="ink-ghost" disabled={dismissable === 0} onClick={() => setIsDismissing(true)}>
            Dismiss…
          </Button>
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear selection"
            title="Clear selection (Esc)"
            className="grid size-8 place-items-center rounded-sm text-sub transition-colors hover:bg-panel-2 hover:text-white"
          >
            <X aria-hidden className="size-4" strokeWidth={1.75} />
          </button>
        </>
      )}
    </motion.div>
  );
}

/** The full claims list: stage tabs, type and search in the hash, a keyboard-driven table, a bulk bar. */
export function Claims({ findings, params, onParams, onOpen, onExport, isBusy, onBulkDraft, onBulkDismiss }: Props) {
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
  const tabLabel = TABS.find((t) => t.id === params.tab)?.label ?? "";

  return (
    <div className="flex flex-col gap-3 xl:gap-0">
      {/* One toolbar row where it fits; below 1280px the filters drop under the tabs instead of squeezing. */}
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between xl:gap-6 xl:border-b xl:border-line">
        <div className="-mx-4 overflow-x-auto border-b border-line px-4 [scrollbar-width:none] md:mx-0 md:px-0 xl:overflow-visible xl:border-0">
          <Tabs tab={params.tab} counts={counts} onTab={(tab) => set({ tab })} />
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <TypeFilter type={params.type} onType={(type) => set({ type })} />
          <SearchField value={params.q} onChange={(q) => set({ q })} inputRef={search} />
          <Button size="sm" onClick={() => onExport(rows)} disabled={rows.length === 0} title="Download these claims as a CSV file" aria-label="Export" className="flex-none">
            <Download aria-hidden className="size-3.5" strokeWidth={2} />
            <span className="hidden sm:inline">Export</span>
          </Button>
        </div>
      </div>

      <section aria-label="Claims list" aria-keyshortcuts="j k ArrowDown ArrowUp Enter x /">
        {params.tab === "closed" && rows.length > 0 && (
          <p className="m-0 border-b border-line py-3 text-13 text-dim">Too late for a card dispute. The vendor can still refund you directly.</p>
        )}
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-20 text-center">
            <p className="m-0 max-w-[44ch] text-14 text-dim text-balance">
              {isFiltered
                ? `No ${tabLabel.toLowerCase()} claims match${params.q ? ` “${params.q}”` : ""}${params.type ? ` in ${LEAK_CHIP[params.type].toLowerCase()}` : ""}.`
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
                tab={params.tab}
                cursor={cursor}
                selected={selected}
                onToggle={toggle}
                onToggleAll={() => setSelected(rows.every((r) => selected.has(r.id)) ? new Set() : new Set(rows.map((r) => r.id)))}
                onOpen={onOpen}
              />
            </div>
            <div className="md:hidden">
              <PhoneList rows={rows} tab={params.tab} onOpen={onOpen} />
            </div>
          </>
        )}
      </section>

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
    </div>
  );
}
