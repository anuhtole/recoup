import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useState } from "react";
import type { Draft, FindingDetail } from "../../api";
import { daysHint, formatDate } from "../../format";
import { SPRING } from "../../motion";
import { isUrgent } from "../../theme";
import { cn } from "@/lib/utils";
import { Button } from "../Button";
import { needsCustomerConfirmation } from "./cite";

const LIVE = new Set(["open", "drafted", "info_requested", "vendor_declined"]);

function Block({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <section aria-label={label} className={cn("flex flex-col gap-0.5 px-5 py-4", className)}>
      {children}
    </section>
  );
}

/** The top of the rail: the deadline while it can still be claimed, otherwise where the case stands. */
function Standing({ detail }: { detail: FindingDetail }) {
  if (detail.status === "recovered") {
    // The amount already leads the header in mint; the rail says when it came back and how we know.
    const at = detail.timeline.find((e) => e.kind === "recovered" && !e.is_future)?.at;
    return (
      <Block label="Recovered">
        <p className="m-0 text-13 text-dim">Recovered</p>
        <p className="figure m-0 text-20 font-semibold tracking-[-0.01em] text-mint-ink">{at ? formatDate(at) : "Recovered"}</p>
        <p className="m-0 text-13 text-dim">Confirmed in your ledger</p>
      </Block>
    );
  }
  const isSla = detail.leak_type === "sla_credit";
  if (LIVE.has(detail.status) && detail.recover_by && detail.days_left !== null) {
    const days = detail.days_left;
    const closed = days < 0;
    // One label everywhere ("Respond by"); once the date has passed, the label says so and the date stays.
    return (
      <Block label={closed ? "Window closed" : "Respond by"}>
        <p className="m-0 text-13 text-dim">{closed ? "Window closed" : "Respond by"}</p>
        <p className="figure m-0 text-20 font-semibold tracking-[-0.01em]">{formatDate(detail.recover_by)}</p>
        {!closed && <p className={cn("m-0 text-13", isUrgent(days) ? "font-medium text-amber-ink" : "text-dim")}>{daysHint(days)}</p>}
        {closed && !isSla && (
          <p className="m-0 mt-2 text-13 text-dim">
            {detail.draft_channel === "card_dispute"
              ? "Too late for a card dispute, and there's no billing contact on file for this vendor."
              : "Too late for a card dispute. The vendor can still refund you directly."}
          </p>
        )}
      </Block>
    );
  }
  const reason = detail.timeline.find((e) => e.kind === "dismissed")?.detail;
  const title =
    detail.status === "vendor_agreed"
      ? "Waiting for the credit"
      : detail.status === "sent"
        ? "Waiting on the vendor"
        : detail.status === "dismissed"
          ? "Not owed"
          : "Window closed";
  return (
    <Block label="Status">
      <p className="m-0 text-16 font-semibold">{title}</p>
      <p className="m-0 text-13 text-dim">
        {detail.status === "vendor_agreed"
          ? "They agreed to refund it. It closes when the credit posts."
          : detail.status === "sent"
            ? "Recoup watches the inbox and the ledger."
            : detail.status === "dismissed"
              ? reason
                ? `Not owed: ${reason.charAt(0).toLowerCase()}${reason.slice(1).replace(/\.$/, "")}`
                : "Marked not owed."
              : detail.recover_by
                ? `The claim window closed on ${formatDate(detail.recover_by)}.`
                : "The claim window has closed."}
      </p>
    </Block>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-4">
      <dt className="text-13 text-dim">{label}</dt>
      <dd className="m-0 min-w-0 truncate text-right text-13">{children}</dd>
    </div>
  );
}

/** Status lives once, in the header beside the amount; the rail holds the facts around it. */
function Details({ detail }: { detail: FindingDetail }) {
  const card = detail.transactions.find((t) => t.card_last4)?.card_last4;
  // The demo clock's date it was flagged, not the wall-clock row time.
  const found = detail.timeline.find((e) => e.kind === "detected")?.at ?? detail.created_at;
  return (
    <section aria-label="Details" className="border-t border-line px-5 py-2">
      <dl className="m-0">
        {card && (
          <Detail label="Card">
            <span className="sr-only">Card ending {card}</span>
            <span aria-hidden className="tracking-[0.12em] text-dim">
              ····
            </span>{" "}
            <span aria-hidden className="ref">
              {card}
            </span>
          </Detail>
        )}
        <Detail label="Found">
          <span className="figure">{formatDate(found)}</span>
        </Detail>
      </dl>
    </section>
  );
}

const DRAFT_LABEL: Record<string, string> = {
  draft: "Draft request",
  follow_up: "Draft follow-up",
  escalate: "Draft card dispute",
};

/** The draft button's words: it says "card dispute" whenever the draft will go to the card issuer. */
function draftLabel(detail: FindingDetail): string | null {
  const { kind } = detail.next_action;
  if (!(kind in DRAFT_LABEL)) return null;
  // The card issuer is the only channel and its window has closed: a dispute would be refused, so don't offer one.
  if (detail.draft_channel === "card_dispute" && detail.days_left !== null && detail.days_left < 0) return null;
  if (detail.draft_channel === "card_dispute" && kind !== "follow_up") return "Draft card dispute";
  return DRAFT_LABEL[kind];
}

