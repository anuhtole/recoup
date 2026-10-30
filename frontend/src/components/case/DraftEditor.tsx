import { useEffect, useState } from "react";
import type { Draft } from "../../api";
import { Button } from "../Button";

interface Props {
  draft: Draft;
  isBusy: boolean;
  onSave: (subject: string, body: string) => Promise<void>;
  /** Opens the confirm sheet with what is in the editor now. Nothing is sent from here. */
  onApprove: (subject: string, body: string) => void;
}

const FIELD =
  "w-full rounded-row bg-field px-3.5 text-[15px] text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] transition-shadow focus-visible:outline-2 focus-visible:outline-accent";

export function DraftEditor({ draft, isBusy, onSave, onApprove }: Props) {
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);

  useEffect(() => {
    setSubject(draft.subject);
    setBody(draft.body);
  }, [draft.id, draft.subject, draft.body]);

  const isDirty = subject !== draft.subject || body !== draft.body;
  const isDispute = draft.channel === "card_dispute";

  return (
    <div className="flex flex-col gap-4 rounded-card bg-tint p-5 shadow-[inset_0_0_0_1px_var(--line)]">
      <div className="flex flex-col gap-1">
        <span className="text-[13px] text-dim">To</span>
        <p className="flex flex-wrap items-baseline gap-x-2 text-[15px]">
          <span className="font-medium">{draft.to_addr}</span>
          <span className="text-[13px] text-dim">{isDispute ? "card dispute desk" : "from your vendor directory"}</span>
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="draft-subject" className="text-[13px] text-dim">
          Subject
        </label>
        <input id="draft-subject" value={subject} onChange={(e) => setSubject(e.target.value)} className={`${FIELD} h-11`} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="draft-body" className="text-[13px] text-dim">
          Message
        </label>
        <textarea
          id="draft-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={Math.min(16, Math.max(8, body.split("\n").length + 1))}
          className={`${FIELD} resize-y py-3 leading-relaxed`}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          variant="primary"
          onClick={() => onApprove(subject, body)}
          disabled={!subject.trim() || !body.trim()}
        >
          {isDispute ? "Approve and file" : "Approve and send"}
        </Button>
        <Button onClick={() => void onSave(subject, body).catch(() => undefined)} disabled={!isDirty} isBusy={isBusy}>
          Save edits
        </Button>
        {isDirty && <span className="text-[13px] text-dim">Unsaved edits are saved when you approve.</span>}
      </div>
    </div>
  );
}
