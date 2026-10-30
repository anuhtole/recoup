import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { SPRING } from "../motion";
import { cn } from "@/lib/utils";

export interface Notice {
  id: number;
  title: string;
  body?: string;
  /** "money" marks a credit confirmed in the ledger; it is the only notice that uses the money colour. */
  tone: "info" | "money" | "error";
  /** Advance results (replies, credits, new cases) stack; everything else is a routine notice, one at a time. */
  isResult?: boolean;
}

const RESULT_MS = 6_000;
const ROUTINE_MS = 3_000;
const MAX_RESULTS = 3;

function Card({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    // Errors stay until dismissed; everything else leaves by itself.
    if (notice.tone === "error") return;
    const timer = window.setTimeout(() => dismiss.current(), notice.isResult ? RESULT_MS : ROUTINE_MS);
    return () => window.clearTimeout(timer);
  }, [notice.tone, notice.isResult]);

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, scale: 0.98 }}
      transition={SPRING}
      role={notice.tone === "error" ? "alert" : undefined}
      className="glass-float pointer-events-auto flex list-none items-start gap-3 rounded-card py-3 pl-4 pr-2"
    >
      {notice.tone === "money" && <span aria-hidden className="mt-1.5 size-2 flex-none rounded-full bg-money" />}
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-medium", notice.tone === "money" && "text-money-ink")}>{notice.title}</p>
        {notice.body && <p className="mt-0.5 text-[13px] leading-snug text-dim">{notice.body}</p>}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="grid size-8 flex-none place-items-center rounded-full text-dim transition-[transform,background-color,color] duration-150 hover:bg-tint hover:text-ink active:scale-90"
      >
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </motion.li>
  );
}

/** Notifications stack in the corner; each one is its own card and leaves on its own. */
export function Notifications({ notices, onDismiss }: { notices: Notice[]; onDismiss: (id: number) => void }) {
  const results = notices.filter((n) => n.isResult).slice(-MAX_RESULTS);
  const visible = [...results, ...notices.filter((n) => !n.isResult)];
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-30 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[360px]">
      <ol className="m-0 flex flex-col gap-2 p-0">
        <AnimatePresence initial={false}>
          {visible.map((notice) => (
            <Card key={notice.id} notice={notice} onDismiss={() => onDismiss(notice.id)} />
          ))}
        </AnimatePresence>
      </ol>
    </div>
  );
}