export interface PrimaryAction {
  label: string;
  run: () => void;
  busyLabel?: string;
}

/** The one main action on a claim, shared by the rail and the phone's bottom bar. */
export function primaryAction(props: Pick<ActionsProps, "detail" | "openDraft" | "onDraft" | "onReview">): PrimaryAction | null {
  if (props.openDraft) return { label: "Review and send", run: props.onReview };
  const label = draftLabel(props.detail);
  return label ? { label, run: props.onDraft, busyLabel: "Drafting…" } : null;
}

/** A line above the action only where it stops a mistake. */
function caution(detail: FindingDetail, hasDraft: boolean): string | null {
  if (hasDraft) return null;
  if (detail.next_action.kind === "draft" && needsCustomerConfirmation(detail.leak_type, detail.reason))
    return "Before you ask, confirm the outage affected you and your order form has these terms.";
  if (detail.next_action.kind === "follow_up") return "The vendor needs more from you, or has gone quiet.";
  if (detail.next_action.kind === "escalate") return "The vendor said no. Your card issuer can still reverse the charge.";
  return null;
}

interface ActionsProps {
  detail: FindingDetail;
  openDraft: Draft | undefined;
  /** The approval sheet is open over the page: its slider is the only send control showing. */
  isReviewing: boolean;
  isBusy: boolean;
  onDraft: () => void;
  onReview: () => void;
  onDismiss: (reason: string) => void;
}

function Actions({ detail, openDraft, isReviewing, isBusy, onDraft, onReview, onDismiss }: ActionsProps) {
  const [isDismissing, setIsDismissing] = useState(false);
  const [reason, setReason] = useState("");
  const label = draftLabel(detail);
  const canDraft = !openDraft && label !== null;
  const canDismiss = !["recovered", "dismissed", "expired"].includes(detail.status);
  const note = caution(detail, Boolean(openDraft));
  if (!openDraft && !canDraft && !canDismiss) return null;
  return (
    <section aria-label="Next step" className="flex flex-col gap-3 border-t border-line px-5 py-4">
      {note && <p className="m-0 text-13 text-amber-ink">{note}</p>}
      {!isDismissing && (
        <div className="flex flex-col gap-1">
          {openDraft && (
            // Hidden (not removed, so nothing jumps) while the approval sheet's slider is the send control.
            // On phones the bottom bar carries it, so it isn't on the page twice.
            <Button variant="primary" size="lg" onClick={onReview} className={cn("w-full max-md:hidden", isReviewing && "invisible")}>
              Review and send
            </Button>
          )}
          {canDraft && (
            <Button variant="primary" size="lg" onClick={onDraft} isBusy={isBusy} busyLabel="Drafting…" className="w-full max-md:hidden">
              {label}
            </Button>
          )}
          {canDismiss && (
            <Button variant="ghost" onClick={() => setIsDismissing(true)} className="w-full">
              Not owed
            </Button>
          )}
        </div>
      )}
      <AnimatePresence initial={false}>
        {isDismissing && (
          <motion.form
            key="dismiss"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={SPRING}
            onSubmit={(event) => {
              event.preventDefault();
              if (reason.trim()) onDismiss(reason.trim());
            }}
            className="flex flex-col gap-2"
          >
            <label htmlFor="dismiss-reason" className="text-13 font-medium">
              Why isn't it owed?
            </label>
            <input
              id="dismiss-reason"
              autoFocus
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setIsDismissing(false);
                }
              }}
              placeholder="For example: two separate orders"
              maxLength={500}
              className="h-9 w-full rounded-sm border border-line-strong bg-paper px-3 text-14 text-ink placeholder:text-dim transition-colors hover:border-dim focus-visible:border-ink focus-visible:outline-none"
            />
            <div className="flex gap-2">
              <Button type="submit" variant="primary" disabled={!reason.trim()} isBusy={isBusy} className="flex-1">
                Mark not owed
              </Button>
              <Button variant="ghost" onClick={() => setIsDismissing(false)}>
                Cancel
              </Button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </section>
  );
}

/**
 * Phones (under 900px): the main action in a bar pinned just above the tab bar, so it is never buried
 * mid-page. Hidden while the approval sheet is up (its slider is then the only send control).
 */
export function PhoneActionBar(props: Pick<ActionsProps, "detail" | "openDraft" | "isReviewing" | "isBusy" | "onDraft" | "onReview">) {
  const action = primaryAction(props);
  if (!action || props.isReviewing) return null;
  return (
    <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 border-t border-line bg-paper px-4 py-3 md:hidden">
      <Button variant="primary" size="lg" onClick={action.run} isBusy={props.isBusy && !props.openDraft} busyLabel={action.busyLabel} className="w-full">
        {action.label}
      </Button>
    </div>
  );
}

/** The right rail: one bordered block with the deadline, the facts, and the one action. */
export function CaseRail(props: ActionsProps & { className?: string }) {
  return (
    <aside aria-label="Claim details" className={cn("flex min-w-0 flex-col rounded-md border border-line bg-paper", props.className)}>
      <Standing detail={props.detail} />
      <Details detail={props.detail} />
      <Actions {...props} />
    </aside>
  );
}
