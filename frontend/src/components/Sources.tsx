import { useState } from "react";
import type { Sources, SyncReport, SyncRun } from "../api";
import { formatDateTime, plural } from "../format";
import { cn } from "@/lib/utils";

const STALE_MS = 24 * 60 * 60 * 1000;
export const FEED_LABEL: Record<string, string> = { jira: "Jira", confluence: "Confluence", github: "GitHub" };

export type SourcesHealth = "ok" | "attention" | "none";

/** "just now", "2 min ago", "3 h ago", then the date. */
export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days} d ago` : formatDateTime(iso);
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

export function sourcesLabel(sources: Sources | null): string {
  if (!sources) return "Sources";
  const total = sources.connectors.length;
  const on = configured(sources).length;
  const latest = configured(sources)
    .map((c) => c.last_sync?.finished_at)
    .filter((t): t is string => Boolean(t))
    .sort()
    .at(-1);
  return `${on} of ${total} sources · ${latest ? `synced ${relativeTime(latest)}` : "not synced"}`;
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


/** One line about the last sync, in plain words. */
export function runResult(key: string, run: SyncRun): string {
  const error = run.detail?.error;
  if (!run.ok) return typeof error === "string" && error ? `Didn't finish: ${error}` : "Didn't finish.";
  if (key === "ramp") {
    const inserted = num(run.detail, "inserted");
    const pulled = num(run.detail, "pulled");
    return inserted !== null && pulled !== null ? `${plural(inserted, "new transaction")} of ${pulled} read` : "Finished";
  }
  if (key === "gmail") {
    const inserted = num(run.detail, "inserted");
    const fetched = num(run.detail, "fetched");
    return inserted !== null && fetched !== null ? `${plural(inserted, "new vendor email")} of ${fetched} read` : "Finished";
  }
  return "Finished";
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

export function When({ run }: { run: SyncRun | null }) {
  if (!run) return <span>Not synced yet</span>;
  return (
    <span title={formatDateTime(run.finished_at)}>
      Synced <span className="figure">{relativeTime(run.finished_at)}</span>
    </span>
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
      parts.push(`${name} didn't finish${outcome.error ? `: ${outcome.error}` : "."}`);
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
      ? `Synced · ${plural(created, "new case")} found`
      : "Synced · nothing new";
  return { title, body: parts.join(" ") || "No sources are connected yet.", ok };
}
