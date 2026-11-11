import { Lock } from "lucide-react";
import { useRef, useState } from "react";
import type { Sources, SyncReport, SyncRun } from "../api";
import { CONNECT } from "../demo/script";
import { formatDateTime, plural } from "../format";
import { cn } from "@/lib/utils";
import { Button } from "./Button";
import { Sheet } from "./Sheet";
import { Dialog } from "./ui";
import { VendorLogo } from "./VendorLogo";

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

/** Green when every source that has synced did so fine and recently, amber when one failed or is stale, dim when nothing has synced. */
export function sourcesHealth(sources: Sources | null): SourcesHealth {
  if (!sources) return "none";
  // A source that has never synced is not a problem; only a failed or stale run is.
  const runs = configured(sources)
    .map((c) => c.last_sync)
    .filter((r): r is SyncRun => r !== null);
  if (runs.length === 0) return "none";
  const fresh = (r: SyncRun) => Date.now() - new Date(r.finished_at).getTime() < STALE_MS;
  return runs.every((r) => r.ok && fresh(r)) ? "ok" : "attention";
}

const DOT: Record<SourcesHealth, string> = {
  ok: "bg-mint-ink",
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

/** The sources a person connects; status pages are public and need no setup. */
export type Connect = "ramp" | "gmail";

/** How to connect a source: server setup, so it lives in a sheet an admin opens, not on the page. */
export function ConnectSheet({ source, onClose }: { source: Connect; onClose: () => void }) {
  const isRamp = source === "ramp";
  return (
    <Sheet labelId="connect-title" title={isRamp ? "Connect Ramp" : "Connect Gmail"} subtitle="An admin sets this up on the Recoup server." onClose={onClose}>
      <div className="flex flex-col gap-4 overflow-y-auto px-6 pb-6 pt-2 text-14">
        {isRamp ? (
          <>
            <p className="m-0">Add the Ramp app's client ID and secret to the server's backend/.env:</p>
            <Copyable text={"RECOUP_RAMP_CLIENT_ID=\nRECOUP_RAMP_CLIENT_SECRET="} />
            <p className="m-0 text-dim">Then press Sync now. Recoup only reads transactions.</p>
          </>
        ) : (
          <>
            <p className="m-0">Add the Google app's client ID and secret to the server's backend/.env:</p>
            <Copyable text={"RECOUP_GMAIL_CLIENT_ID=\nRECOUP_GMAIL_CLIENT_SECRET="} />
            <p className="m-0">Then run this in backend/ and sign in with the finance inbox:</p>
            <Copyable text="recoup connect gmail" />
            <p className="m-0 text-dim">Access is read-only.</p>
          </>
        )}
      </div>
    </Sheet>
  );
}

/**
 * The demo's Gmail pop-up, shared by the Agent page and the Sources page: the inbox, what Recoup may do
 * with it, Cancel and Connect. Connecting is staged (no Google sign-in); `onConnect` makes the call.
 */
export function GmailConnectDialog({
  address,
  isConnecting,
  error,
  onConnect,
  onClose,
  returnFocus,
}: {
  address: string;
  isConnecting: boolean;
  /** Why the last try failed, in plain words. Connect stays, to try again. */
  error: string | null;
  onConnect: () => void;
  onClose: () => void;
  returnFocus?: () => HTMLElement | null;
}) {
  const confirm = useRef<HTMLButtonElement>(null);
  return (
    <Dialog labelId="gmail-connect-title" title={CONNECT.title} onClose={onClose} isLocked={isConnecting} initialFocus={confirm} returnFocus={returnFocus}>
      <div className="flex items-center gap-3 rounded-sm border border-line px-3 py-3">
        <VendorLogo name="Gmail" size={28} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-14 font-medium">{address}</span>
          <span className="text-13 text-dim">{CONNECT.account}</span>
        </span>
      </div>
      <p className="m-0 flex items-start gap-2 text-13 text-dim">
        <Lock aria-hidden className="mt-0.5 size-4 flex-none" strokeWidth={1.75} />
        <span className="text-pretty">{CONNECT.note}</span>
      </p>
      {error && (
        <p role="alert" className="m-0 rounded-sm bg-amber-wash px-3 py-2 text-13 text-amber-ink">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <Button onClick={onClose} disabled={isConnecting}>
          {CONNECT.cancel}
        </Button>
        <Button variant="primary" buttonRef={confirm} onClick={onConnect} isBusy={isConnecting} busyLabel={CONNECT.busy}>
          {CONNECT.confirm}
        </Button>
      </div>
    </Dialog>
  );
}
