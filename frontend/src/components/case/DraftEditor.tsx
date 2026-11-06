import type { Draft } from "../../api";
import { Button } from "../Button";
import { Section } from "../Section";

interface Props {
  draft: Draft;
  subject: string;
  body: string;
  onChange: (next: { subject: string; body: string }) => void;
  isBusy: boolean;
  onSave: () => void;
}

const FIELD =
  "w-full rounded-sm border border-line-strong bg-paper px-3 text-14 text-ink transition-colors hover:border-dim focus-visible:border-ink focus-visible:outline-none";

/** The draft, editable in place. Sending happens from the rail, after a review sheet. */
export function DraftEditor({ draft, subject, body, onChange, isBusy, onSave }: Props) {
  const isDirty = subject !== draft.subject || body !== draft.body;
  const isDispute = draft.channel === "card_dispute";
  return (
    <Section title={isDispute ? "Draft dispute" : "Draft request"} meta="Not sent">
      <div className="flex flex-col gap-4 pt-4">
        <p className="m-0 flex items-baseline gap-3 text-14">
          <span className="w-16 flex-none text-13 text-dim">To</span>
          <span className="min-w-0 truncate">{draft.to_addr}</span>
        </p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="draft-subject" className="text-13 text-dim">
            Subject
          </label>
          <input id="draft-subject" value={subject} onChange={(e) => onChange({ subject: e.target.value, body })} className={`${FIELD} h-10`} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="draft-body" className="text-13 text-dim">
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
          {isDirty && <span className="text-13 text-dim">Edits are saved when you send.</span>}
        </div>
      </div>
    </Section>
  );
}
