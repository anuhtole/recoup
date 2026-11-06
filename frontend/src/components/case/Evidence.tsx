import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import type { Email, Evidence as EvidenceItem, Transaction } from "../../api";
import { formatDate, formatMoney } from "../../format";
import { vendorName } from "../../lib/vendors";
import { titleCase } from "../../queue";
import { cn } from "@/lib/utils";
import { incidentParts, type PriceComparison, type VendorQuote, parsePriceComparison, parseQuote, splitIncident } from "./cite";

interface Props {
  evidence: EvidenceItem[];
  transactions: Transaction[];
  emails: Email[];
  /** Footnote number per evidence ref or transaction id, from the reason sentence. */
  numberOf: Map<string, number>;
  onOpenEmail: (email: Email, quote: VendorQuote) => void;
  /** Price above contract: lead with the contract-vs-charged comparison. */
  isPriceCase?: boolean;
  /** Incidents come from a public status page: say what it can't show. */
  isPublicStatus?: boolean;
}

/** The footnote number a record carries in the reason, echoed as a small index. */
function Index({ n }: { n: number | undefined }) {
  return (
    <span aria-label={n === undefined ? undefined : `source ${n}`} className="figure inline-block w-5 flex-none text-12 font-semibold text-dim">
      {n ?? ""}
    </span>
  );
}

/** A group of records. When every record in it carries the same footnote, the number sits on the title once. */
function Block({ title, n, children }: { title: string; n?: number; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <h3 className="m-0 py-2 text-13 font-medium text-dim">
        {title}
        {n !== undefined && (
          <sup aria-label={`source ${n}`} className="figure ml-0.5 text-12 font-semibold text-dim">
            {n}
          </sup>
        )}
      </h3>
      {children}
    </div>
  );
}

/**
 * Footnote numbers for a list of records: one number for the whole group when they all share it (it goes
 * on the title), otherwise each row shows its number only where it changes, so "2, 2, 2" never appears.
 */
function groupNumbers(numbers: (number | undefined)[]): { shared: number | undefined; rows: (number | undefined)[] } {
  const first = numbers[0];
  if (numbers.length > 1 && first !== undefined && numbers.every((n) => n === first)) return { shared: first, rows: numbers.map(() => undefined) };
  return { shared: undefined, rows: numbers.map((n, i) => (i > 0 && n === numbers[i - 1] ? undefined : n)) };
}

/** Contract price → charged → over by, for a price-above-contract case. */
function Comparison({ comparison, currency }: { comparison: PriceComparison; currency: string }) {
  const money = (minor: number) => formatMoney(minor, currency);
  const { charges, contractMinor, lockedUntil } = comparison;
  const overs = charges.map((c) => c.chargedMinor - c.allowedMinor);
  const sameEach = charges.every((c) => c.chargedMinor === charges[0].chargedMinor && c.allowedMinor === contractMinor);
  const months = charges.length === 1 ? "1 month" : `${charges.length} months`;
  // The total over is the header's amount, so it isn't repeated here: the third tile is the monthly gap.
  const steps = [
    { label: "Contract price", value: `${money(contractMinor)}/mo`, note: lockedUntil ? `Fixed through ${lockedUntil}` : "Per the order form" },
    { label: "Charged", value: sameEach ? `${money(charges[0].chargedMinor)}/mo` : `${charges.length} charges`, note: sameEach ? `For ${months}` : "See the ledger" },
    { label: "Over by", value: sameEach ? `${money(overs[0])}/mo` : "Varies", note: sameEach ? `Each of ${months}` : `Across ${months}` },
  ];
  return (
    <div aria-label="Contract price compared with what was charged" role="group" className="grid grid-cols-1 border-b border-line sm:grid-cols-3">
      {steps.map((step, i) => (
        <div key={step.label} className={cn("flex flex-col gap-0.5 py-4", i > 0 && "border-t border-line sm:border-l sm:border-t-0 sm:pl-5")}>
          <span className="text-13 text-dim">{step.label}</span>
          <span className={cn("figure text-20 font-semibold tracking-[-0.01em]", i === 2 && "text-ink")}>{step.value}</span>
          <span className="text-12 text-dim">{step.note}</span>
        </div>
      ))}
    </div>
  );
}

