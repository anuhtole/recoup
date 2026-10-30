import type { Draft, Email } from "../../api";
import { formatDateTime } from "../../format";

interface Message {
  key: string;
  at: string;
  from: string;
  subject: string;
  body: string;
}

export function Correspondence({ emails, drafts }: { emails: Email[]; drafts: Draft[] }) {
  const messages: Message[] = [
    ...emails.map((e) => ({ key: e.id, at: e.sent_at, from: e.from_addr, subject: e.subject, body: e.body })),
    ...drafts
      .filter((d) => d.status === "sent" && d.sent_at)
      .map((d) => ({
        key: `draft-${d.id}`,
        at: d.sent_at as string,
        from: `You to ${d.to_addr}`,
        subject: d.subject,
        body: d.body,
      })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  if (messages.length === 0) return null;
  return (
    <ul className="m-0 flex flex-col gap-1 p-0">
      {messages.map((message) => (
        <li key={message.key} className="list-none">
          <details className="group rounded-row transition-colors open:bg-tint hover:bg-tint">
            <summary className="flex cursor-pointer select-none flex-col gap-0.5 rounded-row px-4 py-3">
              <span className="truncate text-[15px] font-medium">{message.subject}</span>
              <span className="truncate text-[13px] text-dim">
                {message.from} · <span className="figure">{formatDateTime(message.at)}</span>
              </span>
            </summary>
            <p className="m-0 whitespace-pre-wrap px-4 pb-4 text-sm leading-relaxed">{message.body}</p>
          </details>
        </li>
      ))}
    </ul>
  );
}
