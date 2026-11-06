import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useState } from "react";
import type { Draft, FindingDetail } from "../../api";
import { formatDate, formatMoney } from "../../format";
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
    return (
      <Block label="Recovered">
        <p className="m-0 text-13 text-dim">Recovered</p>
        <p className="figure m-0 text-20 font-semibold tracking-[-0.01em] text-mint-ink">
          +{formatMoney(detail.recovered_minor ?? detail.amount_minor, detail.currency)}
        </p>
        <p className="m-0 text-13 text-dim">Confirmed in your ledger</p>
      </Block>
    );
  }
  const isSla = detail.leak_type === "sla_credit";
  if (LIVE.has(detail.status) && detail.recover_by && detail.days_left !== null) {
    const days = detail.days_left;
    const closed = days < 0;
    return (
      <Block label="Respond by">
        <p className="m-0 text-13 text-dim">{isSla ? "Claim by" : "Respond by"}</p>
        <p className="figure m-0 text-20 font-semibold tracking-[-0.01em]">{formatDate(detail.recover_by)}</p>
        <p className={cn("m-0 text-13", isUrgent(days) ? "font-medium text-amber-ink" : "text-dim")}>
          {closed ? "Window closed" : days === 0 ? "Last day" : days === 1 ? "1 day left" : `${days} days left`}
        </p>
        {closed && !isSla && <p className="m-0 mt-2 text-13 text-dim">Too late for a card dispute. The vendor can still refund you directly.</p>}
      </Block>
    );
  }
  const waiting = detail.status === "sent" || detail.status === "vendor_agreed";
  return (
    <Block label="Status">
      <p className="m-0 text-16 font-semibold">{waiting ? "Waiting on the vendor" : detail.status === "dismissed" ? "Dismissed" : "Window closed"}</p>
      <p className="m-0 text-13 text-dim">
        {detail.status === "vendor_agreed"
          ? "They agreed to refund it. It closes when the credit posts."
          : detail.status === "sent"
            ? "Recoup watches the inbox and the ledger."
            : detail.status === "dismissed"
              ? "The reason is in the history."
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
            <span aria-label={`Card ending ${card}`}>
              <span aria-hidden className="tracking-[0.12em] text-dim">
                ····
              </span>{" "}
              <span aria-hidden className="ref">
                {card}
              </span>
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

/** A line above the action only where it stops a mistake. */
function caution(detail: FindingDetail, hasDraft: boolean): string | null {
  if (hasDraft) return null;
  if (detail.next_action.kind === "draft" && needsCustomerConfirmation(detail.leak_type, detail.reason))
    return "Check the outage hit you, and that your order form has these terms, before you ask.";
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
  const { kind } = detail.next_action;
  const canDraft = !openDraft && kind in DRAFT_LABEL;
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
            <Button variant="primary" size="lg" onClick={onReview} className={cn("w-full", isReviewing && "invisible")}>
              Review and send
            </Button>
          )}
          {canDraft && (
            <Button variant="primary" size="lg" onClick={onDraft} isBusy={isBusy} busyLabel="Drafting…" className="w-full">
              {DRAFT_LABEL[kind]}
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
                Dismiss case
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

/** The right rail: one bordered block with the deadline, the facts, and the one action. */
export function CaseRail(props: ActionsProps & { className?: string }) {
  return (
    <aside aria-label="Case sidebar" className={cn("flex min-w-0 flex-col rounded-md border border-line bg-paper", props.className)}>
      <Standing detail={props.detail} />
      <Details detail={props.detail} />
      <Actions {...props} />
    </aside>
  );
}
