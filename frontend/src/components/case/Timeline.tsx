import type { TimelineEvent, TimelineKind } from "../../api";
import { formatDate } from "../../format";
import { COLORS, FONTS } from "../../theme";

const DOT: Record<TimelineKind, string> = {
  charge: COLORS.inkDim,
  promise: COLORS.warn,
  incident: COLORS.warn,
  detected: COLORS.accent,
  drafted: COLORS.accent,
  sent: COLORS.accentInk,
  reply: COLORS.accentInk,
  recovered: COLORS.good,
  dismissed: COLORS.inkDim,
  deadline: COLORS.warn,
};

export function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {events.map((event, index) => {
        const isLast = index === events.length - 1;
        const color = DOT[event.kind];
        return (
          <li key={`${event.kind}-${event.at}-${index}`} style={{ display: "grid", gridTemplateColumns: "88px 18px 1fr", gap: 10 }}>
            <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.inkDim, paddingTop: 3, textAlign: "right" }}>
              {formatDate(event.at)}
            </span>
            <span style={{ position: "relative", display: "flex", justifyContent: "center" }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  marginTop: 5,
                  borderRadius: 999,
                  background: event.is_future ? COLORS.surface : color,
                  border: `2px solid ${color}`,
                  zIndex: 1,
                }}
              />
              {!isLast && (
                <span style={{ position: "absolute", top: 17, bottom: -4, width: 1, background: COLORS.border }} />
              )}
            </span>
            <div style={{ paddingBottom: 14, minWidth: 0 }}>
              <div style={{ fontFamily: FONTS.serif, fontSize: 16, color: event.is_future ? COLORS.inkDim : COLORS.ink }}>
                {event.title}
                {event.is_future && <span style={{ fontFamily: FONTS.mono, fontSize: 11 }}> · upcoming</span>}
              </div>
              {event.detail && (
                <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.inkDim, overflowWrap: "anywhere" }}>
                  {event.detail}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
