import type { FindingDetail } from "../../api";
import { daysLeftLabel, formatDate, formatMoney } from "../../format";
import { COLORS, FONTS, LEAK_LABEL, card, eyebrow, mono } from "../../theme";
import { Button } from "../Button";
import { DeadlinePill, OutcomeChip, StatusChip } from "../Chip";
import { isUrgent } from "../Queue";
import { ActionPanel } from "./ActionPanel";
import { AuditTrail } from "./AuditTrail";
import { Correspondence } from "./Correspondence";
import { DraftEditor } from "./DraftEditor";
import { Evidence } from "./Evidence";
import { Section } from "./Section";
import { Timeline } from "./Timeline";

export interface CaseActions {
  onDraft: () => void;
  onDismiss: (reason: string) => void;
  onSave: (draftId: number, subject: string, body: string) => Promise<void>;
  onSend: (draftId: number) => Promise<void>;
}

interface Props extends CaseActions {
  detail: FindingDetail;
  isBusy: boolean;
  onBack?: () => void;
}

function Amount({ detail }: { detail: FindingDetail }) {
  const isRecovered = detail.status === "recovered" && detail.recovered_minor !== null;
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
      <span style={{ fontFamily: FONTS.serif, fontSize: 44, lineHeight: 1.1, color: isRecovered ? COLORS.good : COLORS.ink }}>
        {formatMoney(isRecovered ? (detail.recovered_minor as number) : detail.amount_minor, detail.currency)}
      </span>
      {isRecovered && <span style={{ ...mono, color: COLORS.good }}>back in the account</span>}
    </div>
  );
}

export function CaseView({ detail, isBusy, onBack, onDraft, onDismiss, onSave, onSend }: Props) {
  const openDraft = detail.drafts.find((d) => d.status === "draft");
  const deadline = daysLeftLabel(detail.days_left);
  return (
    <article aria-label={`${detail.merchant} case`} style={{ ...card, padding: "22px 24px 26px" }}>
      {onBack && (
        <div style={{ marginBottom: 12 }}>
          <Button variant="ghost" size="sm" onClick={onBack}>
            ‹ All cases
          </Button>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={eyebrow}>{LEAK_LABEL[detail.leak_type]}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <OutcomeChip outcome={detail.outcome} />
          <StatusChip status={detail.status} />
        </div>
      </div>
      <h2 style={{ fontFamily: FONTS.serif, fontSize: 30, fontWeight: 500, margin: "6px 0 0" }}>{detail.merchant}</h2>
      <Amount detail={detail} />
      {detail.recover_by && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
          <span style={mono}>
            {detail.leak_type === "sla_credit" ? "Claim credit by" : "Card dispute deadline"}{" "}
            {formatDate(detail.recover_by)}
          </span>
          {deadline && <DeadlinePill label={deadline} isUrgent={isUrgent(detail.days_left)} />}
          {detail.days_left !== null && detail.days_left < 0 && detail.leak_type !== "sla_credit" && (
            <span style={{ ...mono, color: COLORS.inkDim }}>· the vendor can still refund you directly</span>
          )}
        </div>
      )}

      <p style={{ fontFamily: FONTS.serif, fontSize: 19, lineHeight: 1.5, color: COLORS.ink, margin: "18px 0 0" }}>
        {detail.reason}
      </p>

      <ActionPanel detail={detail} isBusy={isBusy} onDraft={onDraft} onDismiss={onDismiss} />

      {openDraft && (
        <Section title="Draft">
          <DraftEditor
            draft={openDraft}
            isBusy={isBusy}
            onSave={(subject, body) => onSave(openDraft.id, subject, body)}
            onSend={() => onSend(openDraft.id)}
          />
        </Section>
      )}

      <Section title="Story">
        <Timeline events={detail.timeline} />
      </Section>

      <Section title="Evidence">
        <Evidence evidence={detail.evidence} transactions={detail.transactions} />
      </Section>

      {(detail.emails.length > 0 || detail.drafts.some((d) => d.status === "sent")) && (
        <Section title="Correspondence">
          <Correspondence emails={detail.emails} drafts={detail.drafts} />
        </Section>
      )}

      <Section title="Audit trail">
        <AuditTrail trace={detail.trace} />
      </Section>
    </article>
  );
}
