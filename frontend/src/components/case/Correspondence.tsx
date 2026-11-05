import { ChevronDown } from "lucide-react";
import type { Draft, Email } from "../../api";
import { formatDateTime } from "../../format";

interface Message {
  key: string;
  at: string;
  from: string;
  subject: string;
  body: string;
  isOurs: boolean;
}

export function Correspondence({ emails, drafts }: { emails: Email[]; drafts: Draft[] }) {
  const messages: Message[] = [
    ...emails.map((e) => ({ key: e.id, at: e.sent_at, from: e.from_addr, subject: e.subject, body: e.body, isOurs: false })),
    ...drafts
      .filter((d) => d.status === "sent" && d.sent_at)
      .map((d) => ({ key: `draft-${d.id}`, at: d.sent_at as string, from: `You → ${d.to_addr}`, subject: d.subject, body: d.body, isOurs: true })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  if (messages.length === 0) return null;
  return (
    <section aria-label="Correspondence" className="card">
      <header className="flex min-h-12 items-center justify-between gap-4 border-b border-line px-5">
        <h2 className="m-0 text-14 font-semibold tracking-[-0.01em]">Correspondence</h2>
        <span className="label text-dim">{messages.length === 1 ? "1 message" : `${messages.length} messages`}</span>
      </header>
      <ul className="m-0 flex flex-col p-0">
        {messages.map((message) => (
          <li key={message.key} className="list-none border-b border-line last:border-b-0">
            <details className="group">
              <summary className="flex cursor-pointer select-none items-start gap-3 px-5 py-3 transition-colors hover:bg-wash">
                <span aria-hidden className={`mt-2 size-1.5 flex-none rounded-full ${message.isOurs ? "bg-ink" : "bg-line-strong"}`} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-14 font-medium [overflow-wrap:anywhere]">{message.subject}</span>
                  <span className="text-13 text-dim [overflow-wrap:anywhere]">
                    {message.from} · <span className="ref text-11 uppercase">{formatDateTime(message.at)}</span>
                  </span>
                </span>
                <ChevronDown aria-hidden className="mt-1 size-4 flex-none text-dim transition-transform duration-200 group-open:rotate-180" strokeWidth={1.75} />
              </summary>
              <p className="field-box m-0 mx-5 mb-4 whitespace-pre-wrap bg-wash px-4 py-3 text-13 leading-6">{message.body}</p>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
