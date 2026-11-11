import { motion, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useEffect } from "react";
import { formatMoney, splitMoney } from "../format";
import { cn } from "@/lib/utils";

interface Props {
  minor: number;
  currency?: string;
  className?: string;
  /** Roll to a new value on a spring (a jump under reduced motion). */
  roll?: boolean;
}

/**
 * A hero money figure: "$13,710" with ".09" at a little over half size, in --dim, so the eye reads the
 * dollars first. Tabular, so the figure keeps its width as it changes.
 */
export function Money({ minor, currency = "USD", className, roll = false }: Props) {
  const label = formatMoney(minor, currency);
  if (roll) return <RollingParts minor={minor} currency={currency} className={className} label={label} />;
  const { whole, cents } = splitMoney(minor, currency);
  return (
    <span className={cn("figure whitespace-nowrap", className)}>
      <span className="sr-only">{label}</span>
      <span aria-hidden>
        {whole}
        {cents && <span className="cents">{cents}</span>}
      </span>
    </span>
  );
}

function RollingParts({ minor, currency, className, label }: { minor: number; currency: string; className?: string; label: string }) {
  const reduce = useReducedMotion();
  const value = useSpring(minor, { bounce: 0, duration: 0.9 });
  const whole = useTransform(value, (v) => splitMoney(Math.round(v), currency).whole);
  const cents = useTransform(value, (v) => splitMoney(Math.round(v), currency).cents);
  useEffect(() => {
    if (reduce) value.jump(minor);
    else value.set(minor);
  }, [minor, reduce, value]);
  return (
    <span className={cn("figure whitespace-nowrap", className)}>
      <span className="sr-only">{label}</span>
      <span aria-hidden>
        <motion.span>{whole}</motion.span>
        <motion.span className="cents">{cents}</motion.span>
      </span>
    </span>
  );
}
