import type { ReactNode } from "react";
import type { Email, Evidence as EvidenceItem, Transaction } from "../../api";
import { formatDate, formatMoney } from "../../format";
import { titleCase } from "../../queue";
import { type PriceComparison, type VendorQuote, parsePriceComparison, parseQuote, splitIncident } from "./cite";

interface Props {
  evidence: EvidenceItem[];
  transactions: Transaction[];
  emails: Email[];
  /** Footnote number per evidence ref or transaction id, from the reason sentence. */
  numberOf: Map<string, number>;
  onOpenEmail: (email: Email, quote: VendorQuote) => void;
  /** Price above contract: lead with the contract-vs-charged comparison. */
  isPriceCase?: boolean;
  /** Incidents come from a public status page: link each one to the page. */
  isPublicStatus?: boolean;
}

function Step({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-12 text-dim">{label}</span>
      <span className="figure text-20 font-semibold">{value}</span>
      {note && <span className="text-12 text-dim">{note}</span>}
    </div>
  );
}

function Arrow() {
  return (
    <span aria-hidden className="hidden self-center text-20 text-dim sm:block">
      →
    </span>
  );
}

/** Contract price → charged → over by, for a price-above-contract case. */
function Comparison({ comparison, currency }: { comparison: PriceComparison; currency: string }) {
  const money = (minor: number) => formatMoney(minor, currency);
  const { charges, contractMinor, lockedUntil } = comparison;
  const overs = charges.map((c) => c.chargedMinor - c.allowedMinor);
  const total = overs.reduce((sum, o) => sum + o, 0);
  const sameEach = charges.every((c) => c.chargedMinor === charges[0].chargedMinor && c.allowedMinor === contractMinor);
  const months = charges.length === 1 ? "1 month" : `${charges.length} months`;
  return (
    <div aria-label="Contract price compared with what was charged" className="flex flex-col gap-4 rounded-row bg-selected p-4 sm:flex-row sm:items-start sm:gap-6">
      <Step label="Contract price" value={`${money(contractMinor)}/month`} note={lockedUntil ? `Locked through ${lockedUntil}` : undefined} />
      <Arrow />
      <Step label="Charged" value={sameEach ? money(charges[0].chargedMinor) : `${charges.length} charges`} note={sameEach ? "each month" : undefined} />
      <Arrow />
      <Step
        label="Over by"
        value={money(total)}
        note={sameEach ? `${money(overs[0])} × ${months}` : `across ${months}`}
      />
    </div>
  );
}

function Ref({ n }: { n: number | undefined }) {
  if (n === undefined) return null;
  return (
    <span aria-label={`source ${n}`} className="figure inline-grid h-[18px] min-w-[18px] place-items-center rounded-full bg-selected px-1 text-12 font-medium text-dim">
      {n}
    </span>
  );
}

function Item({ label, n, children }: { label: ReactNode; n?: number; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-14 text-dim">
        <Ref n={n} />
        <span className="min-w-0 truncate">{label}</span>
      </div>
      {children}
    </div>
  );
}

function Ledger({ transactions, numberOf }: { transactions: Transaction[]; numberOf: Map<string, number> }) {
  return (
    <ul className="m-0 flex flex-col gap-1 p-0">
      {transactions.map((txn) => (
        <li
          key={txn.id}
          className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 rounded-row bg-tint px-4 py-3 text-14"
        >
          <span className="figure whitespace-nowrap text-14 text-dim">{formatDate(txn.posted_at)}</span>
          <span className="min-w-0">
            <span className="block truncate">{titleCase(txn.merchant)}</span>
            <span className="ref block truncate text-12 text-dim">{txn.reference ?? "No reference"}</span>
          </span>
          <span className="flex items-baseline gap-2">
            <span className={txn.amount_minor < 0 ? "figure text-money-ink" : "figure"}>{formatMoney(txn.amount_minor, txn.currency)}</span>
            <Ref n={numberOf.get(txn.id)} />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Evidence({ evidence, transactions, emails, numberOf, onOpenEmail, isPriceCase = false, isPublicStatus = false }: Props) {
  const of = (kind: EvidenceItem["kind"]) => evidence.filter((e) => e.kind === kind);
  const incidents = of("incident");
  // Falls back to the plain rows below if the evidence doesn't read as expected.
  const comparison = isPriceCase ? parsePriceComparison(evidence) : null;
  return (
    <div className="flex flex-col gap-6">
      {comparison && <Comparison comparison={comparison} currency={transactions[0]?.currency ?? "USD"} />}
      {of("email").map((item) => {
        const quote = parseQuote(item.detail);
        const email = emails.find((e) => e.id === item.ref || item.ref.endsWith(e.id));
        if (!quote) {
          return (
            <Item key={item.ref} label="What the vendor wrote" n={numberOf.get(item.ref)}>
              <p className="text-14">{item.detail}</p>
            </Item>
          );
        }
        return (
          <Item key={item.ref} label="What the vendor wrote" n={numberOf.get(item.ref)}>
            <figure className="m-0">
              <blockquote className="m-0 border-l-2 border-line-strong pl-4 text-16">“{quote.quote}”</blockquote>
              <figcaption className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 pl-4 text-14 text-dim">
                <span>
                  {quote.vendor}, <span className="figure">{formatDate(quote.day)}</span> · quoted word for word, checked against the email
                </span>
                {email && (
                  <button
                    type="button"
                    onClick={() => onOpenEmail(email, quote)}
                    className="py-1 font-medium text-ink underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-current"
                  >
                    Read the email
                  </button>
                )}
              </figcaption>
            </figure>
          </Item>
        );
      })}

      {of("contract").map((item) => (
        <Item key={item.ref} label={<>Contract · <span className="ref text-12">{item.ref}</span></>} n={numberOf.get(item.ref)}>
          <p className="max-w-[65ch] text-14">{item.detail}</p>
        </Item>
      ))}

      {incidents.length > 0 && (
        <Item label={isPublicStatus ? "Public status page" : "Vendor status page"} n={numberOf.get(incidents[0].ref)}>
          <ul className="m-0 flex flex-col gap-2 p-0">
            {incidents.map((item) => {
              const { text, url } = splitIncident(item.detail);
              return (
                <li key={item.ref} className="list-none text-14">
                  {isPublicStatus && url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline decoration-line-strong underline-offset-4 hover:decoration-current"
                    >
                      {text}
                    </a>
                  ) : (
                    text
                  )}
                </li>
              );
            })}
          </ul>
        </Item>
      )}

      {transactions.length > 0 && (
        <Item label="Your ledger">
          <Ledger transactions={transactions} numberOf={numberOf} />
        </Item>
      )}

      {of("rule").map((item) => (
        <Item key={item.ref} label="How Recoup checked">
          <p className="max-w-[65ch] text-14 text-dim">{item.detail}</p>
        </Item>
      ))}
    </div>
  );
}
