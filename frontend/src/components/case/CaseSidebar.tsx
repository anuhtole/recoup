import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { Draft, FindingDetail } from "../../api";
import { daysWord, formatDate, formatMoney } from "../../format";
import { SPRING } from "../../motion";
import { isUrgent, LEAK_LABEL, statusOf } from "../../theme";
import { cn } from "@/lib/utils";
import { Button } from "../Button";
import { Pill } from "../ui";
import { needsCustomerConfirmation } from "./cite";

const WINDOW_TICKS = 30;

/** The decisive number: how long is left to claim. Missed means lost. */
export function RespondBy({ detail }: { detail: FindingDetail }) {
  const live = ["open", "drafted", "info_requested", "vendor_declined"].includes(detail.status);
  if (detail.status === "recovered") {
    return (
      <section aria-label="Recovered" className="card flex flex-col gap-2 p-5">
        <p className="label m-0 text-mint-ink">Recovered</p>
        <p className="figure m-0 text-28 font-semibold tracking-[-0.03em] text-mint-ink">
          +{formatMoney(detail.recovered_minor ?? detail.amount_minor, detail.currency)}
        </p>
        <p className="m-0 text-13 text-dim">Back in the account, confirmed in the ledger.</p>
      </section>
    );
  }
  if (!live || !detail.recover_by || detail.days_left === null) {
    const waiting = ["sent", "vendor_agreed"].includes(detail.status);
    return (
      <section aria-label="Status" className="card flex flex-col gap-2 p-5">
        <p className="label m-0 text-dim">{waiting ? "Waiting on the vendor" : "Closed"}</p>
        <p className="m-0 text-16 font-medium">
          {detail.status === "vendor_agreed"
            ? "They agreed to refund it."
            : detail.status === "sent"
              ? "Request sent. Recoup watches the inbox and ledger."
              : detail.status === "dismissed"
                ? "Dismissed. The reason is in the history."
                : "The claim window closed."}
        </p>
      </section>
    );
  }
  const days = detail.days_left;
  const closed = days < 0;
  const urgent = isUrgent(days);
  const filled = closed ? 0 : Math.min(days, WINDOW_TICKS);
  const isSla = detail.leak_type === "sla_credit";
  return (
    <section aria-label="Respond by" className={cn("card flex flex-col gap-3 p-5", urgent && "border-amber")}>
      <div className="flex items-baseline justify-between gap-3">
        <p className={cn("label m-0", urgent ? "text-amber-ink" : "text-dim")}>{isSla ? "Claim by" : "Respond by"}</p>
        <p className="ref m-0 text-13 uppercase">{formatDate(detail.recover_by)}</p>
      </div>
      <p className={cn("figure m-0 text-28 font-semibold tracking-[-0.03em]", closed ? "text-dim" : urgent ? "text-amber-ink" : "text-ink")}>
        {closed ? "Window closed" : days === 0 ? "Last day" : `${daysWord(days)} left`}
      </p>
      <div aria-hidden className="flex h-3 items-end gap-[3px]">
        {Array.from({ length: WINDOW_TICKS }, (_, i) => (
          <span
            key={i}
            className={cn("w-full rounded-[1px]", i < filled ? (urgent ? "h-3 bg-amber" : "h-3 bg-ink") : "h-2 bg-line")}
          />
        ))}
      </div>
      <p className="m-0 text-13 text-dim">
        {closed
          ? isSla
            ? "The claim window has closed."
            : "The card dispute window has passed. The vendor can still refund you directly."
          : isSla
            ? "After this date the contract no longer owes the credit."
            : "After this date your card issuer won't reverse the charge."}
      </p>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line py-2.5 last:border-b-0">
      <dt className="label text-dim">{label}</dt>
      <dd className="m-0 min-w-0 truncate text-right text-13">{children}</dd>
    </div>
  );
}

export function Facts({ detail, reference }: { detail: FindingDetail; reference: string | null }) {
  const status = statusOf(detail);
  const card = detail.transactions.find((t) => t.card_last4)?.card_last4;
  // The demo clock's date it was flagged, not the wall-clock row time.
  const found = detail.timeline.find((e) => e.kind === "detected")?.at ?? detail.created_at;
  return (
    <section aria-label="Facts" className="card px-5 py-2">
      <dl className="m-0">
        <Fact label="Status">
          <Pill label={status.label} tone={status.tone} />
        </Fact>
        <Fact label="Reference">
          <span className="ref">{reference ?? "—"}</span>
        </Fact>
        <Fact label="Vendor">{detail.merchant}</Fact>
        <Fact label="Type">{LEAK_LABEL[detail.leak_type]}</Fact>
        <Fact label="Found on">
          <span className="ref uppercase">{formatDate(found)}</span>
        </Fact>
        {card && (
          <Fact label="Card">
            <span className="ref">•••• {card}</span>
          </Fact>
        )}
      </dl>
    </section>
  );
}

