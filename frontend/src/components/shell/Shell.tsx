import { AnimatePresence } from "motion/react";
import { FastForward, HandCoins, Inbox, LayoutGrid, Menu, Play, Plug, type LucideIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { Sources, Summary } from "../../api";
import { formatDate } from "../../format";
import type { Page } from "../../hooks/useHashRoute";
import { cn } from "@/lib/utils";
import { Button } from "../Button";
import { Sheet } from "../Sheet";
import { configured, relativeTime, sourcesHealth, StatusDot } from "../Sources";

export interface ShellProps {
  page: Page;
  claimsCount: number;
  summary: Summary | null;
  sources: Sources | null;
  isRunning: boolean;
  isAdvancing: boolean;
  onRun: () => void;
  onAdvance: () => void;
  children: ReactNode;
}

interface NavItem {
  page: Page;
  label: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { page: "overview", label: "Overview", icon: LayoutGrid },
  { page: "claims", label: "Claims", icon: Inbox },
  { page: "recovered", label: "Recovered", icon: HandCoins },
  { page: "sources", label: "Sources", icon: Plug },
];

function sourcesCount(sources: Sources | null): string | null {
  if (!sources) return null;
  return `${configured(sources).length}/${sources.connectors.length}`;
}

function latestSync(sources: Sources | null): string | null {
  if (!sources) return null;
  return (
    configured(sources)
      .map((c) => c.last_sync?.finished_at)
      .filter((t): t is string => Boolean(t))
      .sort()
      .at(-1) ?? null
  );
}

/** The warm strip at the top of the content: which data you are looking at, and how fresh. */
function Strip({ summary, sources }: { summary: Summary | null; sources: Sources | null }) {
  if (!summary) return <div aria-hidden className="h-8 bg-amber" />;
  const live = summary.data_mode === "live";
  const synced = latestSync(sources);
  return (
    <div role="status" className="label flex h-8 items-center gap-3 overflow-hidden whitespace-nowrap bg-amber px-4 text-ink md:px-8">
      <span aria-hidden className="size-1.5 flex-none rounded-full bg-ink" />
      <span className="truncate">
        {live ? "Live data" : "Demo data"} ·{" "}
        {live ? (synced ? `Synced ${relativeTime(synced)}` : "Not synced yet") : `As of ${formatDate(summary.as_of)}`}
      </span>
    </div>
  );
}

function Controls({ summary, isRunning, isAdvancing, onRun, onAdvance, onDone }: Omit<ShellProps, "page" | "claimsCount" | "sources" | "children"> & { onDone?: () => void }) {
  const demo = Boolean(summary?.demo_mode);
  return (
    <div className="flex flex-col gap-2">
      <p className="label m-0 text-sub">{demo ? "Demo controls" : "Actions"}</p>
      <Button
        variant="ink"
        size="sm"
        className="justify-start"
        isBusy={isRunning}
        title="Read the ledger and inbox again for anything new"
        onClick={() => {
          onDone?.();
          onRun();
        }}
      >
        <Play aria-hidden className="size-3.5 text-sub" strokeWidth={2} />
        Run detection
      </Button>
      {demo && (
        <Button
          variant="ink"
          size="sm"
          className="justify-start"
          isBusy={isAdvancing}
          title="Demo only: move the clock two weeks and play the vendors' side"
          onClick={() => {
            onDone?.();
            onAdvance();
          }}
        >
          <FastForward aria-hidden className="size-3.5 text-sub" strokeWidth={2} />
          Advance 2 weeks
        </Button>
      )}
    </div>
  );
}

function Environment({ summary, sources }: { summary: Summary | null; sources: Sources | null }) {
  const synced = latestSync(sources);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="label m-0 text-sub">Environment</p>
        <p className="m-0 flex items-baseline justify-between gap-2 text-13 text-white">
          <span>{summary?.data_mode === "live" ? "Live" : "Demo"}</span>
          {summary && <span className="ref text-11 uppercase text-sub">{formatDate(summary.as_of)}</span>}
        </p>
      </div>
      <a
        href="#/sources"
        className="-mx-2 flex items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-13 text-white transition-colors hover:bg-panel-2"
      >
        <span className="flex items-center gap-2">
          <StatusDot health={sourcesHealth(sources)} />
          {sources ? `${configured(sources).length} of ${sources.connectors.length} sources` : "Sources"}
        </span>
        <span className="ref text-11 text-sub">{synced ? relativeTime(synced) : "—"}</span>
      </a>
    </div>
  );
}

