import type { Draft } from "../../api";
import { Button } from "../Button";

interface Props {
  draft: Draft;
  subject: string;
  body: string;
  onChange: (next: { subject: string; body: string }) => void;
  isBusy: boolean;
  onSave: () => void;
}

const FIELD =
  "w-full rounded-xs border border-line-strong bg-paper px-3 text-14 text-ink transition-colors hover:border-dim focus-visible:border-ink focus-visible:outline-none";

/** The draft, editable in place. Sending happens from the next-step panel, after a review sheet. */
export function DraftEditor({ draft, subject, body, onChange, isBusy, onSave }: Props) {
  const isDirty = subject !== draft.subject || body !== draft.body;
  const isDispute = draft.channel === "card_dispute";
  return (
    <section aria-label="Draft" className="card">
      <header className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line px-5 py-2">
        <h2 className="m-0 text-14 font-semibold tracking-[-0.01em]">{isDispute ? "Draft dispute" : "Draft request"}</h2>
        <span className="label text-dim">{isDispute ? "Card dispute desk" : "Vendor email"} · not sent</span>
      </header>
      <div className="flex flex-col gap-4 px-5 py-4">
        <div className="field-box flex flex-col gap-1 px-3 py-2">
          <span className="label text-dim">To</span>
          <span className="ref truncate text-14">{draft.to_addr}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="draft-subject" className="label text-dim">
            Subject
          </label>
          <input id="draft-subject" value={subject} onChange={(e) => onChange({ subject: e.target.value, body })} className={`${FIELD} h-10`} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="draft-body" className="label text-dim">
            Message
          </label>
          <textarea
            id="draft-body"
            value={body}
            onChange={(e) => onChange({ subject, body: e.target.value })}
            rows={Math.max(8, body.split("\n").length + 2)}
            className={`${FIELD} resize-y py-2.5 leading-6 [field-sizing:content]`}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={onSave} disabled={!isDirty} isBusy={isBusy}>
            Save edits
          </Button>
          <span className="text-13 text-dim">{isDirty ? "Unsaved edits are saved when you send." : "Saved. Nothing goes out until you approve it."}</span>
        </div>
      </div>
    </section>
  );
}
