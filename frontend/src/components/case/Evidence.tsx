import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import type { Email, Evidence as EvidenceItem, Transaction } from "../../api";
import { formatDate, formatMoney } from "../../format";
import { titleCase } from "../../queue";
import { Label } from "../ui";
import {
  type PriceComparison,
  type VendorQuote,
  parsePriceComparison,
  parseQuote,
  splitIncident,
} from "./cite";

interface Props {
  evidence: EvidenceItem[];
  transactions: Transaction[];
  emails: Email[];
  /** Footnote number per evidence ref or transaction id, from the reason sentence. */
  numberOf: Map<string, number>;
  onOpenEmail: (email: Email, quote: VendorQuote) => void;
  /** Price above contract: lead with the contract-vs-charged comparison. */
  isPriceCase?: boolean;
  /** Incidents come from a public status page: link each one and say what it can't show. */
  isPublicStatus?: boolean;
}

/** One raw field in a dashed box, label above value. */
export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`field-box flex min-w-0 flex-col gap-1 px-3 py-2 ${className ?? ""}`}
    >
      <span className="label text-dim">{label}</span>
      <span className="min-w-0 text-14 [overflow-wrap:anywhere]">
        {children}
      </span>
    </div>
  );
}

function Ref({ n }: { n: number | undefined }) {
  if (n === undefined) return null;
  return (
    <span
      aria-label={`source ${n}`}
      className="ref inline-grid h-[18px] min-w-[18px] place-items-center rounded-xs bg-ink px-1 text-11 font-medium text-white"
    >
      {n}
    </span>
  );
}

/** A record card: mono kind label and source number, then its fields. */
function Record({
  kind,
  meta,
  n,
  children,
}: {
  kind: string;
  meta?: ReactNode;
  n?: number;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-line bg-paper p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <Ref n={n} />
          <Label as="span">{kind}</Label>
        </span>
        {meta && (
          <span className="ref min-w-0 truncate text-11 text-dim">{meta}</span>
        )}
      </div>
      {children}
    </div>
  );
}

