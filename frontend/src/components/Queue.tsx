import { useEffect, useRef } from "react";
import type { Finding, Stage } from "../api";
import { daysLeftLabel, formatMoney } from "../format";
import { COLORS, FONTS, LEAK_LABEL, card } from "../theme";
import { DeadlinePill, StatusChip } from "./Chip";

const TABS: { stage: Stage; label: string }[] = [
  { stage: "todo", label: "To do" },
  { stage: "waiting", label: "Waiting" },
  { stage: "done", label: "Done" },
];

const URGENT_DAYS = 14;

export function isUrgent(daysLeft: number | null): boolean {
  return daysLeft !== null && daysLeft >= 0 && daysLeft <= URGENT_DAYS;
}

interface Props {
  findings: Finding[];
  stage: Stage;
  counts: Record<Stage, number>;
  selectedId: number | null;
  onStage: (stage: Stage) => void;
  onSelect: (id: number) => void;
  // On phones the queue is the whole screen, so it grows with the page instead of scrolling.
  isNarrow: boolean;
}

function Row({ finding, isSelected, onSelect }: { finding: Finding; isSelected: boolean; onSelect: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (isSelected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [isSelected]);
  const deadline = daysLeftLabel(finding.days_left);
  const isRecovered = finding.status === "recovered";
  const amount = isRecovered ? (finding.recovered_minor ?? finding.amount_minor) : finding.amount_minor;
  return (
    <button
      ref={ref}
      type="button"
      onClick={onSelect}
      aria-current={isSelected}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: "4px 12px",
        width: "100%",
        textAlign: "left",
        padding: "13px 16px 13px 14px",
        border: "none",
        borderBottom: `1px solid ${COLORS.border}`,
        borderLeft: `3px solid ${isSelected ? COLORS.accent : "transparent"}`,
        background: isSelected ? COLORS.accentSoft : COLORS.surface,
        cursor: "pointer",
      }}
    >
      <span style={{ fontFamily: FONTS.serif, fontSize: 18, color: COLORS.ink, minWidth: 0 }}>
        {finding.merchant}
      </span>
      <span
        style={{
          fontFamily: FONTS.mono,
          fontSize: 14,
          color: isRecovered ? COLORS.good : COLORS.ink,
          textAlign: "right",
        }}
      >
        {formatMoney(amount, finding.currency)}
      </span>
      <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.inkDim, minWidth: 0 }}>
        {LEAK_LABEL[finding.leak_type]} · {finding.next_action.label}
      </span>
      <span style={{ textAlign: "right" }}>
        {finding.stage === "todo" && deadline ? (
          <DeadlinePill label={deadline} isUrgent={isUrgent(finding.days_left)} />
        ) : (
          <StatusChip status={finding.status} />
        )}
      </span>
    </button>
  );
}

function Empty({ stage }: { stage: Stage }) {
  const text = {
    todo: "Nothing needs you right now.",
    waiting: "No requests are waiting on a vendor.",
    done: "Closed cases will collect here.",
  }[stage];
  return (
    <div style={{ padding: "28px 18px", fontFamily: FONTS.serif, fontSize: 17, color: COLORS.inkDim }}>
      {text}
    </div>
  );
}

export function Queue({ findings, stage, counts, selectedId, onStage, onSelect, isNarrow }: Props) {
  return (
    <section aria-label="Cases" style={{ ...card, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div role="tablist" style={{ display: "flex", borderBottom: `1px solid ${COLORS.border}` }}>
        {TABS.map((tab) => {
          const isActive = tab.stage === stage;
          return (
            <button
              key={tab.stage}
              role="tab"
              type="button"
              aria-selected={isActive}
              onClick={() => onStage(tab.stage)}
              style={{
                flex: 1,
                padding: "12px 8px",
                border: "none",
                borderBottom: `2px solid ${isActive ? COLORS.accent : "transparent"}`,
                background: "transparent",
                fontFamily: FONTS.mono,
                fontSize: 12,
                color: isActive ? COLORS.ink : COLORS.inkDim,
                cursor: "pointer",
              }}
            >
              {tab.label}
              <span
                style={{
                  marginLeft: 6,
                  padding: "1px 7px",
                  borderRadius: 999,
                  background: isActive ? COLORS.accentSoft : COLORS.muted,
                  color: isActive ? COLORS.accentInk : COLORS.inkDim,
                }}
              >
                {counts[tab.stage]}
              </span>
            </button>
          );
        })}
      </div>
      <div style={{ overflowY: "auto", maxHeight: isNarrow ? "none" : "calc(100vh - 290px)", minHeight: 160 }}>
        {findings.length === 0 ? (
          <Empty stage={stage} />
        ) : (
          findings.map((finding) => (
            <Row
              key={finding.id}
              finding={finding}
              isSelected={finding.id === selectedId}
              onSelect={() => onSelect(finding.id)}
            />
          ))
        )}
      </div>
      <div
        style={{
          padding: "8px 14px",
          borderTop: `1px solid ${COLORS.border}`,
          fontFamily: FONTS.mono,
          fontSize: 11,
          color: COLORS.inkDim,
          background: COLORS.sunken,
        }}
      >
        j / k to move · sorted by deadline
      </div>
    </section>
  );
}
