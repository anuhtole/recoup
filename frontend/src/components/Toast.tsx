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
  /** Advance results (replies, credits, new claims) stack; everything else is a routine notice, one at a time. */
  isResult?: boolean;
  /** A summary card's items, one per line. */
  lines?: string[];
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
      className="on-ink float pointer-events-auto flex list-none items-start gap-3 rounded-md border border-rule bg-panel py-3 pl-4 pr-2 text-white"
    >
      <span
        aria-hidden
        className={cn(
          "mt-[7px] size-2 flex-none rounded-full",
          notice.tone === "money" ? "bg-mint" : notice.tone === "error" ? "bg-amber" : "bg-sub",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className={cn("m-0 text-14 font-medium", notice.tone === "money" && "text-mint")}>{notice.title}</p>
        {notice.body && <p className="m-0 mt-1 text-13 text-sub">{notice.body}</p>}
        {notice.lines && (
          <ul className="m-0 mt-1.5 flex flex-col gap-0.5 p-0">
            {notice.lines.map((line) => (
              <li key={line} className="list-none text-13 text-sub">
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="grid size-8 flex-none place-items-center rounded-sm text-sub transition-[transform,background-color,color] duration-150 hover:bg-panel-2 hover:text-white active:scale-90"
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
    <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-20 z-30 md:inset-x-auto md:bottom-6 md:right-6 md:w-[380px]">
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
