import { AnimatePresence } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Draft, Email, FindingDetail } from "../api";
import { ApprovalSheet } from "../components/case/ApprovalSheet";
import { Facts, NextStep, RespondBy } from "../components/case/CaseSidebar";
import { Reason } from "../components/case/Citations";
import { citeReason, needsCustomerConfirmation, type VendorQuote } from "../components/case/cite";
import { Correspondence } from "../components/case/Correspondence";
import { DraftEditor } from "../components/case/DraftEditor";
import { EmailSheet } from "../components/case/EmailSheet";
import { Evidence } from "../components/case/Evidence";
import { History } from "../components/case/History";
import { HowFound } from "../components/case/HowFound";
import { Label, Pill } from "../components/ui";
import { formatMoney } from "../format";
import { useMediaQuery } from "../hooks/useIsNarrow";
import { displayReason, referenceOf } from "../queue";
import { LEAK_LABEL, statusOf } from "../theme";

export interface CaseActions {
  onDraft: () => void;
  onDismiss: (reason: string) => void;
  onSave: (draftId: number, subject: string, body: string) => Promise<void>;
  onSend: (draftId: number) => Promise<void>;
}

interface Props extends CaseActions {
  detail: FindingDetail;
  isBusy: boolean;
  listHref: string;
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
      className="grid size-8 place-items-center rounded-sm border border-line bg-paper text-ink transition-colors hover:border-line-strong disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** A case on its own route: breadcrumb, a narrative column, and a sticky facts-and-action sidebar. */
export function CasePage({ detail, isBusy, listHref, prevId, nextId, position, onNavigate, onBack, onDraft, onDismiss, onSave, onSend }: Props) {
  const [openEmail, setOpenEmail] = useState<{ email: Email; quote: VendorQuote } | null>(null);
  // Held here, not in the sheet, so the sheet can show "Sent" after the draft leaves the case.
  const [approving, setApproving] = useState<{ draft: Draft; subject: string; body: string } | null>(null);
  const cited = useMemo(() => citeReason({ ...detail, reason: displayReason(detail.reason) }), [detail]);
  const publicStatus = needsCustomerConfirmation(detail.leak_type, detail.reason);
  const openDraft = detail.drafts.find((d) => d.status === "draft");
  const [edits, setEdits] = useState({ subject: openDraft?.subject ?? "", body: openDraft?.body ?? "" });
  const references = [...new Set(detail.transactions.map((t) => t.reference).filter((r): r is string => Boolean(r)))];
  const reference = referenceOf(detail.reason) ?? references[0] ?? null;
  const status = statusOf(detail);
  const isRecovered = detail.status === "recovered";
  // Two columns from 1280px; below that the action panel follows the header and the facts go last.
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
  const nextStep = (
    <NextStep detail={detail} openDraft={openDraft} isBusy={isBusy} onDraft={onDraft} onReview={review} onDismiss={onDismiss} />
  );

  return (
    <article aria-label={`${detail.merchant} case`} className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <nav aria-label="Breadcrumb" className="label flex min-w-0 items-center gap-2 text-dim">
          <a
            href={listHref}
            onClick={(e) => {
              e.preventDefault();
              onBack();
            }}
            className="rounded-xs underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink hover:decoration-current"
          >
            Claims
          </a>
          <span aria-hidden>/</span>
          <span aria-current="page" className="truncate text-ink">
            {detail.merchant}
          </span>
        </nav>
        <div className="flex flex-none items-center gap-2">
          {position && (
            <span className="label hidden text-dim sm:inline">
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
      </div>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
        {/* Header and reason come first on every screen; on narrow screens the action panel follows them. */}
        <div className="flex min-w-0 flex-col gap-6">
          <header className="card flex flex-col gap-5 p-5 md:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Label>{LEAK_LABEL[detail.leak_type]}</Label>
              <div className="flex flex-wrap gap-2">
                {publicStatus && <Pill label="Public status page" tone="neutral" />}
                <Pill label={status.label} tone={status.tone} />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <h1 className="m-0 text-28 font-semibold tracking-[-0.03em]">{detail.merchant}</h1>
              <p className={`figure m-0 text-44 font-semibold tracking-[-0.035em] ${isRecovered ? "text-mint-ink" : ""}`}>
                {formatMoney(isRecovered ? (detail.recovered_minor ?? detail.amount_minor) : detail.amount_minor, detail.currency)}
              </p>
              {reference && (
                <p className="ref m-0 text-13 text-dim">
                  {references.length > 1 ? references.slice(0, 3).join(" · ") : reference}
                </p>
              )}
            </div>
            <div className="border-t border-line pt-5">
              <Reason cited={cited} onOpenEmail={(source) => source.email && setOpenEmail({ email: source.email, quote: source.quote })} />
            </div>
          </header>

          {!isWide && (
            <div className="flex flex-col gap-4">
              <RespondBy detail={detail} />
              {nextStep}
            </div>
          )}

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

          <HowFound detail={detail} />

          <section aria-label="Evidence" className="flex flex-col gap-3">
            <h2 className="m-0 text-14 font-semibold tracking-[-0.01em]">Evidence</h2>
            <Evidence
              evidence={detail.evidence}
              transactions={detail.transactions}
              emails={detail.emails}
              numberOf={cited.numberOf}
              onOpenEmail={(email, quote) => setOpenEmail({ email, quote })}
              isPriceCase={detail.leak_type === "price_overcharge"}
              isPublicStatus={publicStatus}
            />
          </section>

          <Correspondence emails={detail.emails} drafts={detail.drafts} />
          <History events={detail.timeline} trace={detail.trace} />
          {!isWide && <Facts detail={detail} reference={reference} />}
        </div>

        {isWide && (
          <aside aria-label="Case sidebar" className="sticky top-8 flex min-w-0 flex-col gap-4">
            <RespondBy detail={detail} />
            <Facts detail={detail} reference={reference} />
            {nextStep}
          </aside>
        )}
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
            vendor={detail.merchant}
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