function Sidebar(props: ShellProps) {
  const { page, claimsCount, sources } = props;
  const counts: Partial<Record<Page, string | null>> = { claims: String(claimsCount), sources: sourcesCount(sources) };
  return (
    <aside className="on-ink fixed inset-y-0 left-0 z-20 hidden w-60 flex-col bg-panel text-white md:flex">
      <a href="#/overview" className="mx-3 mt-5 mb-7 flex h-10 items-center rounded-sm px-2" aria-label="Recoup overview">
        <img src="/brand/recoup-wordmark-ink.png" alt="Recoup" width={994} height={265} className="h-[22px] w-auto" />
      </a>
      <nav aria-label="Pages" className="px-3">
        <ul className="m-0 flex flex-col gap-0.5 p-0">
          {NAV.map((item) => {
            const active = item.page === page;
            const Icon = item.icon;
            return (
              <li key={item.page} className="list-none">
                <a
                  href={`#/${item.page}`}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex h-9 items-center gap-3 rounded-sm px-3 text-14 transition-colors",
                    active ? "bg-panel-2 text-mint" : "text-sub hover:bg-panel-2 hover:text-white",
                  )}
                >
                  {active && <span aria-hidden className="absolute inset-y-2 -left-3 w-0.5 rounded-r-xs bg-mint" />}
                  <Icon aria-hidden className="size-4 flex-none" strokeWidth={1.75} />
                  <span className="flex-1">{item.label}</span>
                  {counts[item.page] && <span className={cn("ref text-11", active ? "text-mint" : "text-sub")}>{counts[item.page]}</span>}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="mt-auto flex flex-col gap-5 border-t border-rule px-5 pb-5 pt-5">
        <Environment summary={props.summary} sources={sources} />
        <Controls {...props} />
      </div>
    </aside>
  );
}

function PhoneBar(props: ShellProps) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <div className="on-ink sticky top-0 z-20 flex h-14 items-center justify-between bg-panel px-4 md:hidden">
        <a href="#/overview" aria-label="Recoup overview" className="flex h-10 items-center rounded-sm">
          <img src="/brand/recoup-wordmark-ink.png" alt="Recoup" width={994} height={265} className="h-5 w-auto" />
        </a>
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setIsOpen(true)}
          className="grid size-10 place-items-center rounded-sm text-white transition-colors hover:bg-panel-2"
          aria-label="Menu"
        >
          <Menu aria-hidden className="size-5" strokeWidth={1.75} />
        </button>
      </div>
      <AnimatePresence>
        {isOpen && (
          <Sheet key="menu" labelId="menu-title" title="Workspace" onClose={() => setIsOpen(false)} tone="ink">
            <div className="flex flex-col gap-6 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2">
              <Environment summary={props.summary} sources={props.sources} />
              <Controls {...props} onDone={() => setIsOpen(false)} />
            </div>
          </Sheet>
        )}
      </AnimatePresence>
    </>
  );
}

function TabBar({ page, claimsCount }: Pick<ShellProps, "page" | "claimsCount">) {
  return (
    <nav aria-label="Pages" className="on-ink fixed inset-x-0 bottom-0 z-20 border-t border-rule bg-panel pb-[env(safe-area-inset-bottom)] md:hidden">
      <ul className="m-0 grid grid-cols-4 p-0">
        {NAV.map((item) => {
          const active = item.page === page;
          const Icon = item.icon;
          return (
            <li key={item.page} className="list-none">
              <a
                href={`#/${item.page}`}
                aria-current={active ? "page" : undefined}
                className={cn("relative flex h-14 flex-col items-center justify-center gap-1 text-11 font-medium", active ? "text-mint" : "text-sub")}
              >
                {active && <span aria-hidden className="absolute inset-x-6 top-0 h-0.5 bg-mint" />}
                <span className="relative">
                  <Icon aria-hidden className="size-5" strokeWidth={1.75} />
                  {item.page === "claims" && claimsCount > 0 && (
                    <span className="ref absolute -right-3 -top-1.5 grid h-4 min-w-4 place-items-center rounded-xs bg-mint px-1 text-11 leading-none text-ink">
                      {claimsCount}
                    </span>
                  )}
                </span>
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Ink sidebar on wide screens; a top bar, a menu sheet and a bottom tab bar on phones. */
export function Shell(props: ShellProps) {
  return (
    <div className="min-h-dvh bg-ground text-ink">
      <Sidebar {...props} />
      <PhoneBar {...props} />
      <div className="flex min-h-dvh min-w-0 flex-col md:pl-60">
        <Strip summary={props.summary} sources={props.sources} />
        <main className="mx-auto flex w-full max-w-[1200px] min-w-0 flex-1 flex-col gap-6 px-4 pb-28 pt-6 md:px-8 md:pb-16 md:pt-8">
          {props.children}
        </main>
      </div>
      <TabBar page={props.page} claimsCount={props.claimsCount} />
    </div>
  );
}
