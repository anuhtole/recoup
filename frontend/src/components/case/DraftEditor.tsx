import { useEffect, useState } from "react";
import type { Draft } from "../../api";
import { COLORS, FONTS, card, mono } from "../../theme";
import { Button } from "../Button";
import { ConfirmDialog } from "../ConfirmDialog";

interface Props {
  draft: Draft;
  isBusy: boolean;
  onSave: (subject: string, body: string) => Promise<void>;
  onSend: () => Promise<void>;
}

const field = {
  width: "100%",
  boxSizing: "border-box" as const,
  fontFamily: FONTS.serif,
  fontSize: 16,
  color: COLORS.ink,
  padding: "9px 11px",
  borderRadius: 8,
  border: `1px solid ${COLORS.borderStrong}`,
  background: COLORS.surface,
};

export function DraftEditor({ draft, isBusy, onSave, onSend }: Props) {
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    setSubject(draft.subject);
    setBody(draft.body);
  }, [draft.id, draft.subject, draft.body]);

  const isDirty = subject !== draft.subject || body !== draft.body;
  const isDispute = draft.channel === "card_dispute";

  const approve = async () => {
    if (isDirty) await onSave(subject, body);
    await onSend();
    setIsConfirming(false);
  };

  return (
    <div style={{ ...card, padding: 16, background: COLORS.sunken }}>
      <div style={{ display: "grid", gridTemplateColumns: "64px 1fr", gap: "8px 10px", alignItems: "center" }}>
        <span style={mono}>To</span>
        <span style={{ ...mono, color: COLORS.ink }}>
          {draft.to_addr}{" "}
          <span style={{ color: COLORS.inkDim }}>
            · {isDispute ? "card dispute desk" : "from your vendor directory"}
          </span>
        </span>
        <label htmlFor="draft-subject" style={mono}>
          Subject
        </label>
        <input id="draft-subject" value={subject} onChange={(e) => setSubject(e.target.value)} style={field} />
      </div>
      <textarea
        aria-label="Message"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={Math.min(18, Math.max(8, body.split("\n").length + 1))}
        style={{ ...field, marginTop: 10, lineHeight: 1.45, resize: "vertical" }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
        <span style={{ ...mono, color: COLORS.inkDim }}>Written by {draft.drafter}</span>
        <div style={{ display: "flex", gap: 8 }}>
          <Button onClick={() => void onSave(subject, body)} disabled={!isDirty} isBusy={isBusy && !isConfirming}>
            Save edits
          </Button>
          <Button variant="primary" onClick={() => setIsConfirming(true)} disabled={!subject.trim() || !body.trim()}>
            Approve and send
          </Button>
        </div>
      </div>
      {isConfirming && (
        <ConfirmDialog
          title={isDispute ? "File this dispute?" : "Send this request?"}
          confirmLabel={isDispute ? "File dispute" : "Send"}
          isBusy={isBusy}
          onCancel={() => setIsConfirming(false)}
          onConfirm={() => void approve()}
        >
          It goes to <strong style={{ fontFamily: FONTS.mono, fontSize: 14 }}>{draft.to_addr}</strong> exactly as
          written. Recoup never contacts anyone without this approval, and it is recorded in the audit trail.
        </ConfirmDialog>
      )}
    </div>
  );
}
