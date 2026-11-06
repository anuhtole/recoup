import { AnimatePresence } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Draft, Email, FindingDetail } from "../api";
import { ApprovalSheet } from "../components/case/ApprovalSheet";
import { CaseRail } from "../components/case/CaseRail";
import { Reason } from "../components/case/Citations";
import { citeReason, needsCustomerConfirmation, type VendorQuote } from "../components/case/cite";
import { Correspondence } from "../components/case/Correspondence";
import { DraftEditor } from "../components/case/DraftEditor";
import { EmailSheet } from "../components/case/EmailSheet";
import { Evidence } from "../components/case/Evidence";
import { History } from "../components/case/History";
import { WhyOwed } from "../components/case/WhyOwed";
import { Money } from "../components/Money";
import { Section } from "../components/Section";
import { TopBarActions } from "../components/shell/TopBarActions";
import { Pill, Tag } from "../components/ui";
import { VendorLogo } from "../components/VendorLogo";
import { useMediaQuery } from "../hooks/useIsNarrow";
import { vendorName } from "../lib/vendors";
import { displayReason, referenceOf } from "../queue";
import { LEAK_LABEL, statusOf } from "../theme";
import { cn } from "@/lib/utils";

export interface CaseActions {
  onDraft: () => void;
  onDismiss: (reason: string) => void;
  onSave: (draftId: number, subject: string, body: string) => Promise<void>;
  onSend: (draftId: number) => Promise<void>;
}

interface Props extends CaseActions {
  detail: FindingDetail;
  isBusy: boolean;
  prevId: number | null;
  nextId: number | null;
  position: { index: number; total: number } | null;
  onNavigate: (id: number) => void;
  onBack: () => void;
}

