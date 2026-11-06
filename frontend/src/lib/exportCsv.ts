import type { Finding } from "../api";
import { referenceOf } from "../queue";
import { LEAK_LABEL, statusOf } from "../theme";
import { vendorName } from "./vendors";

function cell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The claims as CSV: one row per case, amounts as plain decimals so a spreadsheet can sum them. */
export function claimsCsv(rows: Finding[]): string {
  const header = ["Vendor", "Type", "Reference", "Amount", "Currency", "Respond by", "Days left", "Status", "Case"];
  const lines = rows.map((f) =>
    [
      vendorName(f.merchant),
      LEAK_LABEL[f.leak_type],
      referenceOf(f.reason),
      (f.amount_minor / 100).toFixed(2),
      f.currency,
      f.recover_by,
      f.days_left,
      statusOf(f).label,
      `${window.location.origin}/#/claims/${f.id}`,
    ]
      .map(cell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

/** Builds the file in the browser and hands it to the viewer to save; nothing goes to the server. */
export function downloadClaims(rows: Finding[], asOf: string): void {
  const blob = new Blob([claimsCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `recoup-claims-${asOf}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
