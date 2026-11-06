import { ChevronDown } from "lucide-react";
import type { AuditEvent, TimelineEvent } from "../../api";
import { formatDateTime, formatShortDate, plural } from "../../format";
import { titleCase } from "../../queue";
import { cn } from "@/lib/utils";

const ACTION_LABEL: Record<string, string> = {
  "finding.created": "Case opened",
  "finding.updated": "Case updated",
  "draft.created": "Request drafted",
  "draft.edited": "Draft edited",
  "message.sent": "Request sent",
  "vendor.replied": "Vendor replied",
  "recovery.confirmed": "Money confirmed in the ledger",
  "case.dismissed": "Dismissed",
  "email.rejected": "Email set aside",
};

function actionLabel(action: string): string {
  if (ACTION_LABEL[action]) return ACTION_LABEL[action];
  const words = action.replace(/[._]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function actorLabel(actor: string): string {
  if (actor === "user:reviewer") return "you";
  if (actor.startsWith("user:")) return actor.slice("user:".length);
  return "Recoup";
}

/** An event's second line: a reference in mono, a status-page link by its host, anything else as plain text. */
function EventDetail({ text }: { text: string }) {
  if (/^https?:\/\//.test(text)) {
    let host = text;
    try {
      host = new URL(text).host;
    } catch {
      /* keep the raw text */
    }
    return (
      <a href={text} target="_blank" rel="noopener noreferrer" className="text-13 text-dim underline decoration-line-strong underline-offset-4 hover:text-ink">
        {host}
      </a>
    );
  }
  if (/^[A-Z0-9][A-Z0-9-]{3,}$/.test(text)) return <span className="ref text-12 text-dim">{text}</span>;
  return <span className="text-13 text-dim [overflow-wrap:anywhere]">{text}</span>;
}

/** The story of the case and its append-only record, in one disclosure that starts closed. */
export function History({ events, trace }: { events: TimelineEvent[]; trace: AuditEvent[] }) {
  return (
    <details className="group">
      <summary className="flex min-h-8 cursor-pointer select-none items-center justify-between gap-4 border-b border-line pb-2">
        <h2 className="m-0 text-14 font-semibold tracking-[-0.01em]">History</h2>
        <span className="flex items-center gap-2 text-13 text-dim">
          {plural(events.length, "event")}
          <ChevronDown aria-hidden className="size-4 transition-transform duration-200 group-open:rotate-180" strokeWidth={1.75} />
        </span>
      </summary>
      <div className="flex flex-col gap-6 pt-4">
        <ol className="m-0 flex flex-col p-0">
          {events.map((event, index) => (
            <li key={`${event.kind}-${event.at}-${index}`} className="relative grid list-none grid-cols-[52px_16px_minmax(0,1fr)] gap-x-3 pb-4 last:pb-0">
              <span className="figure pt-px text-right text-13 text-dim">{formatShortDate(event.at)}</span>
              <span className="relative flex justify-center">
                {index < events.length - 1 && <span aria-hidden className="absolute -bottom-4 top-4 w-px bg-line" />}
                <span
                  className={cn(
                    "relative mt-1.5 size-2 rounded-full",
                    event.kind === "recovered" ? "bg-mint-ink" : event.kind === "deadline" ? "bg-amber" : event.is_future ? "border border-dim bg-paper" : "bg-ink",
                  )}
                />
              </span>
              <div className="flex min-w-0 flex-col">
                <p className={cn("m-0 text-14", event.is_future && "text-dim")}>
                  {titleCase(event.title)}
                  {event.is_future && <span className="ml-2 text-12 text-dim">Upcoming</span>}
                </p>
                {event.detail && event.kind !== "detected" && <EventDetail text={event.detail} />}
              </div>
            </li>
          ))}
        </ol>
        {trace.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {/* These are the server's wall-clock times, not the demo date the story above runs on. */}
            <h3 className="m-0 text-13 font-medium text-dim">Audit log · server time</h3>
            <ul className="m-0 flex flex-col gap-1 p-0">
              {trace.map((event) => (
                <li key={event.id} className="list-none text-13">
                  <span className="figure text-dim">{formatDateTime(event.occurred_at)}</span> · {actionLabel(event.action)} <span className="text-dim">by {actorLabel(event.actor)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}
