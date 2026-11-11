import { motion } from "motion/react";
import { type ReactNode, type RefObject, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { Tone } from "../theme";
import { cn } from "@/lib/utils";
import { TopBarActions } from "./shell/TopBarActions";

const PILL: Record<Tone, string> = {
  mint: "bg-mint-wash text-mint-ink",
  amber: "bg-amber-wash text-amber-ink",
  neutral: "bg-ground text-ink",
  muted: "bg-wash text-dim",
};
const DOT: Record<Tone, string> = {
  mint: "bg-mint-ink",
  amber: "bg-amber",
  neutral: "bg-dim",
  muted: "bg-line-strong",
};

/** A status pill: dot and label on the fixed four-tone scale. */
export function Pill({ label, tone, className }: { label: string; tone: Tone; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 flex-none items-center gap-1.5 whitespace-nowrap rounded-xs px-2 text-12 font-medium", PILL[tone], className)}>
      <span aria-hidden className={cn("size-1.5 rounded-full", DOT[tone])} />
      {label}
    </span>
  );
}

const TAG: Record<Tone, string> = {
  mint: "bg-mint-wash text-mint-ink",
  amber: "bg-amber-wash text-amber-ink",
  neutral: "bg-ground text-dim",
  muted: "bg-wash text-dim",
};

/** A small inline tag with no dot: a case's type, or "Needs review" beside a vendor name. */
export function Tag({ children, tone = "neutral", className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 flex-none items-center whitespace-nowrap rounded-xs px-1.5 text-12 font-medium", TAG[tone], className)}>
      {children}
    </span>
  );
}

/**
 * What is left of the v1 page header: the title lives in the top bar, so this moves a page's actions
 * there and keeps its meta line in place.
 */
export function PageHeader({ actions, meta }: { actions?: ReactNode; meta?: ReactNode }) {
  return (
    <>
      {actions && (
        <TopBarActions>
          <div className="flex items-center gap-2">{actions}</div>
        </TopBarActions>
      )}
      {meta}
    </>
  );
}

/**
 * A segmented switch: equal buttons in one bordered row, the pressed one filled, each with an optional
 * count after its label. Segments are 40px tall on phones and 28px beside a pointer.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn("flex gap-0.5 rounded-sm border border-line p-0.5", className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-10 min-w-0 flex-1 truncate rounded-xs px-2 text-13 transition-colors duration-150 ease-out md:h-7",
            value === option.value ? "bg-ground font-medium text-ink" : "text-dim hover:bg-wash hover:text-ink",
          )}
        >
          {option.label}
          {option.count !== undefined && <span className="figure pl-1.5 font-normal text-dim">{option.count}</span>}
        </button>
      ))}
    </div>
  );
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select,[tabindex]:not([tabindex="-1"])';
const DIALOG_MOTION = { duration: 0.18, ease: "easeOut" } as const;

/**
 * A small centred dialog for one question ("Connect your Gmail"): it dims what is behind it, takes
 * focus, keeps Tab inside, closes on Escape or a click outside, and gives focus back when it closes.
 * A Sheet is for longer content and rises from the bottom edge on phones; this stays centred.
 * Render it inside <AnimatePresence> so it can fade out.
 */
export function Dialog({
  labelId,
  title,
  children,
  onClose,
  isLocked = false,
  initialFocus,
  returnFocus,
  className,
}: {
  labelId: string;
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
  /** While its action is running the dialog can't be dismissed. */
  isLocked?: boolean;
  /** What to focus first; defaults to the dialog itself. */
  initialFocus?: RefObject<HTMLElement>;
  /** Where focus goes on close, when the opener is gone or something else should have it. */
  returnFocus?: () => HTMLElement | null;
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const latest = useRef({ onClose, isLocked, returnFocus });
  latest.current = { onClose, isLocked, returnFocus };

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    (initialFocus?.current ?? panel.current)?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!latest.current.isLocked) latest.current.onClose();
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
      const inside = panel.current.contains(document.activeElement);
      if (event.shiftKey && (!inside || document.activeElement === first || document.activeElement === panel.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || document.activeElement === last)) {
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
      const target = latest.current.returnFocus?.() ?? opener;
      (target && target.isConnected ? target : opener)?.focus?.({ preventScroll: true });
    };
  }, [initialFocus]);

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <motion.div
        aria-hidden
        className="absolute inset-0 bg-scrim"
        onClick={() => !isLocked && onClose()}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={DIALOG_MOTION}
      />
      <motion.div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        tabIndex={-1}
        className={cn("float relative flex max-h-full w-full max-w-100 flex-col gap-4 overflow-y-auto rounded-md border border-line bg-paper p-6 text-ink outline-none", className)}
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={DIALOG_MOTION}
      >
        <h2 id={labelId} className="m-0 text-16 font-semibold tracking-[-0.01em]">
          {title}
        </h2>
        {children}
      </motion.div>
    </div>,
    document.body,
  );
}
