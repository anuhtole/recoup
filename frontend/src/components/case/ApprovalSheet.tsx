import { Lock } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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

/** The message, whole: it scrolls when it is longer than the box, with a fade so nothing reads as cut off. */
function Letter({ subject, body }: { subject: string; body: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const measure = useCallback(() => {
    const el = box.current;
    if (el) setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  }, []);
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure, body]);
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <p className="m-0 text-13 text-dim">Message</p>
      <div className="relative">
        <div
          ref={box}
          onScroll={measure}
          tabIndex={0}
          aria-label="Message preview"
          className="max-h-[min(20rem,32dvh)] overflow-y-auto rounded-sm border border-line bg-wash px-4 py-3"
        >
          <p className="m-0 text-14 font-medium">{subject}</p>
          <p className="m-0 mt-2 whitespace-pre-wrap text-13 leading-6 text-ink">{body}</p>
        </div>
        {more && <div aria-hidden className="pointer-events-none absolute inset-x-px bottom-px h-12 rounded-b-sm bg-gradient-to-t from-wash to-transparent" />}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 py-3">
      <dt className="text-13 text-dim">{label}</dt>
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
      onClose={onClose}
      initialFocus={thumb}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-5 pt-3">
        <div className="flex flex-col gap-1">
          <p className="m-0 text-13 text-dim">To</p>
          <p className="m-0 break-all text-20 font-medium tracking-[-0.01em]">{draft.to_addr}</p>
          <p className="m-0 text-13 text-dim">{isDispute ? "Your card issuer's dispute desk" : `${vendor} billing`}</p>
        </div>
        <dl className="m-0 grid grid-cols-3 gap-x-4 border-y border-line">
          <Row label="Amount">
            <span className="figure font-semibold">{formatMoney(amountMinor, currency)}</span>
          </Row>
          <Row label="Reference">
            <span className="ref">{reference ?? "—"}</span>
          </Row>
          <Row label="Sent as">{isDispute ? "Card dispute" : "Email"}</Row>
        </dl>
        <Letter subject={subject} body={body} />
      </div>
      <div className="on-ink flex flex-col gap-3 bg-panel px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
        {/* In the footer, next to the slider, so the irreversibility is never scrolled out of view. */}
        <p className="m-0 flex items-start gap-2 text-13 text-sub">
          <Lock aria-hidden className="mt-0.5 size-3.5 flex-none text-mint" strokeWidth={2} />
          <span>
            <span className="font-medium text-white">This can't be edited after it's sent.</span>
          </span>
        </p>
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
      </div>
    </Sheet>
  );
}
