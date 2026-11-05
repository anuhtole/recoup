import { motion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SHEET_SPRING } from "../motion";
import { cn } from "@/lib/utils";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select,[tabindex]:not([tabindex="-1"])';

interface Props {
  title: ReactNode;
  /** Short line under the title. */
  subtitle?: ReactNode;
  labelId: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** Element to focus first; defaults to the sheet itself. */
  initialFocus?: React.RefObject<HTMLElement>;
  /** "ink" for the phone menu: a dark panel like the sidebar it stands in for. */
  tone?: "paper" | "ink";
}

/**
 * A modal sheet. It rises from the bottom edge and leaves the same way, dims what is behind it,
 * traps focus, closes on Escape, and gives focus back to whatever opened it.
 * Render it inside <AnimatePresence> so it can leave along its entry path.
 */
export function Sheet({ title, subtitle, labelId, onClose, children, className, initialFocus, tone = "paper" }: Props) {
  const ink = tone === "ink";
  const panel = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    (initialFocus?.current ?? panel.current)?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      opener?.focus?.({ preventScroll: true });
    };
  }, [initialFocus]);

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center sm:p-6">
      <motion.div
        aria-hidden
        className="absolute inset-0 bg-scrim"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={SHEET_SPRING}
      />
      <motion.div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        tabIndex={-1}
        className={cn(
          "float relative flex max-h-[min(90dvh,780px)] w-full flex-col overflow-hidden rounded-t-md outline-none sm:max-w-[540px] sm:rounded-md",
          ink ? "on-ink border border-rule bg-panel text-white" : "border border-line bg-paper text-ink",
          className,
        )}
        initial={{ opacity: 0, y: 48 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 48 }}
        transition={SHEET_SPRING}
      >
        <div className="flex items-start justify-between gap-4 px-6 pb-2 pt-6">
          <div className="min-w-0">
            <h2 id={labelId} className="m-0 text-20 font-semibold tracking-[-0.02em]">
              {title}
            </h2>
            {subtitle && <p className={cn("m-0 mt-1 text-14", ink ? "text-sub" : "text-dim")}>{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={cn(
              "-mr-2 -mt-1 grid size-9 flex-none place-items-center rounded-sm transition-[transform,background-color,color] duration-150 active:scale-[0.94]",
              ink ? "text-sub hover:bg-panel-2 hover:text-white" : "text-dim hover:bg-wash hover:text-ink",
            )}
          >
            <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
        {children}
      </motion.div>
    </div>,
    document.body,
  );
}
