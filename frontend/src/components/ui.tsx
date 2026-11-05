import { motion, useReducedMotion, useSpring, useTransform } from "motion/react";
import { type ReactNode, useEffect } from "react";
import { daysWord, formatMoney, formatShortDate } from "../format";
import { isUrgent, type Tone } from "../theme";
import { cn } from "@/lib/utils";

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

/** A titled module on paper: Stripe's overview building block. */
export function Module({
  title,
  aside,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section aria-label={title} className={cn("card flex min-w-0 flex-col", className)}>
      <header className="flex min-h-12 items-center justify-between gap-4 border-b border-line px-5">
        <h2 className="m-0 text-14 font-semibold tracking-[-0.01em]">{title}</h2>
        {aside && <div className="flex-none text-13 text-dim">{aside}</div>}
      </header>
      <div className={cn("flex flex-col px-5 py-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="field-box flex flex-col items-start gap-3 px-4 py-4 text-14 text-dim">
      <p className="m-0">{children}</p>
      {action}
    </div>
  );
}

/** Page header: mono breadcrumb, title, right-aligned page actions. */
export function PageHeader({ crumbs, title, actions, meta }: { crumbs: ReactNode; title: ReactNode; actions?: ReactNode; meta?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div className="flex min-w-0 flex-col gap-2">
        <nav aria-label="Breadcrumb" className="label flex min-w-0 items-center gap-2 text-dim">
          {crumbs}
        </nav>
        <h1 className="m-0 truncate text-28 font-semibold tracking-[-0.03em]">{title}</h1>
        {meta}
      </div>
      {/* Lined up with the title, not the bottom of the meta line under it. */}
      {actions && <div className="flex flex-none flex-wrap items-center gap-2 md:mt-5">{actions}</div>}
    </header>
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
