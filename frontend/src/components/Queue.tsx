import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { Finding, Stage } from "../api";
import { daysLeftLabel, formatMoney } from "../format";
import { SPRING } from "../motion";
import { orderStage, referenceOf } from "../queue";
import { LEAK_LABEL } from "../theme";
import { Deadline, StatusChip } from "./Chip";
import SmoothTab from "./kokonutui/smooth-tab";
import { cn } from "@/lib/utils";

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
  // Keep the selected row in view by scrolling its own list only, never the page or the tab track.
  useEffect(() => {
    const row = ref.current;
    const list = row?.closest<HTMLElement>("[data-scroll]");
    if (!isSelected || isNarrow || !row || !list) return;
    const top = row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + row.offsetHeight - list.clientHeight;
  }, [isSelected, isNarrow]);
  const isRecovered = finding.status === "recovered";
  const amount = isRecovered ? (finding.recovered_minor ?? finding.amount_minor) : finding.amount_minor;
  const isClosed = finding.days_left !== null && finding.days_left < 0;
  const deadline = isClosed ? "Window closed" : daysLeftLabel(finding.days_left);
  const reference = referenceOf(finding.reason);
  const needsReview = finding.outcome === "needs_review";
  return (
    <motion.li layout="position" transition={SPRING} className="list-none">
      <button
        ref={ref}
        type="button"
        onClick={onSelect}
        aria-current={isSelected}
        data-case-id={finding.id}
        className="group relative grid w-full grid-cols-[minmax(0,1fr)_7rem] items-baseline gap-x-4 gap-y-1 rounded-row px-4 py-3 text-left transition-transform duration-150 ease-out active:scale-[0.99]"
      >
        {/* On a phone this surface grows into the case view; elsewhere it is the hover and selection tint. */}
        <motion.span
          aria-hidden
          layoutId={isNarrow ? `case-${finding.id}` : undefined}
          transition={SPRING}
          className={cn(
            "absolute inset-0 rounded-row transition-colors duration-150",
            isSelected && !isNarrow
              ? "bg-selected shadow-[inset_3px_0_0_var(--primary)]"
              : isNarrow
                ? "bg-tint"
                : "group-hover:bg-tint-hover",
          )}
        />
        <span className="relative flex min-w-0 flex-wrap items-center gap-x-2 text-16 font-medium">
          {finding.merchant}
          {needsReview && (
            <span className="inline-flex h-5 items-center rounded-full bg-amber/12 px-2 text-12 font-medium text-amber">Needs review</span>
          )}
        </span>
        <span className={cn("figure relative text-right text-16 font-medium", isRecovered && "text-money-ink")}>
          {formatMoney(amount, finding.currency)}
        </span>
        <span className="relative flex min-w-0 flex-wrap gap-x-2 text-14 text-dim">
          <span className="whitespace-nowrap">{LEAK_LABEL[finding.leak_type]}</span>
          {reference && <span className="ref whitespace-nowrap">{reference}</span>}
        </span>
        <span className="relative text-right">
          {finding.stage === "todo" && deadline ? (
            <Deadline label={deadline} daysLeft={isClosed ? null : finding.days_left} />
          ) : (
            <StatusChip status={finding.status} />
          )}
        </span>
      </button>
    </motion.li>
  );
}

function Rows({ findings, selectedId, isNarrow, onSelect }: Pick<Props, "selectedId" | "isNarrow" | "onSelect"> & { findings: Finding[] }) {
  return (
    <ul aria-keyshortcuts="j k ArrowDown ArrowUp" className="m-0 flex flex-col gap-1 p-0">
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

function List({ stage, findings, selectedId, isNarrow, onSelect }: Omit<Props, "counts" | "onStage">) {
  const { live, closed } = orderStage(findings, stage);
  const holdsSelection = closed.some((f) => f.id === selectedId);
  const [isClosedOpen, setIsClosedOpen] = useState(holdsSelection);
  useEffect(() => {
    if (holdsSelection) setIsClosedOpen(true);
  }, [holdsSelection]);

  return (
    <div data-scroll className={cn("flex flex-col gap-4", !isNarrow && "max-h-[calc(100dvh-132px)] overflow-y-auto")}>
      {live.length === 0 ? (
        <p className="px-4 py-8 text-center text-14 text-dim text-balance">{EMPTY[stage]}</p>
      ) : (
        <Rows findings={live} selectedId={selectedId} isNarrow={isNarrow} onSelect={onSelect} />
      )}
      {closed.length > 0 && (
        <details open={isClosedOpen} onToggle={(event) => setIsClosedOpen(event.currentTarget.open)} className="group">
          <summary className="flex cursor-pointer select-none items-center justify-between gap-4 rounded-row px-4 py-3 text-14 text-dim transition-colors hover:bg-tint-hover hover:text-ink">
            <span>
              Window closed <span className="figure">· {closed.length}</span>
            </span>
            <svg viewBox="0 0 16 16" aria-hidden className="size-4 transition-transform duration-200 group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6l4 4 4-4" />
            </svg>
          </summary>
          <p className="px-4 pb-2 text-12 text-dim">The card dispute window has passed. The vendor can still refund you directly.</p>
          <Rows findings={closed} selectedId={selectedId} isNarrow={isNarrow} onSelect={onSelect} />
        </details>
      )}
    </div>
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
              findings={findings}
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
