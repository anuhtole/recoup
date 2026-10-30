import { useEffect, useRef } from "react";
import type { Email } from "../../api";
import { formatDateTime } from "../../format";
import { Sheet } from "../Sheet";
import { findQuote, type VendorQuote } from "./cite";

interface Props {
  email: Email;
  quote: VendorQuote;
  onClose: () => void;
}

/** The vendor's original email, scrolled to the quoted sentence, which is highlighted. */
export function EmailSheet({ email, quote, onClose }: Props) {
  const mark = useRef<HTMLElement>(null);
  const range = findQuote(email.body, quote.quote);

  useEffect(() => {
    // After the sheet starts rising, bring the quote to the middle of the scroll area.
    const timer = window.setTimeout(() => mark.current?.scrollIntoView({ block: "center" }), 60);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <Sheet labelId="email-sheet-title" title={email.subject} subtitle={`From ${email.from_addr} · ${formatDateTime(email.sent_at)}`} onClose={onClose}>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-2">
        <div className="whitespace-pre-wrap rounded-card bg-tint px-5 py-4 text-[15px] leading-relaxed shadow-[inset_0_0_0_1px_var(--line)]">
          {range ? (
            <>
              {email.body.slice(0, range.start)}
              <mark ref={mark} className="rounded-[4px] bg-mark px-0.5 text-ink [box-decoration-break:clone]">
                {email.body.slice(range.start, range.end)}
              </mark>
              {email.body.slice(range.end)}
            </>
          ) : (
            email.body
          )}
        </div>
      </div>
      <p className="px-6 pb-6 pt-3 text-[13px] text-dim">
        {range
          ? "The highlighted sentence is the quote Recoup relies on, checked word for word against this email."
          : "Recoup checked the quote word for word against this email."}
      </p>
    </Sheet>
  );
}
