import type { Evidence as EvidenceItem, Transaction } from "../../api";
import { formatDate, formatMoney } from "../../format";
import { COLORS, FONTS, mono } from "../../theme";

const QUOTE = /^(.*?) wrote on (\d{4}-\d{2}-\d{2}): "(.*)"$/s;

function EmailQuote({ item }: { item: EvidenceItem }) {
  const match = QUOTE.exec(item.detail);
  if (!match) return <p style={{ ...mono, margin: 0 }}>{item.detail}</p>;
  const [, vendor, day, quote] = match;
  return (
    <figure style={{ margin: 0 }}>
      <blockquote
        style={{
          margin: 0,
          padding: "10px 14px",
          borderLeft: `3px solid ${COLORS.warn}`,
          background: COLORS.warnSoft,
          borderRadius: "0 8px 8px 0",
          fontFamily: FONTS.serif,
          fontSize: 17,
          lineHeight: 1.45,
          color: COLORS.ink,
        }}
      >
        “{quote}”
      </blockquote>
      <figcaption style={{ ...mono, marginTop: 6, color: COLORS.inkDim }}>
        {vendor}, {formatDate(day)} · quoted verbatim, checked against the email
      </figcaption>
    </figure>
  );
}

function Transactions({ transactions }: { transactions: Transaction[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", ...mono }}>
        <tbody>
          {transactions.map((txn) => (
            <tr key={txn.id} style={{ borderTop: `1px solid ${COLORS.border}` }}>
              <td style={{ padding: "7px 8px 7px 0", whiteSpace: "nowrap" }}>{formatDate(txn.posted_at)}</td>
              <td style={{ padding: "7px 8px" }}>{txn.merchant}</td>
              <td style={{ padding: "7px 8px", color: COLORS.inkDim }}>{txn.reference ?? "no reference"}</td>
              <td
                style={{
                  padding: "7px 0 7px 8px",
                  textAlign: "right",
                  whiteSpace: "nowrap",
                  color: txn.amount_minor < 0 ? COLORS.good : COLORS.ink,
                }}
              >
                {formatMoney(txn.amount_minor, txn.currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ ...mono, fontSize: 11, color: COLORS.accentInk, marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  );
}

export function Evidence({ evidence, transactions }: { evidence: EvidenceItem[]; transactions: Transaction[] }) {
  const of = (kind: EvidenceItem["kind"]) => evidence.filter((e) => e.kind === kind);
  return (
    <div>
      {of("email").map((item) => (
        <Labeled key={item.ref} label="What the vendor wrote">
          <EmailQuote item={item} />
        </Labeled>
      ))}
      {of("contract").map((item) => (
        <Labeled key={item.ref} label={`Contract · ${item.ref}`}>
          <p style={{ margin: 0, fontFamily: FONTS.serif, fontSize: 16, lineHeight: 1.45, color: COLORS.inkSoft }}>
            {item.detail}
          </p>
        </Labeled>
      ))}
      {of("incident").length > 0 && (
        <Labeled label="Status page">
          <ul style={{ margin: 0, paddingLeft: 18, ...mono }}>
            {of("incident").map((item) => (
              <li key={item.ref} style={{ marginBottom: 4, overflowWrap: "anywhere" }}>
                {item.detail}
              </li>
            ))}
          </ul>
        </Labeled>
      )}
      <Labeled label="Ledger">
        <Transactions transactions={transactions} />
      </Labeled>
      {of("rule").map((item) => (
        <Labeled key={item.ref} label={`Rule · ${item.ref}`}>
          <p style={{ ...mono, margin: 0 }}>{item.detail}</p>
        </Labeled>
      ))}
    </div>
  );
}
