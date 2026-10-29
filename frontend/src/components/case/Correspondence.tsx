import type { Draft, Email } from "../../api";
import { formatDateTime } from "../../format";
import { COLORS, FONTS, mono } from "../../theme";

interface Message {
  key: string;
  at: string;
  from: string;
  subject: string;
  body: string;
  isOutbound: boolean;
}

export function Correspondence({ emails, drafts }: { emails: Email[]; drafts: Draft[] }) {
  const messages: Message[] = [
    ...emails.map((e) => ({
      key: e.id, at: e.sent_at, from: e.from_addr, subject: e.subject, body: e.body, isOutbound: false,
    })),
    ...drafts
      .filter((d) => d.status === "sent" && d.sent_at)
      .map((d) => ({
        key: `draft-${d.id}`, at: d.sent_at as string, from: `You → ${d.to_addr}`,
        subject: d.subject, body: d.body, isOutbound: true,
      })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  if (messages.length === 0) return null;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {messages.map((message) => (
        <details
          key={message.key}
          style={{
            border: `1px solid ${COLORS.border}`,
            borderLeft: `3px solid ${message.isOutbound ? COLORS.accent : COLORS.borderStrong}`,
            borderRadius: 8,
            background: COLORS.surface,
          }}
        >
          <summary style={{ cursor: "pointer", padding: "9px 12px", listStyle: "none" }}>
            <div style={{ fontFamily: FONTS.serif, fontSize: 16, color: COLORS.ink }}>{message.subject}</div>
            <div style={{ ...mono, fontSize: 11, color: COLORS.inkDim }}>
              {message.from} · {formatDateTime(message.at)}
            </div>
          </summary>
          <pre
            style={{
              margin: 0,
              padding: "0 12px 12px",
              whiteSpace: "pre-wrap",
              fontFamily: FONTS.serif,
              fontSize: 15,
              lineHeight: 1.45,
              color: COLORS.inkSoft,
            }}
          >
            {message.body}
          </pre>
        </details>
      ))}
    </div>
  );
}
