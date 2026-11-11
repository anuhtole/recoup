import { ChevronDown } from "lucide-react";
import type { Draft, Email } from "../../api";
import { formatDateTime, plural } from "../../format";
import { Section } from "../Section";

interface Message {
  key: string;
  at: string;
  from: string;
  subject: string;
  body: string;
  isOurs: boolean;
}

/** The emails on a case, the vendor's and the ones you sent, oldest first; each opens in place. */
export function Correspondence({ emails, drafts }: { emails: Email[]; drafts: Draft[] }) {
  const messages: Message[] = [
    ...emails.map((e) => ({ key: e.id, at: e.sent_at, from: e.from_addr, subject: e.subject, body: e.body, isOurs: false })),
    ...drafts
      .filter((d) => d.status === "sent" && d.sent_at)
      .map((d) => ({ key: `draft-${d.id}`, at: d.sent_at as string, from: `You to ${d.to_addr}`, subject: d.subject, body: d.body, isOurs: true })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  if (messages.length === 0) return null;
  return (
    <Section title="Correspondence" meta={plural(messages.length, "message")}>
      <ul className="m-0 flex flex-col p-0">
        {messages.map((message) => (
          <li key={message.key} className="list-none border-b border-line">
            <details className="group">
              <summary className="-mx-2 flex cursor-pointer select-none items-start gap-3 rounded-sm px-2 py-3 transition-colors hover:bg-wash">
                <span aria-hidden className={`mt-2 size-1.5 flex-none rounded-full ${message.isOurs ? "bg-ink" : "bg-line-strong"}`} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-14 font-medium [overflow-wrap:anywhere]">{message.subject}</span>
                  <span className="text-13 text-dim [overflow-wrap:anywhere]">
                    {message.from} · <span className="figure">{formatDateTime(message.at)}</span>
                  </span>
                </span>
                <ChevronDown aria-hidden className="mt-1 size-4 flex-none text-dim transition-transform duration-200 group-open:rotate-180" strokeWidth={1.75} />
              </summary>
              <p className="m-0 mb-3 ml-4.5 whitespace-pre-wrap rounded-sm bg-wash px-4 py-3 text-13 leading-6">{message.body}</p>
            </details>
          </li>
        ))}
      </ul>
    </Section>
  );
}