const TYPING = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function NavArrow({ id, label, onNavigate, children }: { id: number | null; label: string; onNavigate: (id: number) => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={id === null}
      onClick={() => id !== null && onNavigate(id)}
      className="grid size-8 place-items-center rounded-sm text-ink transition-colors hover:bg-wash disabled:text-line-strong disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

/** A case on its own route: a header, the reason and its evidence on the left, the deadline and the one action on the right. */
export function CasePage({ detail, isBusy, prevId, nextId, position, onNavigate, onBack, onDraft, onDismiss, onSave, onSend }: Props) {
  const [openEmail, setOpenEmail] = useState<{ email: Email; quote: VendorQuote } | null>(null);
  // Held here, not in the sheet, so the sheet can show "Sent" after the draft leaves the case.
  const [approving, setApproving] = useState<{ draft: Draft; subject: string; body: string } | null>(null);
  const cited = useMemo(() => citeReason({ ...detail, reason: displayReason(detail.reason) }), [detail]);
  const publicStatus = needsCustomerConfirmation(detail.leak_type, detail.reason);
  const openDraft = detail.drafts.find((d) => d.status === "draft");
  const [edits, setEdits] = useState({ subject: openDraft?.subject ?? "", body: openDraft?.body ?? "" });
  const references = [...new Set(detail.transactions.map((t) => t.reference).filter((r): r is string => Boolean(r)))];
  const reference = referenceOf(detail.reason) ?? references[0] ?? null;
  const isRecovered = detail.status === "recovered";
  const status = statusOf(detail);
  const vendor = vendorName(detail.merchant);
  // Two columns from 1280px; below that the rail follows the header.
  const isWide = useMediaQuery("(min-width: 1280px)");

  useEffect(() => {
    setEdits({ subject: openDraft?.subject ?? "", body: openDraft?.body ?? "" });
  }, [openDraft?.id, openDraft?.subject, openDraft?.body]);

  // Esc goes back to the list; j / k move to the next and previous case, as in a mail client.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A sheet that handled the key (Escape closes it) has the last word.
      if (approving || openEmail || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target && (TYPING.has(target.tagName) || target.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") onBack();
      else if (event.key === "j" && nextId !== null) onNavigate(nextId);
      else if (event.key === "k" && prevId !== null) onNavigate(prevId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [approving, openEmail, onBack, onNavigate, nextId, prevId]);

  const review = () => openDraft && setApproving({ draft: openDraft, subject: edits.subject, body: edits.body });
  const rail = (
    <CaseRail
      detail={detail}
      openDraft={openDraft}
      isReviewing={approving !== null}
      isBusy={isBusy}
      onDraft={onDraft}
      onReview={review}
      onDismiss={onDismiss}
      className={cn(isWide ? "sticky top-[88px]" : "md:max-w-md")}
    />
  );

  return (
    <article aria-label={`${vendor} case`} className="flex flex-col">
      <TopBarActions>
        <div className="flex items-center gap-1">
          {position && (
            <span className="figure hidden pr-2 text-13 text-dim sm:inline">
              {position.index + 1} of {position.total}
            </span>
          )}
          <NavArrow id={prevId} label="Previous case (k)" onNavigate={onNavigate}>
            <ChevronLeft aria-hidden className="size-4" strokeWidth={1.75} />
          </NavArrow>
          <NavArrow id={nextId} label="Next case (j)" onNavigate={onNavigate}>
            <ChevronRight aria-hidden className="size-4" strokeWidth={1.75} />
          </NavArrow>
        </div>
      </TopBarActions>

      <div className="grid grid-cols-1 items-start gap-x-12 gap-y-8 xl:grid-cols-[minmax(0,1fr)_304px]">
        <div className="flex min-w-0 flex-col gap-10">
          <header data-case-header className="flex flex-col gap-5">
            <div className="flex items-center gap-3.5">
              <VendorLogo name={detail.merchant} size={40} />
              <div className="flex min-w-0 flex-col">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                  <h1 className="m-0 truncate text-20 font-semibold tracking-[-0.01em]">{vendor}</h1>
                  <Tag>{LEAK_LABEL[detail.leak_type]}</Tag>
                  {publicStatus && <Tag>Public status page</Tag>}
                </div>
                {reference && (
                  <p data-reference className="ref m-0 truncate text-12 text-dim">
                    {references.length > 1 ? references.slice(0, 3).join(" · ") : reference}
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <p className={cn("m-0 text-44 font-semibold tracking-[-0.02em]", isRecovered && "text-mint-ink")}>
                <Money minor={isRecovered ? (detail.recovered_minor ?? detail.amount_minor) : detail.amount_minor} currency={detail.currency} />
              </p>
              <Pill label={status.label} tone={status.tone} />
            </div>
            <Reason cited={cited} onOpenEmail={(source) => source.email && setOpenEmail({ email: source.email, quote: source.quote })} />
          </header>

          {!isWide && rail}

          {openDraft && (
            <DraftEditor
              draft={openDraft}
              subject={edits.subject}
              body={edits.body}
              onChange={setEdits}
              isBusy={isBusy}
              onSave={() => void onSave(openDraft.id, edits.subject, edits.body).catch(() => undefined)}
            />
          )}

          <WhyOwed detail={detail} />

          <Section title="Evidence">
            <Evidence
              evidence={detail.evidence}
              transactions={detail.transactions}
              emails={detail.emails}
              numberOf={cited.numberOf}
              onOpenEmail={(email, quote) => setOpenEmail({ email, quote })}
              isPriceCase={detail.leak_type === "price_overcharge"}
              isPublicStatus={publicStatus}
            />
          </Section>

          <Correspondence emails={detail.emails} drafts={detail.drafts} />
          <History events={detail.timeline} trace={detail.trace} />
        </div>

        {isWide && rail}
      </div>

      <AnimatePresence>
        {approving && (
          <ApprovalSheet
            key="approve"
            draft={approving.draft}
            subject={approving.subject}
            body={approving.body}
            amountMinor={detail.amount_minor}
            currency={detail.currency}
            reference={reference}
            vendor={vendor}
            onClose={() => setApproving(null)}
            onConfirm={async () => {
              const { draft, subject, body } = approving;
              if (subject !== draft.subject || body !== draft.body) await onSave(draft.id, subject, body);
              await onSend(draft.id);
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {openEmail && <EmailSheet key="email" email={openEmail.email} quote={openEmail.quote} onClose={() => setOpenEmail(null)} />}
      </AnimatePresence>
    </article>
  );
}
