import type { AuditEvent, TimelineEvent } from "../../api";
import { formatDate, formatDateTime } from "../../format";
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

/** The story of the case and its append-only record, in one disclosure that starts closed. */
export function History({ events, trace }: { events: TimelineEvent[]; trace: AuditEvent[] }) {
  return (
    <details className="group rounded-card bg-tint shadow-[inset_0_0_0_1px_var(--line)]">
      <summary className="flex cursor-pointer select-none items-center justify-between gap-4 rounded-card px-5 py-4 text-sm font-medium transition-colors hover:bg-tint-hover">
        <span>
          History <span className="font-normal text-dim">· {events.length} events</span>
        </span>
        <svg viewBox="0 0 16 16" aria-hidden className="size-4 text-dim transition-transform duration-200 group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6l4 4 4-4" />
        </svg>
      </summary>
      <div className="flex flex-col gap-6 px-5 pb-5 pt-1">
        <ol className="m-0 flex flex-col p-0">
          {events.map((event, index) => (
            <li key={`${event.kind}-${event.at}-${index}`} className="relative grid list-none grid-cols-[96px_14px_minmax(0,1fr)] gap-x-3 pb-4 last:pb-0">
              <span className="figure pt-px text-right text-xs text-dim">{formatDate(event.at)}</span>
              <span className="relative flex justify-center">
                <span
                  className={cn(
                    "z-[1] mt-1.5 size-2 rounded-full",
                    event.kind === "recovered" ? "bg-money" : event.is_future ? "shadow-[inset_0_0_0_1.5px_var(--dim)]" : "bg-dim",
                  )}
                />
                {index < events.length - 1 && <span className="absolute bottom-[-16px] top-4 w-px bg-line-strong" />}
              </span>
              <div className="min-w-0">
                <p className={cn("text-sm", event.is_future && "text-dim")}>
                  {event.title}
                  {event.is_future && <span className="text-xs"> · upcoming</span>}
                </p>
                {event.detail && event.kind !== "detected" && <p className="ref truncate text-xs text-dim">{event.detail}</p>}
              </div>
            </li>
          ))}
        </ol>
        <div className="border-t border-line pt-4">
          <p className="text-xs text-dim">Recorded events · append-only</p>
          <ul className="m-0 mt-2 flex flex-col gap-1 p-0">
            {trace.map((event) => (
              <li key={event.id} className="list-none text-[13px]">
                <span className="figure text-xs text-dim">{formatDateTime(event.occurred_at)}</span> {actionLabel(event.action)}{" "}
                <span className="text-dim">by {actorLabel(event.actor)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </details>
  );
}
