import { motion, useReducedMotion, useSpring, useTransform } from "motion/react";
import { type ReactNode, useEffect } from "react";
import { daysWord, formatMoney, formatShortDate } from "../format";
import { isUrgent, type Tone } from "../theme";
import { cn } from "@/lib/utils";
import { TopBarActions } from "./shell/TopBarActions";

/** Spade's mono record label. */
export function Label({ children, className, as: As = "p" }: { children: ReactNode; className?: string; as?: "p" | "span" | "dt" | "h2" | "h3" }) {
  return <As className={cn("label m-0 text-dim", className)}>{children}</As>;
}

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

/** A status pill: dot + mono label on the fixed four-tone scale. */
// On an ink row a filled pill glares; it becomes an outline in the same hue.
const PILL_ON_INK: Record<Tone, string> = {
  mint: "border border-mint/60 text-mint",
  amber: "border border-amber/70 text-amber",
  neutral: "border border-rule text-white",
  muted: "border border-rule text-sub",
};

export function Pill({ label, tone, className, onInk }: { label: string; tone: Tone; className?: string; onInk?: boolean }) {
  return (
    <span
      className={cn(
        "label inline-flex h-6 flex-none items-center gap-2 whitespace-nowrap rounded-xs px-2",
        onInk ? PILL_ON_INK[tone] : PILL[tone],
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", onInk && tone === "amber" ? "bg-amber" : DOT[tone])} />
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

/** A days-left tag: mono, amber when three days or fewer. */
export function DaysTag({ days, className }: { days: number | null; className?: string }) {
  if (days === null) return null;
  const closed = days < 0;
  return (
    <span
      className={cn(
        "label inline-flex h-6 flex-none items-center whitespace-nowrap rounded-xs px-2",
        closed ? "text-dim" : isUrgent(days) ? "bg-amber-wash text-amber-ink" : "bg-ground text-dim",
        className,
      )}
    >
      {closed ? "Closed" : daysWord(days)}
    </span>
  );
}

/** Mono short date, "OCT 2". */
export function MonoDate({ iso, className }: { iso: string; className?: string }) {
  return <span className={cn("ref uppercase", className)}>{formatShortDate(iso)}</span>;
}

/**
 * What is left of the v1 page header: the title and breadcrumb now live in the top bar, so this keeps a
 * page's meta line in place and moves its actions into the top bar. `crumbs` and `title` are ignored.
 */
export function PageHeader({ actions, meta }: { crumbs?: ReactNode; title?: ReactNode; actions?: ReactNode; meta?: ReactNode }) {
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

/** A money figure that rolls to its new value on a spring (a jump under reduced motion). */
export function RollingMoney({ minor, currency, className }: { minor: number; currency: string; className?: string }) {
  const reduce = useReducedMotion();
  const value = useSpring(minor, { bounce: 0, duration: 0.9 });
  const text = useTransform(value, (v) => formatMoney(Math.round(v), currency));
  useEffect(() => {
    if (reduce) value.jump(minor);
    else value.set(minor);
  }, [minor, reduce, value]);
  return (
    <motion.span className={cn("figure", className)} aria-label={formatMoney(minor, currency)}>
      {text}
    </motion.span>
  );
}

/** The vendor's initial on a small tile, so rows scan by shape. */
export function VendorTile({ name, className }: { name: string; className?: string }) {
  const letter = name.replace(/^[^A-Za-z0-9]+/, "").charAt(0).toUpperCase() || "?";
  return (
    <span
      aria-hidden
      className={cn("grid size-8 flex-none place-items-center rounded-sm bg-ground text-13 font-semibold text-ink", className)}
    >
      {letter}
    </span>
  );
}
