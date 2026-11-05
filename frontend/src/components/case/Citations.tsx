import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatDate, formatMoney } from "../../format";
import { SPRING } from "../../motion";
import { titleCase } from "../../queue";
import { type Citation, type CitedReason, type Source, splitIncident } from "./cite";

const PREVIEW_WIDTH = 300;
const GAP = 10;

function Preview({ source }: { source: Source }) {
  switch (source.kind) {
    case "charge":
      return (
        <>
          <p className="text-11 label text-sub">{source.transactions.length > 1 ? "Charges on your card" : "Charge on your card"}</p>
          <ul className="mt-2 flex flex-col gap-2">
            {source.transactions.map((t) => (
              <li key={t.id} className="grid grid-cols-[auto_1fr_auto] items-baseline gap-3 text-14">
                <span className="figure text-sub">{formatDate(t.posted_at)}</span>
                <span className="truncate">{titleCase(t.merchant)}</span>
                <span className="figure">{formatMoney(t.amount_minor, t.currency)}</span>
              </li>
            ))}
          </ul>
          {source.transactions[0]?.reference && (
            <p className="mt-2 text-11 text-sub">Reference <span className="ref"> {source.transactions[0].reference}</span></p>
          )}
        </>
      );
    case "email":
      return (
        <>
          <p className="text-11 label text-sub">
            {source.quote.vendor}, <span className="figure">{formatDate(source.quote.day)}</span>
          </p>
          <p className="mt-2 text-14">“{source.quote.quote}”</p>
          {source.email && <p className="mt-2 text-11 text-sub">Click to read the whole email.</p>}
        </>
      );
    case "contract":
      return (
        <>
          <p className="ref truncate text-11 text-sub">{source.evidence.ref}</p>
          <p className="mt-2 line-clamp-5 text-14">{source.evidence.detail}</p>
        </>
      );
    case "incident":
      return (
        <>
          <p className="text-11 label text-sub">Vendor status page</p>
          <ul className="mt-2 flex flex-col gap-2">
            {source.items.map((item) => (
              <li key={item.ref} className="text-14">
                {splitIncident(item.detail).text}
              </li>
            ))}
          </ul>
        </>
      );
  }
}

function describe(source: Source): string {
  switch (source.kind) {
    case "charge":
      return source.transactions.length > 1 ? "the charges in the ledger" : `the charge on ${formatDate(source.transactions[0].posted_at)}`;
    case "email":
      return `${source.quote.vendor}'s email`;
    case "contract":
      return "the contract";
    case "incident":
      return "the vendor's status page";
  }
}

function Footnote({ citation, onOpenEmail }: { citation: Citation; onOpenEmail: (source: Extract<Source, { kind: "email" }>) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [place, setPlace] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<number>();
  const id = useId();
  const { source } = citation;
  const opensEmail = source.kind === "email" && source.email !== null;

  useLayoutEffect(() => {
    if (!isOpen || !button.current) return;
    const rect = button.current.getBoundingClientRect();
    const width = Math.min(PREVIEW_WIDTH, window.innerWidth - 24);
    const left = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, 12), window.innerWidth - width - 12);
    const above = rect.top > 220;
    setPlace({ left, top: above ? rect.top - GAP : rect.bottom + GAP, above });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const close = () => setIsOpen(false);
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [isOpen]);

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  const show = (delay: number) => {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setIsOpen(true), delay);
  };
  const hide = () => {
    window.clearTimeout(hoverTimer.current);
    setIsOpen(false);
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        data-footnote={citation.n}
        aria-label={`Source ${citation.n}: ${describe(source)}${opensEmail ? ". Opens the email." : ""}`}
        aria-describedby={isOpen ? id : undefined}
        onMouseEnter={() => show(120)}
        onMouseLeave={hide}
        onFocus={() => show(0)}
        onBlur={hide}
        onClick={() => {
          if (opensEmail && source.kind === "email") {
            hide();
            onOpenEmail(source);
          } else {
            setIsOpen((open) => !open);
          }
        }}
        // A 24px target around an 18px chip, so the citation is easy to hit without looking bigger.
        className="group/fn -my-1 inline-grid size-6 -translate-y-[0.4em] place-items-center align-baseline transition-transform duration-150 active:scale-90"
      >
        <span className="ref inline-grid h-[18px] min-w-[18px] place-items-center rounded-xs border border-line bg-ground px-1 text-11 font-medium text-ink transition-colors duration-150 group-hover/fn:border-ink group-hover/fn:bg-ink group-hover/fn:text-white">
          {citation.n}
        </span>
      </button>
      {createPortal(
        <AnimatePresence>
          {isOpen && place && (
            <motion.div
              id={id}
              role="tooltip"
              className="on-ink float pointer-events-none fixed z-50 rounded-md border border-rule bg-panel px-4 py-3 text-white"
              style={{
                left: place.left,
                top: place.top,
                width: Math.min(PREVIEW_WIDTH, window.innerWidth - 24),
                translateY: place.above ? "-100%" : "0%",
                transformOrigin: place.above ? "50% 100%" : "50% 0%",
              }}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={SPRING}
            >
              <Preview source={source} />
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

/** The one-sentence reason, with a numbered footnote on every claim we hold a source for. */
export function Reason({ cited, onOpenEmail }: { cited: CitedReason; onOpenEmail: (source: Extract<Source, { kind: "email" }>) => void }) {
  return (
    <p className="m-0 max-w-[64ch] text-16 text-ink text-pretty">
      {cited.parts.map((part, i) =>
        typeof part === "string" ? <span key={i}>{part}</span> : <Footnote key={`fn-${part.n}`} citation={part} onOpenEmail={onOpenEmail} />,
      )}
    </p>
  );
}
