import { useRef } from "react";
import type { Draft } from "../../api";
import SlideToConfirm from "../kokonutui/slide-to-confirm";
import { Sheet } from "../Sheet";

// Long enough to read "Sent" on the slider (it holds the spinner for at least 800ms).
const CLOSE_AFTER_DONE_MS = 900;

interface Props {
  draft: Draft;
  subject: string;
  /** Saves pending edits, then sends with confirm=true. Rejects if either fails. */
  onConfirm: () => Promise<void>;
  /** Called once the sheet has shown "Sent" and closed. */
  onSent: () => void;
  onClose: () => void;
  /** Sample data: the address is fictional and the message stays in Recoup's local outbox. */
  isDemo: boolean;
}

/**
 * The human approval. Sliding to the end (or Enter, then Enter again) is the explicit confirm step;
 * nothing is sent without it.
 */
export function ConfirmSheet({ draft, subject, onConfirm, onSent, onClose, isDemo }: Props) {
  const thumb = useRef<HTMLButtonElement>(null);
  const isDispute = draft.channel === "card_dispute";
  return (
    <Sheet labelId="confirm-title" title={isDispute ? "Send this dispute?" : "Send this request?"} onClose={onClose} initialFocus={thumb}>
      <div className="flex flex-col gap-6 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3">
        <div className="flex flex-col gap-1">
          <p className="text-14 text-dim">Sends to</p>
          <p className="break-all text-20 font-semibold tracking-[-0.02em]">{draft.to_addr}</p>
          <p className="mt-1 truncate text-14 text-dim">{subject}</p>
        </div>
        <p className="text-14 text-dim">
          It goes exactly as written. Recoup never contacts anyone without this approval, and it is recorded in the
          history.
        </p>
        {isDemo && (
          <p className="rounded-card bg-tint px-4 py-3 text-14 text-dim">
            <span className="font-medium text-ink">Demo.</span> This is sample data, so the message is recorded in
            Recoup&rsquo;s outbox and no email leaves this machine.
          </p>
        )}
        <SlideToConfirm
          thumbRef={thumb}
          label="Slide to send"
          armedLabel="Press Enter again to send"
          confirmingLabel="Sending"
          doneLabel="Sent"
          resetAfter={null}
          onConfirm={async () => {
            await onConfirm();
            window.setTimeout(onSent, CLOSE_AFTER_DONE_MS);
          }}
        />
      </div>
    </Sheet>
  );
}
