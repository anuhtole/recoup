import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { FindingDetail } from "../../api";
import { SPRING } from "../../motion";
import { Button } from "../Button";

interface Props {
  detail: FindingDetail;
  isBusy: boolean;
  onDraft: () => void;
  onDismiss: (reason: string) => void;
}

const DRAFT_LABEL: Record<string, string> = {
  draft: "Draft request",
  follow_up: "Draft follow-up",
  escalate: "Draft card dispute",
};

const HINT: Record<string, string> = {
  draft: "Recoup writes it from the evidence below. Nothing is sent until you approve it.",
  follow_up: "The vendor needs more from you, or has gone quiet.",
  escalate: "The vendor said no. Your card issuer can still reverse the charge.",
  review: "Read the draft below, edit anything, then approve it.",
  wait: "This closes by itself the moment the credit appears in your ledger.",
  none: "",
};

/** The one next step, with the case's single primary action. */
export function ActionPanel({ detail, isBusy, onDraft, onDismiss }: Props) {
  const [isDismissing, setIsDismissing] = useState(false);
  const [reason, setReason] = useState("");
  const { kind, label } = detail.next_action;
  const canDraft = kind in DRAFT_LABEL;
  const canDismiss = !["recovered", "dismissed", "expired"].includes(detail.status);

  if (kind === "none" && !canDismiss) {
    return (
      <div className="rounded-card bg-tint px-5 py-4 shadow-[inset_0_0_0_1px_var(--line)]">
        <p className="text-[13px] text-dim">Status</p>
        <p className="mt-0.5 text-[15px] font-medium">{label}</p>
      </div>
    );
  }

  return (
    <div className="rounded-card bg-tint px-5 py-5 shadow-[inset_0_0_0_1px_var(--line)]">
      <p className="text-[13px] text-dim">Next step</p>
      <p className="mt-0.5 text-[17px] font-medium tracking-[-0.01em]">{label}</p>
      {HINT[kind] && <p className="mt-1 max-w-[60ch] text-sm leading-relaxed text-dim">{HINT[kind]}</p>}

      {(canDraft || canDismiss) && !isDismissing && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {canDraft && (
            <Button variant="primary" onClick={onDraft} isBusy={isBusy}>
              {DRAFT_LABEL[kind]}
            </Button>
          )}
          {canDismiss && (
            <Button variant={canDraft ? "ghost" : "secondary"} onClick={() => setIsDismissing(true)}>
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
            className="mt-4 flex flex-col gap-3"
          >
            <label htmlFor="dismiss-reason" className="text-[13px] text-dim">
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
              placeholder="For example: the second charge was a separate order"
              maxLength={500}
              className="h-11 w-full rounded-row bg-field px-3.5 text-[15px] text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] placeholder:text-dim focus-visible:outline-2 focus-visible:outline-accent"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={!reason.trim()} isBusy={isBusy}>
                Dismiss case
              </Button>
              <Button variant="ghost" onClick={() => setIsDismissing(false)}>
                Cancel
              </Button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
