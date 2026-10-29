import type { Summary } from "../api";
import { formatDate } from "../format";
import { COLORS, FONTS } from "../theme";
import { Button } from "./Button";

interface Props {
  summary: Summary | null;
  isRunning: boolean;
  isAdvancing: boolean;
  onRun: () => void;
  onAdvance: () => void;
}

function ModeBadge({ mode }: { mode: string }) {
  const isClaude = mode.startsWith("claude:");
  return (
    <span
      title={
        isClaude
          ? "Vendor email is read by Claude; every extraction is checked in code."
          : "No API key configured: vendor email is read by keyword rules."
      }
      style={{
        fontFamily: FONTS.mono,
        fontSize: 11,
        padding: "4px 8px",
        borderRadius: 999,
        color: isClaude ? COLORS.accentInk : COLORS.inkDim,
        background: isClaude ? COLORS.accentSoft : COLORS.muted,
      }}
    >
      {isClaude ? `Claude · ${mode.slice("claude:".length)}` : "Offline rules"}
    </span>
  );
}

export function TopBar({ summary, isRunning, isAdvancing, onRun, onAdvance }: Props) {
  return (
    <header
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        marginBottom: 20,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
        <h1 style={{ fontFamily: FONTS.serif, fontSize: 34, fontWeight: 500, margin: 0 }}>Recoup</h1>
        <span style={{ fontFamily: FONTS.serif, fontSize: 17, color: COLORS.inkDim }}>
          Money your vendors owe you, with the receipts to get it back.
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {summary && <ModeBadge mode={summary.mode} />}
        {summary && (
          <span style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.inkSoft }}>
            As of {formatDate(summary.as_of)}
          </span>
        )}
        <Button onClick={onRun} isBusy={isRunning} title="Re-read the ledger and inbox">
          Run detection
        </Button>
        {summary?.demo_mode && (
          <Button
            onClick={onAdvance}
            isBusy={isAdvancing}
            title="Demo: move the clock two weeks and play the vendors' side"
          >
            Advance 2 weeks ›
          </Button>
        )}
      </div>
    </header>
  );
}