const DRAFT_LABEL: Record<string, string> = {
  draft: "Draft request",
  follow_up: "Draft follow-up",
  escalate: "Draft card dispute",
};

const HINT: Record<string, string> = {
  draft: "Recoup writes it from the evidence. Nothing is sent until you approve it.",
  follow_up: "The vendor needs more from you, or has gone quiet.",
  escalate: "The vendor said no. Your card issuer can still reverse the charge.",
  review: "Read the draft, edit anything, then approve it.",
  wait: "This closes by itself the moment the credit appears in your ledger.",
  none: "",
};

interface NextStepProps {
  detail: FindingDetail;
  openDraft: Draft | undefined;
  isBusy: boolean;
  onDraft: () => void;
  onReview: () => void;
  onDismiss: (reason: string) => void;
}

/** The ink next-step panel: what to do, the one mint action, and the way out. */
export function NextStep({ detail, openDraft, isBusy, onDraft, onReview, onDismiss }: NextStepProps) {
  const [isDismissing, setIsDismissing] = useState(false);
  const [reason, setReason] = useState("");
  const { kind } = detail.next_action;
  const confirmFirst = kind === "draft" && needsCustomerConfirmation(detail.leak_type, detail.reason);
  const label = openDraft
    ? `Approve and send the ${openDraft.channel === "card_dispute" ? "dispute" : "request"}`
    : confirmFirst
      ? "Confirm you were affected, then draft a request"
      : detail.next_action.label;
  const hint = openDraft
    ? "Review it once more on the next screen, then slide to send."
    : confirmFirst
      ? "The outage is on the vendor's public status page. Check it hit you, and that your order form has these terms, before you ask."
      : HINT[kind];
  const canDraft = !openDraft && kind in DRAFT_LABEL;
  const canDismiss = !["recovered", "dismissed", "expired"].includes(detail.status);

  return (
    <section aria-label="Next step" className="on-ink flex flex-col gap-4 rounded-md bg-panel p-5 text-white">
      <div className="flex flex-col gap-1.5">
        <p className="label m-0 text-sub">{kind === "none" && !openDraft ? "Status" : "Next step"}</p>
        <p className="m-0 text-16 font-medium tracking-[-0.01em]">{label}</p>
        {hint && <p className="m-0 text-13 text-sub">{hint}</p>}
      </div>
      {(openDraft || canDraft || canDismiss) && !isDismissing && (
        <div className="flex flex-col gap-2">
          {openDraft && (
            <Button variant="primary" size="lg" onClick={onReview} className="w-full" aria-label={`Send to ${openDraft.to_addr} · ${formatMoney(detail.amount_minor, detail.currency)}`}>
              <span className="min-w-0 truncate">
                Send to <span className="ref text-14">{openDraft.to_addr}</span>
              </span>
              <span aria-hidden className="text-ink/40">·</span>
              <span className="figure flex-none">{formatMoney(detail.amount_minor, detail.currency)}</span>
            </Button>
          )}
          {canDraft && (
            <Button variant="primary" size="lg" onClick={onDraft} isBusy={isBusy} busyLabel="Drafting…" className="w-full">
              {DRAFT_LABEL[kind]}
            </Button>
          )}
          {canDismiss && (
            <Button variant="ink-ghost" onClick={() => setIsDismissing(true)} className="w-full">
              Not owed, dismiss
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
            className="flex flex-col gap-3"
          >
            <label htmlFor="dismiss-reason" className="text-13 text-sub">
              Why is this not owed? The reason is kept in the history.
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
              placeholder="For example: a separate order"
              maxLength={500}
              className="h-10 w-full rounded-xs border border-rule bg-panel-2 px-3 text-14 text-white placeholder:text-sub focus-visible:border-mint focus-visible:outline-none"
            />
            <div className="flex gap-2">
              <Button type="submit" variant="ink" disabled={!reason.trim()} isBusy={isBusy} className="flex-1">
                Dismiss case
              </Button>
              <Button variant="ink-ghost" onClick={() => setIsDismissing(false)}>
                Cancel
              </Button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </section>
  );
}
