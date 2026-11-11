import { AnimatePresence } from "motion/react";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronsUpDown,
  CircleHelp,
  Download,
  FastForward,
  HandCoins,
  Inbox,
  Keyboard,
  LayoutGrid,
  Menu as MenuIcon,
  Play,
  Plug,
  RotateCcw,
  Search,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { Finding, Sources, Summary } from "../../api";
import { formatDate } from "../../format";
import type { Page } from "../../hooks/useHashRoute";
import { cn } from "@/lib/utils";
import { Button } from "../Button";
import { Sheet } from "../Sheet";
import { configured, relativeTime, sourcesHealth, StatusDot } from "../Sources";
import { vendorInitial, vendorTint } from "@/lib/vendors";
import { type Command, CommandPalette } from "./CommandPalette";
import { Menu, MenuItem, MenuNote, MenuSeparator } from "./Menu";
import { TopBarSlot } from "./TopBarActions";

export interface ShellProps {
  page: Page;
  /** The top bar title; pages don't repeat it below. */
  title: ReactNode;
  /** The title is a trail ("Claims / Figma") on a detail page, whose own header holds the h1. */
  isBreadcrumb?: boolean;
  claimsCount: number;
  summary: Summary | null;
  sources: Sources | null;
  findings: Finding[];
  isRunning: boolean;
  isAdvancing: boolean;
  /** Restart demo is putting the server back to its clean slate. */
  isRestarting: boolean;
  /** The agent is in the middle of something (scanning, drafting, sending): the clock stays put until it is done. */
  isLocked: boolean;
  onRun: () => void;
  onAdvance: () => void;
  /** The same two weeks from the keyboard, with no notices: the presenter's cut to "two weeks later". */
  onAdvanceQuiet: () => void;
  /** Demo only: back to the clean slate, and a new conversation on the Agent page. */
  onRestart: () => void;
  onExport: () => void;
  onOpenCase: (id: number) => void;
  onGo: (page: Page) => void;
  children: ReactNode;
}

interface NavItem {
  page: Page;
  label: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { page: "agent", label: "Agent", icon: Sparkles },
  { page: "overview", label: "Overview", icon: LayoutGrid },
  { page: "claims", label: "Claims", icon: Inbox },
  { page: "recovered", label: "Recovered", icon: HandCoins },
  { page: "sources", label: "Sources", icon: Plug },
];

/** The org's name comes from the API (Settings.org_name, which also signs every letter); this is the fallback. */
const DEFAULT_ORG = "Acme Inc.";
const orgOf = (summary: Summary | null) => summary?.org_name ?? DEFAULT_ORG;
const USER = { name: "Jackson", initials: "JG" };
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = IS_MAC ? "⌘" : "Ctrl ";

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: [`${MOD}K`], label: "Search and commands" },
  { keys: ["/"], label: "Filter claims" },
  { keys: ["J", "K"], label: "Next and previous claim" },
  { keys: ["↵"], label: "Open claim" },
  { keys: ["X"], label: "Select claim" },
  { keys: ["Esc"], label: "Back to the list, or close" },
  { keys: ["?"], label: "Keyboard shortcuts" },
];

const TYPING = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * Ctrl+Shift+. (the ">" key) advances the demo two weeks from any page, even while typing. It is for
 * the presenter, so it is not in the shortcuts list: three keys, none of them used by anything else here.
 */
// Matched by the physical key and by the character, so it works on any layout and with remotes or
// tools that send a key without a code.
const isAdvanceKey = (event: KeyboardEvent) =>
  event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && (event.code === "Period" || event.key === "." || event.key === ">");

/**
 * Where the data stands, in one quiet line. Generated data has no ledger sync to report, so it gives the
 * date the data runs to ("Data as of Oct 1"); live, "Ledger synced · 3 hours ago".
 */
