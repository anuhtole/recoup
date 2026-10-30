import type { Summary } from "../api";
import { formatDate } from "../format";
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
    <span aria-hidden className="glass grid size-9 flex-none place-items-center rounded-[11px]">
      <svg viewBox="0 0 24 24" className="size-[18px] text-ink" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 12a8 8 0 1 1-2.34-5.66" />
        <path d="M20 4v4h-4" />
        <path d="M12 8.5v7M10 10.25c0-.97.9-1.75 2-1.75s2 .78 2 1.75-.9 1.5-2 1.75-2 .78-2 1.75.9 1.75 2 1.75 2-.78 2-1.75" strokeWidth="1.4" />
      </svg>
    </span>
  );
}

export function TopBar({ summary, isRunning, isAdvancing, onRun, onAdvance }: Props) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
      <div className="flex min-w-0 items-center gap-3">
        <Mark />
        <div className="min-w-0">
          <h1 className="text-xl font-semibold leading-tight tracking-[-0.02em]">Recoup</h1>
          {summary && (
            <p className="text-[13px] leading-tight text-dim">
              Money vendors owe you · as of <span className="figure">{formatDate(summary.as_of)}</span>
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onRun} isBusy={isRunning} title="Read the ledger and inbox again for anything new">
          Run detection
        </Button>
        {summary?.demo_mode && (
          <Button
            size="sm"
            onClick={onAdvance}
            isBusy={isAdvancing}
            title="Demo only: move the clock two weeks and play the vendors' side"
          >
            Advance 2 weeks
          </Button>
        )}
      </div>
    </header>
  );
}
