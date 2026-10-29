import type { Summary } from "../api";
import { formatMoney } from "../format";
import { COLORS, FONTS, card, eyebrow } from "../theme";

interface Tile {
  label: string;
  amount: number;
  hint: string;
  color: string;
}

export function Metrics({ summary }: { summary: Summary }) {
  const found = summary.claimable_minor + summary.in_flight_minor + summary.recovered_minor;
  const recoveredShare = found > 0 ? summary.recovered_minor / found : 0;
  const tiles: Tile[] = [
    { label: "Ready to claim", amount: summary.claimable_minor, hint: "Needs a decision from you", color: COLORS.ink },
    { label: "In flight", amount: summary.in_flight_minor, hint: "Requested, waiting on vendors", color: COLORS.accentInk },
    { label: "Recovered", amount: summary.recovered_minor, hint: "Confirmed in the ledger", color: COLORS.good },
    { label: "Missed", amount: summary.expired_minor, hint: "Claim window closed", color: COLORS.inkDim },
  ];
  return (
    <section aria-label="Totals" style={{ ...card, padding: "18px 20px", marginBottom: 16 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 18,
        }}
      >
        {tiles.map((tile) => (
          <div key={tile.label}>
            <div style={eyebrow}>{tile.label}</div>
            <div
              style={{
                fontFamily: FONTS.serif,
                fontSize: "clamp(22px, 5.5vw, 32px)",
                color: tile.color,
                lineHeight: 1.15,
              }}
            >
              {formatMoney(tile.amount, summary.currency)}
            </div>
            <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.inkDim }}>{tile.hint}</div>
          </div>
        ))}
      </div>
      <div
        aria-label={`${Math.round(recoveredShare * 100)}% of money found has been recovered`}
        style={{ marginTop: 16, height: 6, borderRadius: 999, background: COLORS.muted, overflow: "hidden" }}
      >
        <div
          style={{
            width: `${recoveredShare * 100}%`,
            height: "100%",
            background: COLORS.good,
            transition: "width 400ms ease",
          }}
        />
      </div>
    </section>
  );
}