function Ledger({ transactions, numberOf }: { transactions: Transaction[]; numberOf: Map<string, number> }) {
  const { shared, rows } = groupNumbers(transactions.map((t) => numberOf.get(t.id)));
  const indexed = rows.some((n) => n !== undefined);
  return (
    <Block title="Ledger" n={shared}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-14">
          <thead>
            <tr className="border-y border-line text-12 text-dim">
              <th scope="col" className="py-2 pr-3 font-medium">
                {indexed && <span className="inline-block w-5" />}
                Date
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Description
              </th>
              <th scope="col" className="hidden py-2 pr-3 font-medium sm:table-cell">
                Reference
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((txn, i) => (
              <tr key={txn.id} data-txn={txn.id} className="h-11 border-b border-line align-middle">
                <td className="whitespace-nowrap pr-3">
                  {indexed && <Index n={rows[i]} />}
                  <span className="figure">{formatDate(txn.posted_at)}</span>
                </td>
                <td className="py-2.5 pr-3">
                  {titleCase(txn.merchant)}
                  {txn.reference && <span className="ref block text-12 text-dim sm:hidden">{txn.reference}</span>}
                </td>
                <td className="hidden pr-3 sm:table-cell">{txn.reference ? <span className="ref text-13">{txn.reference}</span> : <span className="text-dim">—</span>}</td>
                <td className={cn("figure whitespace-nowrap text-right font-medium", txn.amount_minor < 0 && "text-mint-ink")}>
                  {formatMoney(txn.amount_minor, txn.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Block>
  );
}

/** A quoted record: the index, the words, and a quiet caption under them. */
function Quote({ n, children, caption }: { n: number | undefined; children: ReactNode; caption: ReactNode }) {
  return (
    <figure className="m-0 flex gap-0 border-t border-line py-3">
      <Index n={n} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <blockquote className="m-0 max-w-[68ch] border-l-2 border-line-strong pl-3 text-14 text-pretty">{children}</blockquote>
        <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-3.5 text-13 text-dim">{caption}</figcaption>
      </div>
    </figure>
  );
}

interface Part {
  n: number | undefined;
  i: number;
  node: ReactNode;
}

/** The records behind a case: one ledger table, then quotes and status-page rows, in the order the reason cites them. */
export function Evidence({ evidence, transactions, emails, numberOf, onOpenEmail, isPriceCase = false, isPublicStatus = false }: Props) {
  const of = (kind: EvidenceItem["kind"]) => evidence.filter((e) => e.kind === kind);
  const comparison = isPriceCase ? parsePriceComparison(evidence) : null;
  const parts: Part[] = [];
  const first = (refs: string[]) => {
    const numbers = refs.map((r) => numberOf.get(r)).filter((n): n is number => n !== undefined);
    return numbers.length ? Math.min(...numbers) : undefined;
  };

  if (transactions.length > 0) {
    parts.push({ n: first(transactions.map((t) => t.id)), i: parts.length, node: <Ledger key="ledger" transactions={transactions} numberOf={numberOf} /> });
  }

  for (const item of of("email")) {
    const quote = parseQuote(item.detail);
    const email = emails.find((e) => e.id === item.ref || item.ref.endsWith(e.id));
    const n = numberOf.get(item.ref);
    parts.push({
      n,
      i: parts.length,
      node: (
        <Block key={item.ref} title={quote ? `Email from ${vendorName(quote.vendor)}` : "Email"}>
          <Quote
            n={n}
            caption={
              <>
                {quote && <span className="figure">{formatDate(quote.day)}</span>}
                {quote && email && (
                  <button
                    type="button"
                    onClick={() => onOpenEmail(email, quote)}
                    className="font-medium text-ink underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-current"
                  >
                    Read the email
                  </button>
                )}
              </>
            }
          >
            {quote ? `“${quote.quote}”` : item.detail}
          </Quote>
        </Block>
      ),
    });
  }

  for (const item of of("contract")) {
    const n = numberOf.get(item.ref);
    parts.push({
      n,
      i: parts.length,
      node: (
        <Block key={item.ref} title="Contract">
          <Quote n={n} caption={<span className="[overflow-wrap:anywhere]">{item.ref}</span>}>
            {item.detail}
          </Quote>
        </Block>
      ),
    });
  }

  const incidents = of("incident");
  if (incidents.length > 0) {
    const numbers = groupNumbers(incidents.map((e) => numberOf.get(e.ref)));
    const indexed = numbers.rows.some((n) => n !== undefined);
    parts.push({
      n: first(incidents.map((e) => e.ref)),
      i: parts.length,
      node: (
        <Block key="incidents" title={isPublicStatus ? "Public status page" : "Status page"} n={numbers.shared}>
          <ul className="m-0 flex flex-col p-0">
            {incidents.map((item, index) => {
              const { text, url } = splitIncident(item.detail);
              const { name, when } = incidentParts(text);
              return (
                <li key={item.ref} className="flex list-none items-start gap-0 border-t border-line py-3 text-14">
                  {indexed && <Index n={numbers.rows[index]} />}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-pretty [overflow-wrap:anywhere]">{name}</span>
                    {when && <span className="figure text-13 text-dim">{when}</span>}
                  </span>
                  {url && (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open the status page for: ${name}`}
                      className="grid size-8 flex-none place-items-center rounded-sm text-dim transition-colors hover:bg-wash hover:text-ink"
                    >
                      <ArrowUpRight aria-hidden className="size-4" strokeWidth={1.75} />
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </Block>
      ),
    });
  }

  // Records read in the order the sentence cites them (1, 2, 3); uncited records follow in their own order.
  const ordered = parts.sort((a, b) => (a.n ?? Number.POSITIVE_INFINITY) - (b.n ?? Number.POSITIVE_INFINITY) || a.i - b.i);

  return (
    <div className="flex flex-col gap-4">
      {comparison && <Comparison comparison={comparison} currency={transactions[0]?.currency ?? "USD"} />}
      {ordered.map((p) => p.node)}
    </div>
  );
}
