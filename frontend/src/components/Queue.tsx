import { motion } from "motion/react";
import { useEffect, useRef } from "react";
import type { Finding, Stage } from "../api";
import { daysLeftLabel, formatMoney } from "../format";
import { SPRING } from "../motion";
import { LEAK_LABEL } from "../theme";
import { Deadline, StatusChip } from "./Chip";
import SmoothTab from "./kokonutui/smooth-tab";
import { cn } from "@/lib/utils";

export { isUrgent } from "./Chip";

const TABS: { stage: Stage; label: string }[] = [
  { stage: "todo", label: "To do" },
  { stage: "waiting", label: "Waiting" },
  { stage: "done", label: "Done" },
];

const EMPTY: Record<Stage, string> = {
  todo: "Nothing needs you right now. New cases show up here after you press Run detection.",
  waiting: "Requests you send wait here until the vendor replies or the money lands.",
  done: "Recovered and closed cases collect here.",
};

interface Props {
  findings: Finding[];
  stage: Stage;
  counts: Record<Stage, number>;
  selectedId: number | null;
  onStage: (stage: Stage) => void;
  onSelect: (id: number) => void;
  // On phones the queue is the whole screen: it grows with the page, and a row expands into the case.
  isNarrow: boolean;
}

interface RowProps {
  finding: Finding;
  isSelected: boolean;
  isNarrow: boolean;
  onSelect: () => void;
}

function Row({ finding, isSelected, isNarrow, onSelect }: RowProps) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (isSelected && !isNarrow) ref.current?.scrollIntoView({ block: "nearest" });
  }, [isSelected, isNarrow]);
  const deadline = daysLeftLabel(finding.days_left);
  const isRecovered = finding.status === "recovered";
  const amount = isRecovered ? (finding.recovered_minor ?? finding.amount_minor) : finding.amount_minor;
  return (
    <motion.li layout="position" transition={SPRING} className="list-none">
      <button
        ref={ref}
        type="button"
        onClick={onSelect}
        aria-current={isSelected}
        data-case-id={finding.id}
        className={cn(
          "group relative grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 rounded-row px-4 py-3 text-left",
          "transition-transform duration-150 ease-out active:scale-[0.99]",
        )}
      >
        {/* On a phone this surface grows into the case view; on wide screens it is the hover tint. */}
        <motion.span
          aria-hidden
          layoutId={isNarrow ? `case-${finding.id}` : undefined}
          transition={SPRING}
          className={cn(
            "absolute inset-0 rounded-row transition-colors duration-150",
            isNarrow ? "bg-tint shadow-[inset_0_0_0_1px_var(--line)]" : "group-hover:bg-tint-hover",
          )}
        />
        {isSelected && !isNarrow && (
          <motion.span
            aria-hidden
            layoutId={`selection-${finding.stage}`}
            transition={SPRING}
            className="absolute inset-0 rounded-row bg-selected shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_35%,transparent)]"
          />
        )}
        <span className="relative truncate text-[15px] font-medium">{finding.merchant}</span>
        <span className={cn("figure relative text-right text-[15px]", isRecovered && "text-money-ink")}>
          {formatMoney(amount, finding.currency)}
        </span>
        <span className="relative truncate text-[13px] text-dim">
          {LEAK_LABEL[finding.leak_type]}
          {finding.outcome === "needs_review" && <span className="text-amber"> · Needs review</span>}
        </span>
        <span className="relative justify-self-end">
          {finding.stage === "todo" && deadline ? (
            <Deadline label={deadline} daysLeft={finding.days_left} />
          ) : (
            <StatusChip status={finding.status} />
          )}
        </span>
      </button>
    </motion.li>
  );
}

function List({ stage, findings, selectedId, isNarrow, onSelect }: Omit<Props, "counts" | "onStage">) {
  if (findings.length === 0) {
    return <p className="px-4 py-10 text-center text-sm leading-relaxed text-dim text-balance">{EMPTY[stage]}</p>;
  }
  return (
    <ul
      aria-keyshortcuts="j k ArrowDown ArrowUp"
      className={cn("m-0 flex flex-col gap-0.5 p-0", !isNarrow && "max-h-[calc(100dvh-132px)] overflow-y-auto")}
    >
      {findings.map((finding) => (
        <Row
          key={finding.id}
          finding={finding}
          isSelected={finding.id === selectedId}
          isNarrow={isNarrow}
          onSelect={() => onSelect(finding.id)}
        />
      ))}
    </ul>
  );
}

export function Queue({ findings, stage, counts, selectedId, onStage, onSelect, isNarrow }: Props) {
  return (
    <section aria-label="Cases" title="j / k or the arrow keys move through the list" className="glass-lg rounded-panel p-2">
      <SmoothTab
        label="Case stages"
        value={stage}
        onChange={(id) => onStage(id as Stage)}
        listClassName="px-2 pt-2"
        items={TABS.map((tab) => ({
          id: tab.stage,
          title: tab.label,
          badge: counts[tab.stage],
          content: (
            <List
              stage={tab.stage}
              findings={findings.filter((f) => f.stage === tab.stage)}
              selectedId={selectedId}
              isNarrow={isNarrow}
              onSelect={onSelect}
            />
          ),
        }))}
      />
    </section>
  );
}
