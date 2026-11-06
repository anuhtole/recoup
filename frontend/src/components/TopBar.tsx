import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { Sources, Summary } from "../api";
import { formatDate } from "../format";
import { SPRING } from "../motion";
import type { Page } from "../hooks/useHashRoute";
import { cn } from "@/lib/utils";
import { Button } from "./Button";
import { SourcesButton, sourcesLabel } from "./Sources";

interface Props {
  page: Page;
  summary: Summary | null;
  sources: Sources | null;
  onOpenSources: () => void;
  isRunning: boolean;
  isAdvancing: boolean;
  onRun: () => void;
  onAdvance: () => void;
}


/** On phones the two demo controls fold into one quiet "More" menu. */
function MoreMenu({ actions }: { actions: { label: string; onSelect: () => void; isBusy: boolean }[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setIsOpen(false);
    const onClick = (event: MouseEvent) => !root.current?.contains(event.target as Node) && setIsOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [isOpen]);
  return (
    <div ref={root} className="relative sm:hidden">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className="inline-flex h-9 items-center rounded-full px-3 text-14 font-medium text-dim transition-[transform,background-color,color] duration-150 hover:bg-tint hover:text-ink active:scale-[0.97]"
      >
        More
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            role="menu"
            className="glass-float absolute right-0 top-11 z-30 flex w-52 flex-col rounded-card p-2"
            style={{ transformOrigin: "100% 0%" }}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={SPRING}
          >
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                role="menuitem"
                disabled={action.isBusy}
                onClick={() => {
                  setIsOpen(false);
                  action.onSelect();
                }}
                className="h-11 rounded-row px-3 text-left text-14 text-ink transition-colors hover:bg-tint disabled:opacity-50"
              >
                {action.isBusy ? "Working…" : action.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Two pages, as a quiet pill: the same look as the queue's tabs. */
function PageSwitch({ page }: { page: Page }) {
  const items: { page: Page; label: string; href: string }[] = [
    { page: "overview", label: "Overview", href: "#/overview" },
    { page: "claims", label: "Claims", href: "#/claims" },
    { page: "setup", label: "Setup", href: "#/setup" },
  ];
  return (
    <nav aria-label="Pages" className="order-last w-full sm:order-none sm:w-auto">
      <ul className="m-0 inline-flex rounded-full bg-tint p-1">
        {items.map((item) => (
          <li key={item.page} className="list-none">
            <a
              href={item.href}
              aria-current={item.page === page ? "page" : undefined}
              className={cn(
                "inline-flex h-9 items-center rounded-full px-4 text-14 font-medium transition-[transform,background-color,color] duration-150 active:scale-[0.97]",
                item.page === page ? "bg-accent-fill text-on-accent" : "text-dim hover:text-ink",
              )}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function TopBar({ page, summary, sources, onOpenSources, isRunning, isAdvancing, onRun, onAdvance }: Props) {
  const actions = [
    { label: "Run detection", onSelect: onRun, isBusy: isRunning, title: "Read the ledger and inbox again for anything new" },
    ...(summary?.demo_mode
      ? [{ label: "Advance 2 weeks", onSelect: onAdvance, isBusy: isAdvancing, title: "Demo only: move the clock two weeks and play the vendors' side" }]
      : []),
  ];
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3 sm:flex-1">
        <div className="flex min-w-0 flex-col gap-1">
          <img src="/brand/recoup-wordmark.png" alt="Recoup" width={994} height={265} className="h-7 w-auto self-start" />
          {summary && (
            <p className="flex min-w-0 items-center gap-2 text-12 text-dim sm:text-14">
              <span className="whitespace-nowrap">
                As of <span className="figure">{formatDate(summary.as_of)}</span>
              </span>
              {summary.data_mode && (
                <span className="flex-none rounded-full bg-tint px-2 py-1 text-12 text-dim">
                  {summary.data_mode === "live" ? "Live data" : "Demo data"}
                </span>
              )}
            </p>
          )}
        </div>
      </div>
      <PageSwitch page={page} />
      <div className="hidden items-center justify-end gap-1 sm:flex sm:flex-1">
        <SourcesButton sources={sources} isDemo={summary?.data_mode === "demo"} onOpen={onOpenSources} />
        {actions.map((action) => (
          <Button key={action.label} variant="ghost" size="sm" onClick={action.onSelect} isBusy={action.isBusy} title={action.title}>
            {action.label}
          </Button>
        ))}
      </div>
      <MoreMenu actions={[{ label: sourcesLabel(sources, summary?.data_mode === "demo"), onSelect: onOpenSources, isBusy: false }, ...actions]} />
    </header>
  );
}
