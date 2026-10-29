import type { Outcome, Status } from "../api";
import { COLORS, FONTS, OUTCOME_COLORS, OUTCOME_LABEL, STATUS_LABEL } from "../theme";

function Pill({ label, fg, bg }: { label: string; fg: string; bg: string }) {
  return (
    <span
      style={{
        fontFamily: FONTS.mono,
        fontSize: 11,
        color: fg,
        background: bg,
        padding: "3px 8px",
        borderRadius: 999,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

export function OutcomeChip({ outcome }: { outcome: Outcome }) {
  const { fg, bg } = OUTCOME_COLORS[outcome];
  return <Pill label={OUTCOME_LABEL[outcome]} fg={fg} bg={bg} />;
}

const STATUS_COLORS: Partial<Record<Status, { fg: string; bg: string }>> = {
  recovered: { fg: COLORS.good, bg: COLORS.goodSoft },
  sent: { fg: COLORS.accentInk, bg: COLORS.accentSoft },
  vendor_agreed: { fg: COLORS.accentInk, bg: COLORS.accentSoft },
  info_requested: { fg: COLORS.warn, bg: COLORS.warnSoft },
  vendor_declined: { fg: COLORS.warn, bg: COLORS.warnSoft },
};

export function StatusChip({ status }: { status: Status }) {
  const { fg, bg } = STATUS_COLORS[status] ?? { fg: COLORS.inkSoft, bg: COLORS.muted };
  return <Pill label={STATUS_LABEL[status]} fg={fg} bg={bg} />;
}

export function DeadlinePill({ label, isUrgent }: { label: string; isUrgent: boolean }) {
  return (
    <Pill
      label={label}
      fg={isUrgent ? COLORS.warn : COLORS.inkDim}
      bg={isUrgent ? COLORS.warnSoft : COLORS.sunken}
    />
  );
}
