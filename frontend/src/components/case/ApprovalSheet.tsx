import { Lock } from "lucide-react";
import { useRef } from "react";
import type { Draft } from "../../api";
import { formatMoney } from "../../format";
import SlideToConfirm from "../kokonutui/slide-to-confirm";
import { Sheet } from "../Sheet";

// Long enough to read "Sent" on the slider (it holds the spinner for at least 800ms).
const CLOSE_AFTER_DONE_MS = 1400;

interface Props {
  draft: Draft;
  subject: string;
  body: string;
  amountMinor: number;
  currency: string;
  reference: string | null;
  vendor: string;
  /** Saves pending edits, then sends with confirm=true. Rejects if either fails. */
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 py-3">
      <dt className="label text-dim">{label}</dt>
      <dd className="m-0 min-w-0 truncate text-14">{children}</dd>
    </div>
  );
}

/**
 * The human approval, as an approval card: who it goes to, for how much, and exactly what it says.
 * Sliding to the end (or Enter, then Enter again) is the explicit confirm step; nothing is sent without it.
 */
export function ApprovalSheet({ draft, subject, body, amountMinor, currency, reference, vendor, onConfirm, onClose }: Props) {
  const thumb = useRef<HTMLButtonElement>(null);
  const isDispute = draft.channel === "card_dispute";
  return (
    <Sheet
      labelId="approve-title"
      title={isDispute ? "Approve this dispute" : "Approve this request"}
      subtitle="It goes exactly as written."
      onClose={onClose}
      initialFocus={thumb}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-5 pt-3">
        <div className="flex flex-col gap-1">
          <p className="label m-0 text-dim">Sends to</p>
          <p className="ref m-0 break-all text-20 font-medium tracking-[-0.01em]">{draft.to_addr}</p>
          <p className="m-0 text-13 text-dim">{isDispute ? "Your card issuer's dispute desk" : `${vendor} billing, from your vendor directory`}</p>
        </div>
        <dl className="m-0 grid grid-cols-3 gap-x-4 border-y border-line">
          <Row label="Amount">
            <span className="figure font-semibold">{formatMoney(amountMinor, currency)}</span>
          </Row>
          <Row label="Reference">
            <span className="ref">{reference ?? "—"}</span>
          </Row>
          <Row label="Channel">{isDispute ? "Card dispute" : "Email"}</Row>
        </dl>
        <div className="flex min-h-0 flex-col gap-2">
          <p className="label m-0 text-dim">Letter</p>
          <div className="field-box max-h-56 overflow-y-auto bg-wash px-4 py-3">
            <p className="m-0 text-14 font-medium">{subject}</p>
            <p className="m-0 mt-2 whitespace-pre-wrap text-13 leading-6 text-ink">{body}</p>
          </div>
        </div>
        <p className="m-0 flex items-start gap-2 text-13 text-dim">
          <Lock aria-hidden className="mt-0.5 size-3.5 flex-none" strokeWidth={2} />
          Can't be edited after sending. Recoup never contacts anyone without this approval, and records it in the history.
        </p>
      </div>
      <div className="on-ink flex flex-col gap-2 bg-panel px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
        <SlideToConfirm
          thumbRef={thumb}
          label="Slide to send"
          armedLabel="Press Enter again to send"
          confirmingLabel="Sending"
          doneLabel="Sent"
          resetAfter={null}
          onConfirm={async () => {
            await onConfirm();
            window.setTimeout(onClose, CLOSE_AFTER_DONE_MS);
          }}
        />
        <p className="label m-0 text-center text-sub">Or press Enter twice</p>
      </div>
    </Sheet>
  );
}
