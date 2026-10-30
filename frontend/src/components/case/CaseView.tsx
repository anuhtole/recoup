import { AnimatePresence } from "motion/react";
import { useMemo, useState } from "react";
import type { Draft, Email, FindingDetail } from "../../api";
import { daysLeftLabel, formatDate, formatMoney } from "../../format";
import { LEAK_LABEL } from "../../theme";
import { Deadline, OutcomeChip, StatusChip } from "../Chip";
import { ActionPanel } from "./ActionPanel";
import { Reason } from "./Citations";
import { citeReason, type VendorQuote } from "./cite";
import { ConfirmSheet } from "./ConfirmSheet";
import { Correspondence } from "./Correspondence";
import { DraftEditor } from "./DraftEditor";
import { EmailSheet } from "./EmailSheet";
import { Evidence } from "./Evidence";
import { History } from "./History";
import { Section } from "./Section";

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

function Header({ detail }: { detail: FindingDetail }) {
  const isRecovered = detail.status === "recovered" && detail.recovered_minor !== null;
  const deadline = daysLeftLabel(detail.days_left);
  return (
    <header className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="text-[13px] text-dim">{LEAK_LABEL[detail.leak_type]}</p>
        <div className="flex flex-wrap gap-1.5">
          {detail.status !== "recovered" && <OutcomeChip outcome={detail.outcome} />}
          {detail.status !== "open" && <StatusChip status={detail.status} />}
        </div>
      </div>
      <h2 className="mt-1 text-2xl font-semibold tracking-[-0.02em]">{detail.merchant}</h2>
      <p className={isRecovered ? "figure mt-3 text-[40px] leading-none tracking-[-0.03em] text-money" : "figure mt-3 text-[40px] leading-none tracking-[-0.03em]"}>
        {formatMoney(isRecovered ? (detail.recovered_minor as number) : detail.amount_minor, detail.currency)}
      </p>
      {isRecovered && <p className="mt-2 text-[13px] text-money-ink">Back in the account, confirmed in the ledger</p>}
      {!isRecovered && detail.recover_by && (
        <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13px] text-dim">
          <span>
            {detail.leak_type === "sla_credit" ? "Claim the credit by" : "Card dispute deadline"}{" "}
            <span className="figure">{formatDate(detail.recover_by)}</span>
          </span>
          {deadline && (
            <>
              <span aria-hidden>·</span>
              <Deadline label={deadline} daysLeft={detail.days_left} />
            </>
          )}
          {detail.days_left !== null && detail.days_left < 0 && detail.leak_type !== "sla_credit" && (
            <span>· the vendor can still refund you directly</span>
          )}
        </p>
      )}
    </header>
  );
}

export function CaseView({ detail, isBusy, onBack, onDraft, onDismiss, onSave, onSend }: Props) {
  const [openEmail, setOpenEmail] = useState<{ email: Email; quote: VendorQuote } | null>(null);
  // Held here, not in the editor, so the sheet can show "Sent" after the draft leaves the case.
  const [confirming, setConfirming] = useState<{ draft: Draft; subject: string; body: string } | null>(null);
  const cited = useMemo(() => citeReason(detail), [detail]);
  const openDraft = detail.drafts.find((d) => d.status === "draft");

  return (
    <div className="flex flex-col gap-8 px-5 py-6 sm:px-8 sm:py-8">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="-ml-2 -mt-2 inline-flex h-9 items-center gap-1 self-start rounded-full px-2 text-sm text-dim transition-[transform,background-color,color] duration-150 hover:bg-tint hover:text-ink active:scale-[0.97]"
        >
          <svg viewBox="0 0 16 16" aria-hidden className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 4L6 8l4 4" />
          </svg>
          All cases
        </button>
      )}

      <div className="flex flex-col gap-5">
        <Header detail={detail} />
        <Reason
          cited={cited}
          onOpenEmail={(source) => source.email && setOpenEmail({ email: source.email, quote: source.quote })}
        />
      </div>

      <ActionPanel detail={detail} isBusy={isBusy} onDraft={onDraft} onDismiss={onDismiss} />

      {openDraft && (
        <Section title="Draft">
          <DraftEditor
            draft={openDraft}
            isBusy={isBusy}
            onSave={(subject, body) => onSave(openDraft.id, subject, body)}
            onApprove={(subject, body) => setConfirming({ draft: openDraft, subject, body })}
          />
        </Section>
      )}

      <Section title="Evidence">
        <Evidence
          evidence={detail.evidence}
          transactions={detail.transactions}
          emails={detail.emails}
          numberOf={cited.numberOf}
          onOpenEmail={(email, quote) => setOpenEmail({ email, quote })}
        />
      </Section>

      {detail.emails.length > 0 && (
        <Section title="Correspondence">
          <Correspondence emails={detail.emails} drafts={detail.drafts} />
        </Section>
      )}

      <History events={detail.timeline} trace={detail.trace} />

      <AnimatePresence>
        {confirming && (
          <ConfirmSheet
            key="confirm"
            draft={confirming.draft}
            subject={confirming.subject}
            onClose={() => setConfirming(null)}
            onConfirm={async () => {
              const { draft, subject, body } = confirming;
              if (subject !== draft.subject || body !== draft.body) await onSave(draft.id, subject, body);
              await onSend(draft.id);
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {openEmail && <EmailSheet key="email" email={openEmail.email} quote={openEmail.quote} onClose={() => setOpenEmail(null)} />}
      </AnimatePresence>
    </div>
  );
}
