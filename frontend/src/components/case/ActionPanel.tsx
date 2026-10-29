import { useState } from "react";
import type { FindingDetail } from "../../api";
import { COLORS, FONTS } from "../../theme";
import { Button } from "../Button";

interface Props {
  detail: FindingDetail;
  isBusy: boolean;
  onDraft: () => void;
  onDismiss: (reason: string) => void;
}

const DRAFT_LABEL: Record<string, string> = {
  draft: "Draft recovery request",
  follow_up: "Draft follow-up",
  escalate: "Draft card dispute",
};

const HINT: Record<string, string> = {
  draft: "Recoup writes it from the evidence. Nothing is sent until you approve it.",
  follow_up: "The vendor needs more from you, or has gone quiet.",
  escalate: "The vendor said no. Your card issuer can still reverse the charge.",
  review: "Check the draft below, edit anything, then approve it.",
  wait: "Recoup will close this the moment the credit appears in your ledger.",
  none: "",
};

export function ActionPanel({ detail, isBusy, onDraft, onDismiss }: Props) {
  const [isDismissing, setIsDismissing] = useState(false);
  const [reason, setReason] = useState("");
  const { kind, label } = detail.next_action;
  const canDraft = kind in DRAFT_LABEL;
  const canDismiss = !["recovered", "dismissed", "expired"].includes(detail.status);

  return (
    <div
      style={{
        marginTop: 20,
        padding: "14px 16px",
        borderRadius: 10,
        background: kind === "none" ? COLORS.sunken : COLORS.accentSoft,
        border: `1px solid ${kind === "none" ? COLORS.border : "#CFE5F0"}`,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.accentInk, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Next step
          </div>
          <div style={{ fontFamily: FONTS.serif, fontSize: 19, color: COLORS.ink }}>{label}</div>
          {HINT[kind] && (
            <div style={{ fontFamily: FONTS.serif, fontSize: 15, color: COLORS.inkSoft, marginTop: 2 }}>{HINT[kind]}</div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", marginLeft: "auto" }}>
          {canDismiss && !isDismissing && (
            <Button variant="ghost" onClick={() => setIsDismissing(true)}>
              Dismiss
            </Button>
          )}
          {canDraft && (
            <Button variant="primary" onClick={onDraft} isBusy={isBusy}>
              {DRAFT_LABEL[kind]}
            </Button>
          )}
        </div>
      </div>
      {isDismissing && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (reason.trim()) onDismiss(reason.trim());
          }}
          style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}
        >
          <input
            autoFocus
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why close this case? (kept in the audit trail)"
            aria-label="Reason for dismissing"
            maxLength={500}
            style={{
              flex: "1 1 240px",
              fontFamily: FONTS.serif,
              fontSize: 16,
              padding: "8px 10px",
              borderRadius: 8,
              border: `1px solid ${COLORS.borderStrong}`,
            }}
          />
          <Button variant="ghost" onClick={() => setIsDismissing(false)}>
            Cancel
          </Button>
          <Button variant="danger" type="submit" disabled={!reason.trim()} isBusy={isBusy}>
            Dismiss case
          </Button>
        </form>
      )}
    </div>
  );
}