/** Contract price → charged → over by, for a price-above-contract case. */
function Comparison({
  comparison,
  currency,
}: {
  comparison: PriceComparison;
  currency: string;
}) {
  const money = (minor: number) => formatMoney(minor, currency);
  const { charges, contractMinor, lockedUntil } = comparison;
  const overs = charges.map((c) => c.chargedMinor - c.allowedMinor);
  const total = overs.reduce((sum, o) => sum + o, 0);
  const sameEach = charges.every(
    (c) =>
      c.chargedMinor === charges[0].chargedMinor &&
      c.allowedMinor === contractMinor,
  );
  const months = charges.length === 1 ? "1 month" : `${charges.length} months`;
  const steps = [
    {
      label: "Contract price",
      value: `${money(contractMinor)}/mo`,
      note: lockedUntil
        ? `Locked through ${lockedUntil}`
        : "Per the order form",
    },
    {
      label: "Charged",
      value: sameEach
        ? money(charges[0].chargedMinor)
        : `${charges.length} charges`,
      note: sameEach ? "Each month" : "See the ledger",
    },
    {
      label: "Over by",
      value: money(total),
      note: sameEach ? `${money(overs[0])} × ${months}` : `Across ${months}`,
    },
  ];
  return (
    <div
      aria-label="Contract price compared with what was charged"
      className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-stretch"
    >
      {steps.map((step, i) => (
        <div key={step.label} className="contents">
          {i > 0 && (
            <span
              aria-hidden
              className="ref hidden self-center text-14 text-dim sm:block"
            >
              →
            </span>
          )}
          <div
            className={`field-box flex flex-col gap-1 px-4 py-3 ${i === 2 ? "border-ink bg-ground" : ""}`}
          >
            <span className="label text-dim">{step.label}</span>
            <span className="figure text-20 font-semibold tracking-[-0.02em]">
              {step.value}
            </span>
            <span className="text-13 text-dim">{step.note}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ledgerBlocks(
  transactions: Transaction[],
  numberOf: Map<string, number>,
): Block[] {
  return transactions.map((txn) => ({
    n: numberOf.get(txn.id),
    node: (
      <Record
        key={txn.id}
        kind={txn.amount_minor < 0 ? "Ledger · credit" : "Ledger · charge"}
        meta={txn.id}
        n={numberOf.get(txn.id)}
      >
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-[136px_minmax(0,1fr)_minmax(0,1fr)_120px]">
          <Field label="Posted">
            <span className="ref">{formatDate(txn.posted_at)}</span>
          </Field>
          <Field label="Descriptor">{titleCase(txn.merchant)}</Field>
          <Field label="Reference">
            <span className="ref">{txn.reference ?? "None"}</span>
          </Field>
          <Field label="Amount" className="text-right">
            <span
              className={
                txn.amount_minor < 0
                  ? "figure font-medium text-mint-ink"
                  : "figure font-medium"
              }
            >
              {formatMoney(txn.amount_minor, txn.currency)}
            </span>
          </Field>
        </div>
        {txn.card_last4 && (
          <p className="ref m-0 text-11 text-dim">CARD •••• {txn.card_last4}</p>
        )}
      </Record>
    ),
  }));
}

interface Block {
  n: number | undefined;
  node: ReactNode;
}

export function Evidence({
  evidence,
  transactions,
  emails,
  numberOf,
  onOpenEmail,
  isPriceCase = false,
  isPublicStatus = false,
}: Props) {
  const of = (kind: EvidenceItem["kind"]) =>
    evidence.filter((e) => e.kind === kind);
  const incidents = of("incident");
  // Falls back to the plain records below if the evidence doesn't read as expected.
  const comparison = isPriceCase ? parsePriceComparison(evidence) : null;
  const blocks: Block[] = [];

  for (const item of of("email")) {
    blocks.push({
      n: numberOf.get(item.ref),
      node: (() => {
        const quote = parseQuote(item.detail);
        const email = emails.find(
          (e) => e.id === item.ref || item.ref.endsWith(e.id),
        );
        return (
          <Record
            key={item.ref}
            kind="Vendor email"
            meta={quote ? formatDate(quote.day) : item.ref}
            n={numberOf.get(item.ref)}
          >
            {quote ? (
              <figure className="m-0 flex flex-col gap-3">
                <blockquote className="m-0 border-l-2 border-ink pl-4 text-16 text-pretty">
                  “{quote.quote}”
                </blockquote>
                <figcaption className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-13 text-dim">
                  <span>
                    {quote.vendor} · quoted word for word, checked against the
                    email
                  </span>
                  {email && (
                    <button
                      type="button"
                      onClick={() => onOpenEmail(email, quote)}
                      className="font-medium text-ink underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-current"
                    >
                      Read the email
                    </button>
                  )}
                </figcaption>
              </figure>
            ) : (
              <p className="m-0 text-14">{item.detail}</p>
            )}
          </Record>
        );
      })(),
    });
  }

  for (const item of of("contract")) {
    blocks.push({
      n: numberOf.get(item.ref),
      node: (
        <Record
          key={item.ref}
          kind="Contract"
          meta={item.ref}
          n={numberOf.get(item.ref)}
        >
          <p className="field-box m-0 max-w-[70ch] bg-wash px-3 py-2 text-14 text-pretty">
            {item.detail}
          </p>
        </Record>
      ),
    });
  }

  if (incidents.length > 0) {
    blocks.push({
      n: numberOf.get(incidents[0].ref),
      node: (
        <Record
          key="incidents"
          kind={isPublicStatus ? "Public status page" : "Vendor status page"}
          meta={`${incidents.length} ${incidents.length === 1 ? "incident" : "incidents"}`}
          n={numberOf.get(incidents[0].ref)}
        >
          <ul className="m-0 flex flex-col gap-2 p-0">
            {incidents.map((item) => {
              const { text, url } = splitIncident(item.detail);
              return (
                <li
                  key={item.ref}
                  className="field-box flex list-none items-start justify-between gap-3 px-3 py-2 text-14"
                >
                  <span className="min-w-0 text-pretty [overflow-wrap:anywhere]">
                    {text}
                  </span>
                  {url && (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open the status page for: ${text}`}
                      className="grid size-6 flex-none place-items-center rounded-xs text-dim transition-colors hover:bg-wash hover:text-ink"
                    >
                      <ArrowUpRight
                        aria-hidden
                        className="size-4"
                        strokeWidth={1.75}
                      />
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
          {isPublicStatus && (
            <p className="m-0 text-13 text-amber-ink">
              A public status page shows the outage happened, not that it hit
              you. Confirm that before you ask.
            </p>
          )}
        </Record>
      ),
    });
  }

  blocks.push(...ledgerBlocks(transactions, numberOf));
  // Cards read in the order the sentence cites them (1, 2, 3); uncited records follow in their own order.
  const ordered = blocks
    .map((b, i) => ({ ...b, i }))
    .sort(
      (a, b) =>
        (a.n ?? Number.POSITIVE_INFINITY) - (b.n ?? Number.POSITIVE_INFINITY) ||
        a.i - b.i,
    );

  return (
    <div className="flex flex-col gap-3">
      {comparison && (
        <Comparison
          comparison={comparison}
          currency={transactions[0]?.currency ?? "USD"}
        />
      )}
      {ordered.map((b) => b.node)}
    </div>
  );
}
