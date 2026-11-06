const formatters = new Map<string, Intl.NumberFormat>();

function currencyFormatter(currency: string): Intl.NumberFormat {
  let formatter = formatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", { style: "currency", currency });
    formatters.set(currency, formatter);
  }
  return formatter;
}

export function formatMoney(amountMinor: number, currency = "USD"): string {
  const formatter = currencyFormatter(currency);
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(amountMinor / 10 ** digits);
}

// The year short dates are read against: the demo's as-of year, or this year. App sets it from the summary.
let referenceYear = new Date().getUTCFullYear();
export function setReferenceYear(iso: string): void {
  referenceYear = toDate(iso).getUTCFullYear();
}

function toDate(iso: string): Date {
  return new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
}

/**
 * The one date format. "long" (detail rows): "Oct 2, 2026". "short" (lists): "Oct 2", with the year
 * only when it is not the reference year ("Dec 30, 2025").
 */
export function formatDate(iso: string, style: "long" | "short" = "long"): string {
  const date = toDate(iso);
  const withYear = style === "long" || date.getUTCFullYear() !== referenceYear;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: withYear ? "numeric" : undefined,
    timeZone: "UTC",
  });
}

/** List dates: "Oct 2". Same formatter as formatDate. */
export function formatShortDate(iso: string): string {
  return formatDate(iso, "short");
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

export function daysLeftLabel(days: number | null): string | null {
  if (days === null) return null;
  if (days < 0) return "Dispute window closed";
  if (days === 0) return "Last day";
  if (days === 1) return "1 day left";
  return `${days} days left`;
}

/** "1 day", "12 days", "Today" — the countdown in the case sidebar and tags. */
export function daysWord(days: number): string {
  if (days === 0) return "Today";
  return days === 1 ? "1 day" : `${days} days`;
}

/** "$13,710" and ".09": a hero figure's whole part and its cents, so the cents can be set smaller and dimmer. */
export function splitMoney(amountMinor: number, currency = "USD"): { whole: string; cents: string } {
  const formatter = currencyFormatter(currency);
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  const parts = formatter.formatToParts(amountMinor / 10 ** digits);
  const at = parts.findIndex((p) => p.type === "decimal");
  if (at < 0) return { whole: parts.map((p) => p.value).join(""), cents: "" };
  return { whole: parts.slice(0, at).map((p) => p.value).join(""), cents: parts.slice(at).map((p) => p.value).join("") };
}

/** Money without cents when it is a whole amount, for compact axis and band labels. */
export function formatMoneyShort(amountMinor: number, currency = "USD"): string {
  const whole = amountMinor % 100 === 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: whole ? 0 : 2,
    minimumFractionDigits: whole ? 0 : 2,
  }).format(amountMinor / 100);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