function sourcesLine(summary: Summary | null, sources: Sources | null): string {
  if (!summary) return "Sources";
  if (summary.data_mode !== "live") return `Data as of ${formatDate(summary.as_of, "short")}`;
  const ledger = sources?.connectors.find((c) => c.kind === "ledger");
  if (!ledger?.configured) return "Ledger not connected";
  return ledger.last_sync ? `Ledger synced · ${relativeTime(ledger.last_sync.finished_at)}` : "Ledger not synced yet";
}

/** The Recoup product mark: small, in the sidebar footer. The org has its own tile above. */
function Mark({ size = 16 }: { size?: number }) {
  return <img src="/brand/recoup-mark-180-ink.png" alt="" width={size} height={size} className="flex-none rounded-xs" style={{ width: size, height: size }} />;
}

/** The org's tile: its initial on a soft tint, like any account avatar. */
function OrgTile({ name, size = 24 }: { name: string; size?: number }) {
  const tint = vendorTint(name);
  return (
    <span
      aria-hidden
      className="grid flex-none place-items-center rounded-sm font-semibold leading-none"
      style={{ width: size, height: size, background: `var(--tint-${tint})`, color: `var(--tint-${tint}-ink)`, fontSize: Math.round(size * 0.5) }}
    >
      {vendorInitial(name)}
    </span>
  );
}

