import { AnimatePresence, motion } from "motion/react";
import type { Outcome, Status } from "../api";
import { SPRING } from "../motion";
import { cn } from "@/lib/utils";
import { OUTCOME_LABEL, STATUS_LABEL } from "../theme";

type Tone = "neutral" | "money" | "amber";

// Money-back colour only for recovered money and "Recoverable"; amber only for "Needs review".
const TONE_BG: Record<Tone, string> = {
  neutral: "bg-tint shadow-[inset_0_0_0_1px_var(--line)]",
  money: "bg-money/12",
  amber: "bg-amber/12",
};
const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-dim",
  money: "text-money-ink",
  amber: "text-amber",
};

const OUTCOME_TONE: Record<Outcome, Tone> = {
  recoverable: "money",
  needs_review: "amber",
  not_recoverable: "neutral",
};

function Pill({ label, tone, id }: { label: string; tone: Tone; id: string }) {
  // The pill keeps its place and resizes with a spring; the label and the tint cross-fade.
  return (
    <motion.span
      layout
      transition={SPRING}
      className="relative inline-flex h-6 flex-none items-center overflow-hidden whitespace-nowrap rounded-full px-2.5 text-xs font-medium"
    >
      <AnimatePresence initial={false}>
        <motion.span
          key={tone}
          aria-hidden
          className={cn("absolute inset-0 rounded-full", TONE_BG[tone])}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={SPRING}
        />
      </AnimatePresence>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={id}
          className={cn("relative", TONE_TEXT[tone])}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={SPRING}
        >
          {label}
        </motion.span>
      </AnimatePresence>
    </motion.span>
  );
}

export function OutcomeChip({ outcome }: { outcome: Outcome }) {
  return <Pill id={outcome} label={OUTCOME_LABEL[outcome]} tone={OUTCOME_TONE[outcome]} />;
}

export function StatusChip({ status }: { status: Status }) {
  return <Pill id={status} label={STATUS_LABEL[status]} tone={status === "recovered" ? "money" : "neutral"} />;
}

const URGENT_DAYS = 14;

export function isUrgent(daysLeft: number | null): boolean {
  return daysLeft !== null && daysLeft >= 0 && daysLeft <= URGENT_DAYS;
}

// Deadlines are words, not colour: urgent ones are set in ink, the rest dim.
export function Deadline({ label, daysLeft }: { label: string; daysLeft: number | null }) {
  return (
    <span className={cn("whitespace-nowrap text-xs tabular-nums", isUrgent(daysLeft) ? "font-medium text-ink" : "text-dim")}>
      {label}
    </span>
  );
}

// Temporary bridge for components not yet moved to the new case view.
export function DeadlinePill({ label, isUrgent: urgent }: { label: string; isUrgent: boolean }) {
  return <Deadline label={label} daysLeft={urgent ? 0 : 99} />;
}
