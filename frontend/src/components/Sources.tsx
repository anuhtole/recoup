import { useState } from "react";
import type { Sources, SyncReport, SyncRun } from "../api";
import { formatDateTime, plural } from "../format";
import { cn } from "@/lib/utils";

const STALE_MS = 24 * 60 * 60 * 1000;
export const FEED_LABEL: Record<string, string> = { jira: "Jira", confluence: "Confluence", github: "GitHub" };

export type SourcesHealth = "ok" | "attention" | "none";

/** "just now", "2 min ago", "3 hours ago", "2 days ago", then the date. */
export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${plural(hours, "hour")} ago`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${plural(days, "day")} ago` : formatDateTime(iso);
}

export function configured(sources: Sources) {
  return sources.connectors.filter((c) => c.configured);
}

/** Green when every connected source last synced fine and recently, amber when one failed or is stale, dim when nothing has synced. */
export function sourcesHealth(sources: Sources | null): SourcesHealth {
  if (!sources) return "none";
  const runs = configured(sources).map((c) => c.last_sync);
  if (runs.length === 0 || runs.every((r) => r === null)) return "none";
  const fresh = (r: SyncRun) => Date.now() - new Date(r.finished_at).getTime() < STALE_MS;
  return runs.every((r) => r !== null && r.ok && fresh(r)) ? "ok" : "attention";
}

const DOT: Record<SourcesHealth, string> = {
  ok: "bg-mint",
  attention: "bg-amber",
  none: "bg-sub/50",
};

export function StatusDot({ health, className }: { health: SourcesHealth; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 flex-none rounded-full", DOT[health], className)} />;
}

export function num(detail: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = detail?.[key];
  return typeof value === "number" ? value : null;
}


/** The server's own words for a failed run, for a tooltip; the page itself says it in plain words. */
export function runError(run: SyncRun | null): string | undefined {
  const error = run?.detail?.error;
  return run && !run.ok && typeof error === "string" && error ? error : undefined;
}

/** One line about the last sync, in plain words: "40 read, 3 new". */
export function runResult(key: string, run: SyncRun): string {
  if (!run.ok) return "Didn't finish. Try Sync now again.";
  const inserted = num(run.detail, "inserted");
  const read = key === "ramp" ? num(run.detail, "pulled") : key === "gmail" ? num(run.detail, "fetched") : null;
  return inserted !== null && read !== null ? `${read} read, ${inserted} new` : "Finished";
}

export function Copyable({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex max-w-xl items-start justify-between gap-3 rounded-sm border border-line bg-wash py-1.5 pl-3 pr-1">
      <code className="ref min-w-0 whitespace-pre-wrap break-all py-1 text-13 text-ink">{text}</code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(text)
            .then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            })
            .catch(() => undefined);
        }}
        className="h-7 flex-none rounded-sm px-2 text-12 font-medium text-dim transition-colors hover:bg-paper hover:text-ink"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** What a sync brought in, as one notice. */
export function syncNotice(report: SyncReport): { title: string; body: string; ok: boolean } {
  const parts: string[] = [];
  let ok = true;
  for (const outcome of report.outcomes) {
    if (!outcome.ok) {
      ok = false;
      const name = outcome.connector === "ramp" ? "Ramp" : outcome.connector === "gmail" ? "Gmail" : "Status pages";
      parts.push(`${name} didn't finish. Try Sync now again.`);
      continue;
    }
    if (outcome.connector === "ramp") parts.push(`Ramp: ${plural(num(outcome.detail, "inserted") ?? 0, "new transaction")}.`);
    else if (outcome.connector === "gmail") parts.push(`Gmail: ${plural(num(outcome.detail, "inserted") ?? 0, "new vendor email")}.`);
    else {
      const read = num(outcome.detail, "feeds_ok") ?? 0;
      const failed = Array.isArray(outcome.detail?.feeds_failed) ? (outcome.detail.feeds_failed as string[]) : [];
      if (failed.length > 0) ok = false;
      parts.push(
        failed.length > 0
          ? `Status pages: ${read} read, couldn't reach ${failed.map((f) => FEED_LABEL[f] ?? f).join(", ")}.`
          : `Status pages: ${plural(read, "page")} read.`,
      );
    }
  }
  const created = report.run.created;
  const title = !ok
    ? "Sync couldn't reach every source"
    : created > 0
      ? `Synced · ${plural(created, "new claim")} found`
      : "Synced · nothing new";
  return { title, body: parts.join(" ") || "No sources are connected yet.", ok };
}
