import { useRef } from "react";
import type { Draft } from "../../api";
import SlideToConfirm from "../kokonutui/slide-to-confirm";
import { Sheet } from "../Sheet";

// Long enough to read "Sent" on the slider (it holds the spinner for at least 800ms).
const CLOSE_AFTER_DONE_MS = 1400;

interface Props {
  draft: Draft;
  subject: string;
  /** Saves pending edits, then sends with confirm=true. Rejects if either fails. */
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

/**
 * The human approval. Sliding to the end (or Enter, then Enter again) is the explicit confirm step;
 * nothing is sent without it.
 */
export function ConfirmSheet({ draft, subject, onConfirm, onClose }: Props) {
  const thumb = useRef<HTMLButtonElement>(null);
  const isDispute = draft.channel === "card_dispute";
  return (
    <Sheet labelId="confirm-title" title={isDispute ? "File this dispute?" : "Send this request?"} onClose={onClose} initialFocus={thumb}>
      <div className="flex flex-col gap-6 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3">
        <div className="flex flex-col gap-1">
          <p className="text-[13px] text-dim">Sends to</p>
          <p className="figure break-all text-[22px] leading-tight tracking-[-0.02em]">{draft.to_addr}</p>
          <p className="mt-1 truncate text-sm text-dim">{subject}</p>
        </div>
        <p className="text-sm leading-relaxed text-dim">
          It goes exactly as written. Recoup never contacts anyone without this approval, and it is recorded in the
          history.
        </p>
        <SlideToConfirm
          thumbRef={thumb}
          label={isDispute ? "Slide to file the dispute" : "Slide to send"}
          armedLabel={isDispute ? "Press Enter again to file" : "Press Enter again to send"}
          confirmingLabel={isDispute ? "Filing" : "Sending"}
          doneLabel={isDispute ? "Filed" : "Sent"}
          resetAfter={null}
          onConfirm={async () => {
            await onConfirm();
            window.setTimeout(onClose, CLOSE_AFTER_DONE_MS);
          }}
        />
      </div>
    </Sheet>
  );
}
