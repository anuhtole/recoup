import { ChevronDown } from "lucide-react";
import type { AuditEvent, TimelineEvent } from "../../api";
import { formatDateTime, formatShortDate } from "../../format";
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

/** The story of the case as an activity feed, and its append-only record, in one disclosure that starts closed. */
export function History({ events, trace }: { events: TimelineEvent[]; trace: AuditEvent[] }) {
  return (
    <details className="group card">
      <summary className="flex min-h-12 cursor-pointer select-none items-center justify-between gap-4 rounded-md px-5 transition-colors hover:bg-wash">
        <span className="text-14 font-semibold tracking-[-0.01em]">History</span>
        <span className="flex items-center gap-3">
          <span className="label text-dim">{events.length} events</span>
          <ChevronDown aria-hidden className="size-4 text-dim transition-transform duration-200 group-open:rotate-180" strokeWidth={1.75} />
        </span>
      </summary>
      <div className="flex flex-col gap-5 border-t border-line px-5 pb-5 pt-4">
        <ol className="m-0 flex flex-col p-0">
          {events.map((event, index) => (
            <li key={`${event.kind}-${event.at}-${index}`} className="relative grid list-none grid-cols-[56px_16px_minmax(0,1fr)] gap-x-3 pb-4 last:pb-0">
              <span className="ref pt-0.5 text-right text-11 uppercase text-dim">{formatShortDate(event.at)}</span>
              <span className="relative flex justify-center">
                {index < events.length - 1 && <span aria-hidden className="absolute -bottom-4 top-4 w-px bg-line" />}
                <span
                  className={cn(
                    "relative mt-1.5 size-2 rounded-full",
                    event.kind === "recovered"
                      ? "bg-mint-ink"
                      : event.kind === "deadline"
                        ? "bg-amber"
                        : event.is_future
                          ? "border border-dim bg-paper"
                          : "bg-ink",
                  )}
                />
              </span>
              <div className="min-w-0">
                <p className={cn("m-0 text-14", event.is_future && "text-dim")}>
                  {event.title}
                  {event.is_future && <span className="label ml-2 text-dim">Upcoming</span>}
                </p>
                {event.detail && event.kind !== "detected" && <p className="ref m-0 truncate text-11 text-dim">{event.detail}</p>}
              </div>
            </li>
          ))}
        </ol>
        <div className="field-box bg-wash px-4 py-3">
          <p className="label m-0 text-dim">Recorded events · append-only</p>
          <ul className="m-0 mt-2 flex flex-col gap-1 p-0">
            {trace.map((event) => (
              <li key={event.id} className="list-none text-13">
                <span className="ref text-11 uppercase text-dim">{formatDateTime(event.occurred_at)}</span> {actionLabel(event.action)}{" "}
                <span className="text-dim">by {actorLabel(event.actor)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </details>
  );
}