function OrgSwitcher({ summary }: { summary: Summary | null }) {
  const org = orgOf(summary);
  return (
    <Menu
      label="Organization"
      align="start"
      triggerClassName="flex h-12 w-full items-center gap-2 rounded-sm px-2 text-left transition-colors hover:bg-wash"
      panelClassName="w-[216px]"
      trigger={
        <>
          <OrgTile name={org} />
          <span className="min-w-0 flex-1 truncate text-14 font-semibold text-ink">{org}</span>
          <ChevronsUpDown aria-hidden className="size-4 flex-none text-dim" strokeWidth={1.75} />
        </>
      }
    >
      {(close) => (
        <>
          <MenuNote className="pb-1 text-12 font-medium">Organization</MenuNote>
          <MenuItem onSelect={close} hint={<Check aria-hidden className="size-4 text-ink" strokeWidth={2} />} icon={<OrgTile name={org} size={16} />}>
            {org}
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

/** ⌘K, as a full-width row under the org (Linear, Ramp): the one search trigger on wide screens. */
function SearchRow({ onSearch }: { onSearch: () => void }) {
  return (
    <button
      type="button"
      onClick={onSearch}
      aria-keyshortcuts={IS_MAC ? "Meta+K" : "Control+K"}
      className="flex h-9 w-full items-center gap-3 rounded-sm px-3 text-left text-14 text-dim transition-colors hover:bg-wash hover:text-ink"
    >
      <Search aria-hidden className="size-4 flex-none" strokeWidth={1.75} />
      <span className="flex-1">Search</span>
      <kbd className="kbd">{MOD}K</kbd>
    </button>
  );
}

function Sidebar({ page, claimsCount, summary, sources, onSearch }: Pick<ShellProps, "page" | "claimsCount" | "summary" | "sources"> & { onSearch: () => void }) {
  const health = sourcesHealth(sources);
  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-58 flex-col border-r border-line bg-paper md:flex">
      <div className="flex flex-col gap-1 px-3 pt-3 pb-4">
        <OrgSwitcher summary={summary} />
        <SearchRow onSearch={onSearch} />
      </div>
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
                    "flex h-9 items-center gap-3 rounded-sm px-3 text-14 transition-colors",
                    // The current page is green text and icon, no fill.
                    active ? "font-medium text-mint-ink" : "text-dim hover:bg-wash hover:text-ink",
                  )}
                >
                  <Icon aria-hidden className="size-4 flex-none" strokeWidth={1.75} />
                  <span className="flex-1">{item.label}</span>
                  {item.page === "claims" && claimsCount > 0 && (
                    <span className="figure text-12 text-dim">
                      {claimsCount}
                      <span className="sr-only"> to do</span>
                    </span>
                  )}
                  {item.page === "sources" && sources && (
                    <>
                      <StatusDot health={health} />
                      <span className="sr-only">{health === "ok" ? "all synced" : health === "attention" ? "needs attention" : "not synced"}</span>
                    </>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
      <a
        href="#/sources"
        className="mx-3 mt-auto mb-3 flex h-9 items-center gap-2 rounded-sm px-3 text-12 text-dim transition-colors hover:bg-wash hover:text-ink"
      >
        <StatusDot health={health} className="size-1.5" />
        <span className="min-w-0 flex-1 truncate">{sourcesLine(summary, sources)}</span>
        <span className="flex flex-none items-center gap-1.5 opacity-70" title="Recoup">
          <Mark size={14} />
        </span>
      </a>
    </aside>
  );
}

function Shortcuts() {
  return (
    <ul className="m-0 flex flex-col p-0">
      {SHORTCUTS.map((s) => (
        <li key={s.label} className="flex list-none items-center justify-between gap-6 py-1.5 text-13">
          <span>{s.label}</span>
          <span className="flex flex-none items-center gap-1">
            {s.keys.map((k) => (
              <kbd key={k} className="kbd">
                {k}
              </kbd>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The help button: a small non-modal popover listing the keyboard shortcuts. */
function Help({ isOpen, onOpenChange }: { isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    panel.current?.focus({ preventScroll: true });
    const onDown = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) onOpenChange(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [isOpen, onOpenChange]);
  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-label="Help and keyboard shortcuts"
        title="Help"
        aria-expanded={isOpen}
        onClick={() => onOpenChange(!isOpen)}
        className="grid size-8 place-items-center rounded-sm text-dim transition-colors hover:bg-wash hover:text-ink"
      >
        <CircleHelp aria-hidden className="size-4" strokeWidth={1.75} />
      </button>
      {isOpen && (
        <div
          ref={panel}
          role="dialog"
          aria-label="Keyboard shortcuts"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              onOpenChange(false);
              button.current?.focus();
            }
          }}
          className="pop absolute right-0 top-full z-40 mt-1.5 w-72 px-4 pb-3 pt-3 outline-none"
        >
          <p className="m-0 mb-1 text-13 font-semibold">Keyboard shortcuts</p>
          <Shortcuts />
        </div>
      )}
    </div>
  );
}

/** The date the data runs to, with the two controls that move it on. Only where the server allows them. */
function DateMenu({
  summary,
  isRunning,
  isAdvancing,
  isRestarting,
  isLocked,
  onRun,
  onAdvance,
  onRestart,
}: Pick<ShellProps, "summary" | "isRunning" | "isAdvancing" | "isRestarting" | "isLocked" | "onRun" | "onAdvance" | "onRestart">) {
  if (!summary?.demo_mode) return null;
  const busy = isRunning ? "Running…" : isAdvancing ? "Advancing…" : isRestarting ? "Restarting…" : null;
  return (
    <Menu
      label="Date"
      triggerTitle="Date and detection"
      triggerClassName="flex h-8 items-center gap-1.5 rounded-sm border border-line px-2.5 text-13 font-medium text-ink transition-colors hover:border-line-strong hover:bg-wash"
      trigger={
        <>
          <CalendarDays aria-hidden className="size-3.5 text-dim" strokeWidth={1.75} />
          <span aria-live="polite" className="figure">{busy ?? formatDate(summary.as_of, "short")}</span>
          <ChevronDown aria-hidden className="size-3.5 text-dim" strokeWidth={2} />
        </>
      }
    >
      {(close) => (
        <>
          <MenuNote>
            Viewing <span className="figure font-medium text-ink">{formatDate(summary.as_of)}</span>
          </MenuNote>
          <MenuSeparator />
          <MenuItem
            icon={<Play className="size-4" strokeWidth={1.75} />}
            disabled={busy !== null || isLocked}
            onSelect={() => {
              close();
              onRun();
            }}
          >
            Run detection
          </MenuItem>
          <MenuItem
            icon={<FastForward className="size-4" strokeWidth={1.75} />}
            disabled={busy !== null || isLocked}
            onSelect={() => {
              close();
              onAdvance();
            }}
          >
            Advance 2 weeks
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            icon={<RotateCcw className="size-4" strokeWidth={1.75} />}
            disabled={busy !== null}
            onSelect={() => {
              close();
              onRestart();
            }}
          >
            Restart demo
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

function UserMenu({ org, onShortcuts }: { org: string; onShortcuts: () => void }) {
  return (
    <Menu
      label="Account"
      triggerTitle={USER.name}
      triggerClassName="grid size-8 place-items-center rounded-full bg-mint-wash text-12 font-semibold text-mint-ink transition-transform active:scale-[0.96]"
      trigger={
        <>
          <span aria-hidden>{USER.initials}</span>
          <span className="sr-only">Account: {USER.name}</span>
        </>
      }
    >
      {(close) => (
        <>
          <MenuNote>
            <span className="block text-14 font-medium text-ink">{USER.name}</span>
            <span className="block">{org}</span>
          </MenuNote>
          <MenuSeparator />
          <MenuItem
            icon={<Keyboard className="size-4" strokeWidth={1.75} />}
            hint={<kbd className="kbd">?</kbd>}
            onSelect={() => {
              close();
              onShortcuts();
            }}
          >
            Keyboard shortcuts
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

type TopBarProps = ShellProps & {
  onSearch: () => void;
  onMenu: () => void;
  isHelpOpen: boolean;
  onHelp: (open: boolean) => void;
  slotRef: (el: HTMLDivElement | null) => void;
};

function TopBar(props: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 h-14 flex-none border-b border-line bg-paper">
      <div className="mx-auto flex h-full w-full max-w-[1200px] items-center gap-2 px-4 md:gap-3 md:px-8">
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={props.onMenu}
          className="-ml-2 grid size-10 flex-none place-items-center rounded-sm text-ink transition-colors hover:bg-wash md:hidden"
          aria-label="Menu"
        >
          <MenuIcon aria-hidden className="size-5" strokeWidth={1.75} />
        </button>
        {props.isBreadcrumb ? (
          <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 text-14 font-medium">
            {props.title}
          </nav>
        ) : (
          <h1 className="m-0 min-w-0 flex-1 truncate text-20 font-semibold tracking-[-0.01em]">{props.title}</h1>
        )}
        <div ref={props.slotRef} className="flex flex-none items-center gap-2 empty:hidden" />
        {/* Wide screens search from the sidebar's row; phones keep this icon. */}
        <button
          type="button"
          onClick={props.onSearch}
          aria-label="Search"
          className="-mr-2 grid size-10 flex-none place-items-center rounded-sm text-ink transition-colors hover:bg-wash md:hidden"
        >
          <Search aria-hidden className="size-5" strokeWidth={1.75} />
        </button>
        <div className="hidden items-center gap-1 md:flex">
          <DateMenu {...props} />
          <Help isOpen={props.isHelpOpen} onOpenChange={props.onHelp} />
          <UserMenu org={orgOf(props.summary)} onShortcuts={() => props.onHelp(true)} />
        </div>
      </div>
    </header>
  );
}

type PhoneMenuProps = Pick<ShellProps, "summary" | "sources" | "isRunning" | "isAdvancing" | "isRestarting" | "isLocked" | "onRun" | "onAdvance" | "onRestart"> & {
  onClose: () => void;
};

/** The phone menu: the org, the demo controls, and where the sources stand. */
function PhoneMenu({ summary, sources, isRunning, isAdvancing, isRestarting, isLocked, onRun, onAdvance, onRestart, onClose }: PhoneMenuProps) {
  const demo = Boolean(summary?.demo_mode);
  const live = summary?.data_mode === "live";
  return (
    <Sheet labelId="menu-title" title={orgOf(summary)} subtitle={summary?.data_mode === "live" ? "Live data" : undefined} onClose={onClose}>
      <div className="flex flex-col gap-5 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2">
        {demo && summary && (
          <div className="flex flex-col gap-2">
            <p className="m-0 text-13 text-dim">
              Viewing <span className="figure text-ink">{formatDate(summary.as_of)}</span>
            </p>
            <Button
              variant="secondary"
              className="justify-start"
              isBusy={isRunning}
              disabled={isLocked}
              busyLabel="Running…"
              onClick={() => {
                onClose();
                onRun();
              }}
            >
              <Play aria-hidden className="size-4 text-dim" strokeWidth={1.75} />
              Run detection
            </Button>
            <Button
              variant="secondary"
              className="justify-start"
              isBusy={isAdvancing}
              disabled={isLocked}
              busyLabel="Advancing…"
              onClick={() => {
                onClose();
                onAdvance();
              }}
            >
              <FastForward aria-hidden className="size-4 text-dim" strokeWidth={1.75} />
              Advance 2 weeks
            </Button>
            <Button
              variant="secondary"
              className="justify-start"
              isBusy={isRestarting}
              busyLabel="Restarting…"
              onClick={() => {
                onClose();
                onRestart();
              }}
            >
              <RotateCcw aria-hidden className="size-4 text-dim" strokeWidth={1.75} />
              Restart demo
            </Button>
          </div>
        )}
        <a href="#/sources" onClick={onClose} className="-mx-2 flex h-10 items-center gap-2 rounded-sm px-2 text-13 text-dim transition-colors hover:bg-wash hover:text-ink">
          <StatusDot health={sourcesHealth(sources)} />
          <span className="truncate">{sourcesLine(summary, sources)}</span>
          {live && sources && <span className="ml-auto flex-none">{`${configured(sources).length} of ${sources.connectors.length} connected`}</span>}
        </a>
      </div>
    </Sheet>
  );
}

function TabBar({ page, claimsCount }: Pick<ShellProps, "page" | "claimsCount">) {
  return (
    <nav aria-label="Pages" className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-paper pb-[env(safe-area-inset-bottom)] md:hidden">
      <ul className="m-0 grid grid-cols-5 p-0">
        {NAV.map((item) => {
          const active = item.page === page;
          const Icon = item.icon;
          return (
            <li key={item.page} className="list-none">
              <a
                href={`#/${item.page}`}
                aria-current={active ? "page" : undefined}
                className={cn("relative flex h-14 flex-col items-center justify-center gap-1 text-12 font-medium", active ? "text-mint-ink" : "text-dim")}
              >
                {active && <span aria-hidden className="absolute inset-x-6 top-0 h-0.5 bg-mint-ink" />}
                <span className="relative">
                  <Icon aria-hidden className="size-5" strokeWidth={1.75} />
                  {item.page === "claims" && claimsCount > 0 && (
                    <span className="figure absolute -top-1.5 left-full -ml-1 grid h-4 min-w-4 place-items-center rounded-full bg-mint px-1 text-12 font-semibold leading-none text-ink">
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

/** White sidebar and top bar on wide screens; the top bar, a menu sheet and a bottom tab bar on phones. */
export function Shell(props: ShellProps) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const { summary, onRun, onAdvance, onAdvanceQuiet, onRestart, onExport, onGo } = props;
  const isIdle = !props.isRunning && !props.isAdvancing && !props.isRestarting && !props.isLocked;
  const canAdvance = Boolean(summary?.demo_mode) && isIdle;

  // ⌘K / Ctrl+K opens the palette from anywhere; ? shows the shortcuts when you're not typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const modalOpen = () => document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
      if (isAdvanceKey(event)) {
        event.preventDefault();
        // Not over a sheet or a pop-up, not twice for one press, and not while something else is running.
        if (!event.repeat && canAdvance && !modalOpen()) onAdvanceQuiet();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        // Not over a sheet: it owns the keyboard while it is open.
        if (!isPaletteOpen && modalOpen()) return;
        event.preventDefault();
        setIsHelpOpen(false);
        setIsPaletteOpen((open) => !open);
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && (TYPING.has(target.tagName) || target.isContentEditable)) return;
      if (event.key === "?" && !event.metaKey && !event.ctrlKey && !event.altKey && !event.defaultPrevented && !modalOpen()) {
        event.preventDefault();
        setIsHelpOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isPaletteOpen, canAdvance, onAdvanceQuiet]);

  const commands = useMemo<Command[]>(() => {
    const icon = (Icon: LucideIcon) => <Icon className="size-4" strokeWidth={1.75} />;
    const list: Command[] = NAV.map((item) => ({
      id: `page-${item.page}`,
      group: "Pages",
      label: item.label,
      icon: icon(item.icon),
      keywords: item.page === "sources" ? "sync ramp gmail connect" : undefined,
      run: () => onGo(item.page),
    }));
    // The same lock as the date menu: never while the agent is mid-action or another of these is running.
    const whenIdle = (run: () => void) => () => {
      if (isIdle) run();
    };
    list.push({ id: "run", group: "Actions", label: "Run detection", icon: icon(Play), keywords: "detect scan find", run: whenIdle(onRun) });
    if (summary?.demo_mode) {
      list.push({ id: "advance", group: "Actions", label: "Advance 2 weeks", icon: icon(FastForward), keywords: "demo time clock", run: whenIdle(onAdvance) });
      list.push({ id: "restart", group: "Actions", label: "Restart demo", icon: icon(RotateCcw), keywords: "reset start over clean", run: onRestart });
    }
    list.push({ id: "export", group: "Actions", label: "Export open claims", icon: icon(Download), keywords: "csv download spreadsheet", run: onExport });
    list.push({ id: "shortcuts", group: "Actions", label: "Keyboard shortcuts", icon: icon(Keyboard), keywords: "help keys", run: () => setIsHelpOpen(true) });
    return list;
  }, [summary?.demo_mode, isIdle, onRun, onAdvance, onRestart, onExport, onGo]);

  return (
    <TopBarSlot.Provider value={slot}>
      <div className="min-h-dvh bg-paper text-ink">
        <Sidebar page={props.page} claimsCount={props.claimsCount} summary={summary} sources={props.sources} onSearch={() => setIsPaletteOpen(true)} />
        <div className="flex min-h-dvh min-w-0 flex-col md:pl-58">
          <TopBar
            {...props}
            slotRef={setSlot}
            onSearch={() => setIsPaletteOpen(true)}
            onMenu={() => setIsMenuOpen(true)}
            isHelpOpen={isHelpOpen}
            onHelp={setIsHelpOpen}
          />
          <main
            className={cn(
              "mx-auto flex w-full max-w-[1200px] min-w-0 flex-1 flex-col gap-6 px-4 pb-28 md:px-8 md:pb-16",
              // Overview opens with a hero and gets room above it; lists start close to the top bar, as in Stripe.
              props.page === "overview" ? "pt-6 md:pt-10" : props.isBreadcrumb ? "pt-6 md:pt-8" : props.page === "claims" ? "pt-3" : "pt-6",
            )}
          >
            {props.children}
          </main>
        </div>
        <TabBar page={props.page} claimsCount={props.claimsCount} />
      </div>
      <AnimatePresence>
        {isPaletteOpen && (
          <CommandPalette key="palette" findings={props.findings} commands={commands} onOpenCase={props.onOpenCase} onClose={() => setIsPaletteOpen(false)} />
        )}
        {isMenuOpen && <PhoneMenu key="menu" {...props} onClose={() => setIsMenuOpen(false)} />}
      </AnimatePresence>
    </TopBarSlot.Provider>
  );
}
