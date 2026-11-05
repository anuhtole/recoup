import { useState } from "react";
import type { Sources, SyncReport, SyncRun } from "../api";
import { formatDateTime } from "../format";
import { cn } from "@/lib/utils";
import { Button } from "./Button";
import { Sheet } from "./Sheet";

const STALE_MS = 24 * 60 * 60 * 1000;
const FEED_LABEL: Record<string, string> = { jira: "Jira", confluence: "Confluence", github: "GitHub" };

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

function configured(sources: Sources) {
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

/** Demo data comes bundled, so there is nothing to connect or sync: say so instead of "not synced". */
export function sourcesLabel(sources: Sources | null, isDemo = false): string {
  if (isDemo) return "Sample ledger and inbox";
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
  ok: "bg-money",
  attention: "bg-amber",
  none: "bg-dim/40",
};

export function StatusDot({ health }: { health: SourcesHealth }) {
  return <span aria-hidden className={cn("inline-block size-2 flex-none rounded-full", DOT[health])} />;
}

/** The quiet top-bar button: how many sources are on and when they last synced. */
export function SourcesButton({ sources, isDemo, onOpen }: { sources: Sources | null; isDemo: boolean; onOpen: () => void }) {
  const health = isDemo ? "ok" : sourcesHealth(sources);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      title={health === "attention" ? "A source needs attention" : "Data sources"}
      className="inline-flex h-9 items-center gap-2 rounded-full px-3 text-14 font-medium text-dim transition-[transform,background-color,color] duration-150 hover:bg-tint hover:text-ink active:scale-[0.97]"
    >
      <StatusDot health={health} />
      <span className="figure whitespace-nowrap">{sourcesLabel(sources, isDemo)}</span>
    </button>
  );
}

function num(detail: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = detail?.[key];
  return typeof value === "number" ? value : null;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** One line about the last sync, in plain words. */
function runResult(key: string, run: SyncRun): string {
  const error = run.detail?.error;
  if (!run.ok) return typeof error === "string" && error ? `Didn't finish: ${error}` : "Didn't finish.";
  if (key === "ramp") {
    const inserted = num(run.detail, "inserted");
    const pulled = num(run.detail, "pulled");
    return inserted !== null && pulled !== null ? `${plural(inserted, "new transaction")} of ${pulled} read.` : "Finished.";
  }
  if (key === "gmail") {
    const inserted = num(run.detail, "inserted");
    const fetched = num(run.detail, "fetched");
    return inserted !== null && fetched !== null ? `${plural(inserted, "new vendor email")} of ${fetched} read.` : "Finished.";
  }
  return "Finished.";
}

function Copyable({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <code className="whitespace-pre-wrap rounded-row bg-glass px-2 py-1 text-12 text-ink">{text}</code>
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
        className="rounded-full px-2 py-1 text-12 font-medium text-dim transition-colors hover:bg-tint hover:text-ink"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

function When({ run }: { run: SyncRun | null }) {
  if (!run) return <span>Not synced yet</span>;
  return (
    <span title={formatDateTime(run.finished_at)}>
      Synced <span className="figure">{relativeTime(run.finished_at)}</span>
    </span>
  );
}

function Row({
  name,
  source,
  connected,
  note,
  run,
  children,
}: {
  name: string;
  source: "ramp" | "gmail" | "status";
  connected: boolean;
  note?: string;
  run: SyncRun | null;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex list-none flex-col gap-2 rounded-row bg-tint px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-16 font-medium">{name}</span>
        <span className="flex items-center gap-2 text-14 text-dim">
          <StatusDot health={!connected ? "none" : run && !run.ok ? "attention" : run ? "ok" : "none"} />
          {connected ? "Connected" : "Not connected"}
          {note && <span>· {note}</span>}
        </span>
      </div>
      {connected && (
        <p className="flex flex-wrap gap-x-2 text-14 text-dim">
          <When run={run} />
          {run && source !== "status" && <span>· {runResult(source, run)}</span>}
        </p>
      )}
      {children}
    </li>
  );
}

interface SheetProps {
  sources: Sources | null;
  isAvailable: boolean;
  isSyncing: boolean;
  onSync: () => void;
  onClose: () => void;
}

/** Every source, where it stands, how to connect the missing ones, and one "Sync now". */
export function SourcesSheet({ sources, isAvailable, isSyncing, onSync, onClose }: SheetProps) {
  const status = sources?.connectors.find((c) => c.kind === "status");
  return (
    <Sheet labelId="sources-title" title="Data sources" subtitle="Read-only. Credentials stay on the server." onClose={onClose}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-2 pt-2">
        {!sources ? (
          <p className="rounded-row bg-tint px-4 py-3 text-14 text-dim">
            {isAvailable ? "Loading sources…" : "This server doesn't report its sources. Detection still runs on the data it has."}
          </p>
        ) : (
          <ul className="m-0 flex flex-col gap-2 p-0">
            <Row
              name="Ramp transactions"
              source="ramp"
              connected={sources.ramp.connected}
              note={sources.ramp.connected ? (sources.ramp.environment === "sandbox" ? "Sandbox" : "Production") : undefined}
              run={sources.ramp.last_sync}
            >
              {!sources.ramp.connected && (
                <p className="flex flex-col gap-2 text-14 text-dim">
                  Add the app's credentials to backend/.env on the server:
                  <Copyable text={"RECOUP_RAMP_CLIENT_ID=\nRECOUP_RAMP_CLIENT_SECRET="} />
                </p>
              )}
            </Row>
            <Row name="Gmail vendor email" source="gmail" connected={sources.gmail.connected} run={sources.gmail.last_sync}>
              {!sources.gmail.connected && (
                <p className="flex flex-col gap-2 text-14 text-dim">
                  With RECOUP_GMAIL_CLIENT_ID and RECOUP_GMAIL_CLIENT_SECRET in backend/.env, run this in backend/ on the server:
                  <Copyable text="recoup connect gmail" />
                </p>
              )}
            </Row>
            <Row name="Status pages" source="status" connected={status?.configured ?? true} note="No credentials needed" run={status?.last_sync ?? null}>
              <ul className="m-0 flex flex-col gap-1 p-0">
                {sources.status_feeds.map((feed) => {
                  const seen = num(feed.last_sync?.detail, "incidents_seen");
                  return (
                    <li key={feed.key} className="flex list-none flex-wrap items-baseline justify-between gap-x-4 text-14">
                      <a href={feed.page_url} target="_blank" rel="noopener noreferrer" className="text-ink underline decoration-line-strong underline-offset-4 hover:decoration-current">
                        {FEED_LABEL[feed.key] ?? feed.key}
                      </a>
                      <span className="text-dim">
                        {!feed.last_sync
                          ? "Not read yet"
                          : !feed.last_sync.ok
                            ? "Couldn't reach the page"
                            : seen !== null
                              ? `${plural(seen, "incident")} read`
                              : "Read"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Row>
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-4 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4">
        <Button variant="primary" onClick={onSync} isBusy={isSyncing} disabled={!isAvailable}>
          Sync now
        </Button>
        <p className="text-14 text-dim">Pulls every connected source, then looks for new money owed.</p>
      </div>
    </Sheet>
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
