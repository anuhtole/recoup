import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { Summary } from "../api";
import { formatDate } from "../format";
import { SPRING } from "../motion";
import { Button } from "./Button";

interface Props {
  summary: Summary | null;
  isRunning: boolean;
  isAdvancing: boolean;
  onRun: () => void;
  onAdvance: () => void;
}

// The mark: a coin with an arrow coming back to it.
function Mark() {
  return (
    <span aria-hidden className="grid size-9 flex-none place-items-center rounded-row bg-tint">
      <svg viewBox="0 0 24 24" className="size-5 text-ink" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 12a8 8 0 1 1-2.34-5.66" />
        <path d="M20 4v4h-4" />
        <path d="M12 8.5v7M10 10.25c0-.97.9-1.75 2-1.75s2 .78 2 1.75-.9 1.5-2 1.75-2 .78-2 1.75.9 1.75 2 1.75 2-.78 2-1.75" strokeWidth="1.4" />
      </svg>
    </span>
  );
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

export function TopBar({ summary, isRunning, isAdvancing, onRun, onAdvance }: Props) {
  const actions = [
    { label: "Run detection", onSelect: onRun, isBusy: isRunning, title: "Read the ledger and inbox again for anything new" },
    ...(summary?.demo_mode
      ? [{ label: "Advance 2 weeks", onSelect: onAdvance, isBusy: isAdvancing, title: "Demo only: move the clock two weeks and play the vendors' side" }]
      : []),
  ];
  return (
    <header className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <Mark />
        <div className="min-w-0">
          <h1 className="text-20 font-semibold tracking-[-0.02em]">Recoup</h1>
          {summary && (
            <p className="truncate text-12 text-dim sm:text-14">
              <span className="hidden sm:inline">Money vendors owe you · </span>As of <span className="figure">{formatDate(summary.as_of)}</span>
            </p>
          )}
        </div>
      </div>
      <div className="hidden items-center gap-1 sm:flex">
        {actions.map((action) => (
          <Button key={action.label} variant="ghost" size="sm" onClick={action.onSelect} isBusy={action.isBusy} title={action.title}>
            {action.label}
          </Button>
        ))}
      </div>
      <MoreMenu actions={actions} />
    </header>
  );
}
