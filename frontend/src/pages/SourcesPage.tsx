import { ArrowUpRight, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import type { Sources, SyncRun } from "../api";
import { Button } from "../components/Button";
import { Copyable, FEED_LABEL, num, relativeTime, runResult, StatusDot } from "../components/Sources";
import { Label, PageHeader, Pill } from "../components/ui";
import { formatDateTime, plural } from "../format";
import { cn } from "@/lib/utils";

interface Props {
  sources: Sources | null;
  isAvailable: boolean;
  isSyncing: boolean;
  onSync: () => void;
}

function health(connected: boolean, run: SyncRun | null) {
  if (!connected) return "none" as const;
  if (run && !run.ok) return "attention" as const;
  return run ? ("ok" as const) : ("none" as const);
}

function SourceRow({
  name,
  kind,
  connected,
  environment,
  run,
  result,
  children,
}: {
  name: string;
  kind: string;
  connected: boolean;
  environment: string;
  run: SyncRun | null;
  result: string | null;
  children?: ReactNode;
}) {
  const h = health(connected, run);
  return (
    <li className="list-none border-b border-line last:border-b-0">
      <div className="grid grid-cols-1 gap-4 px-5 py-5 lg:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))] lg:items-start">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex items-center gap-2 text-14 font-semibold">
            <StatusDot health={h} className={h === "ok" ? "bg-mint-ink" : undefined} />
            {name}
          </span>
          <span className="text-13 text-dim">{kind}</span>
        </div>
        <div className="flex flex-col gap-1">
          <Label as="span">Status</Label>
          <span>
            <Pill label={connected ? (h === "attention" ? "Needs attention" : "Connected") : "Not connected"} tone={!connected ? "muted" : h === "attention" ? "amber" : h === "ok" ? "mint" : "neutral"} />
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <Label as="span">Environment</Label>
          <span className="text-14">{environment}</span>
        </div>
        <div className="flex flex-col gap-1">
          <Label as="span">Last sync</Label>
          <span className="text-14" title={run ? formatDateTime(run.finished_at) : undefined}>
            {run ? <span className="figure">{relativeTime(run.finished_at)}</span> : <span className="text-dim">Not synced yet</span>}
          </span>
          {result && <span className={cn("text-13", run && !run.ok ? "text-amber-ink" : "text-dim")}>{result}</span>}
        </div>
      </div>
      {children && <div className="flex flex-col gap-3 px-5 pb-5">{children}</div>}
    </li>
  );
}

/** Every source, where it stands, how to connect the missing ones, and one "Sync now". */
export function SourcesPage({ sources, isAvailable, isSyncing, onSync }: Props) {
  const status = sources?.connectors.find((c) => c.kind === "status");
  return (
    <>
      <PageHeader
        crumbs={<span>Recoup / Sources</span>}
        title="Sources"
        meta={<p className="m-0 text-14 text-dim">Read-only. Credentials stay on the server.</p>}
        actions={
          <Button variant="primary" onClick={onSync} isBusy={isSyncing} busyLabel="Syncing…" disabled={!isAvailable}>
            <RefreshCw aria-hidden className="size-4" strokeWidth={2} />
            Sync now
          </Button>
        }
      />
      {sources?.background_sync && (
        <p className="label m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-dim">
          <span>
            {sources.background_sync.running && sources.background_sync.interval_minutes > 0
              ? `Background sync · every ${sources.background_sync.interval_minutes} min`
              : "Background sync off · sync on demand"}
          </span>
          {sources.background_sync.last_error && <span className="normal-case tracking-normal text-amber-ink">Last error: {sources.background_sync.last_error}</span>}
        </p>
      )}
      <section aria-label="Data sources" className="card overflow-hidden">
        {!sources ? (
          <p className="m-0 px-5 py-10 text-center text-14 text-dim">
            {isAvailable ? "Loading sources…" : "This server doesn't report its sources. Detection still runs on the data it has."}
          </p>
        ) : (
          <ul className="m-0 flex flex-col p-0">
            <SourceRow
              name="Ramp transactions"
              kind="Ledger · card and bill payments"
              connected={sources.ramp.connected}
              environment={sources.ramp.connected ? (sources.ramp.environment === "sandbox" ? "Sandbox" : "Production") : "—"}
              run={sources.ramp.last_sync}
              result={sources.ramp.last_sync ? runResult("ramp", sources.ramp.last_sync) : null}
            >
              {!sources.ramp.connected && (
                <>
                  <p className="m-0 text-13 text-dim">Add the app's credentials to backend/.env on the server:</p>
                  <Copyable text={"RECOUP_RAMP_CLIENT_ID=\nRECOUP_RAMP_CLIENT_SECRET="} />
                </>
              )}
            </SourceRow>
            <SourceRow
              name="Gmail vendor email"
              kind="Inbox · refund promises and replies"
              connected={sources.gmail.connected}
              environment={sources.gmail.connected ? "Read-only scope" : "—"}
              run={sources.gmail.last_sync}
              result={sources.gmail.last_sync ? runResult("gmail", sources.gmail.last_sync) : null}
            >
              {!sources.gmail.connected && (
                <>
                  <p className="m-0 text-13 text-dim">With RECOUP_GMAIL_CLIENT_ID and RECOUP_GMAIL_CLIENT_SECRET in backend/.env, run this in backend/ on the server:</p>
                  <Copyable text="recoup connect gmail" />
                </>
              )}
            </SourceRow>
            <SourceRow
              name="Status pages"
              kind="Public incidents · no credentials needed"
              connected={status?.configured ?? true}
              environment="Public"
              run={status?.last_sync ?? null}
              result={status?.last_sync ? (status.last_sync.ok ? "Finished." : "Didn't finish.") : null}
            >
              <ul className="m-0 grid grid-cols-1 gap-2 p-0 sm:grid-cols-3">
                {sources.status_feeds.map((feed) => {
                  const seen = num(feed.last_sync?.detail, "incidents_seen");
                  return (
                    <li key={feed.key} className="field-box flex list-none flex-col gap-1 px-3 py-2">
                      <a
                        href={feed.page_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between gap-2 text-14 font-medium underline decoration-line-strong underline-offset-4 hover:decoration-current"
                      >
                        {FEED_LABEL[feed.key] ?? feed.key}
                        <ArrowUpRight aria-hidden className="size-3.5 flex-none text-dim" strokeWidth={1.75} />
                      </a>
                      <span className="label text-dim">
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
            </SourceRow>
          </ul>
        )}
      </section>
      <p className="m-0 text-13 text-dim">Sync now pulls every connected source, then looks for new money owed.</p>
    </>
  );
}
