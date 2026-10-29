import type { AuditEvent } from "../../api";
import { formatDateTime } from "../../format";
import { COLORS, mono } from "../../theme";

export function AuditTrail({ trace }: { trace: AuditEvent[] }) {
  return (
    <details>
      <summary style={{ ...mono, cursor: "pointer", color: COLORS.inkDim }}>
        {trace.length} recorded events · append-only
      </summary>
      <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0 }}>
        {trace.map((event) => (
          <li key={event.id} style={{ ...mono, marginBottom: 4 }}>
            <span style={{ color: COLORS.inkDim }}>{formatDateTime(event.occurred_at)}</span> {event.action}{" "}
            <span style={{ color: COLORS.inkDim }}>by {event.actor}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
