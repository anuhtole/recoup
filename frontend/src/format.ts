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

/** A time in a detail row: "Jul 20, 2026, 10:00 AM UTC". Every time on screen is UTC and says so. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  const day = formatDate(iso);
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
  return `${day}, ${time} UTC`;
}

/** "4:05 PM": a clock time for a range ("4:05–6:15 PM UTC"). */
export function formatClock(hour: number, minute: number, withHalf = true): string {
  const h = hour % 12 || 12;
  const half = hour < 12 ? "AM" : "PM";
  return `${h}:${String(minute).padStart(2, "0")}${withHalf ? ` ${half}` : ""}`;
}

/** "99.90%" → "99.9%", "100.00%" → "100%": the one percent format, wherever a percent is shown. */
export function formatPercent(text: string): string {
  return text.replace(/(\d+)\.(\d*?)0+%/g, (_, whole: string, frac: string) => (frac ? `${whole}.${frac}%` : `${whole}%`));
}

/** Under a respond-by date: "16 days left", "1 day left", "Last day"; "Window closed" once it has passed. */
export function daysHint(days: number | null): string | null {
  if (days === null) return null;
  if (days < 0) return "Window closed";
  if (days === 0) return "Last day";
  return days === 1 ? "1 day left" : `${days} days left`;
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

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
