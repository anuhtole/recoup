import { Activity, ArrowUpRight, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import type { Sources, SyncRun } from "../api";
import { Button } from "../components/Button";
import { Section } from "../components/Section";
import { Copyable, FEED_LABEL, num, relativeTime, runResult } from "../components/Sources";
import { PageHeader, Pill } from "../components/ui";
import { VendorLogo } from "../components/VendorLogo";
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

const GRID = "grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,1.2fr)]";

function SourceRow({
  icon,
  name,
  kind,
  connected,
  environment,
  run,
  result,
  children,
}: {
  icon: ReactNode;
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
    <li className="list-none border-b border-line py-4">
      <div className={cn(GRID, "items-center")}>
        <div className="flex min-w-0 items-center gap-3">
          {icon}
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-14 font-medium">{name}</span>
            <span className="truncate text-13 text-dim">{kind}</span>
          </span>
        </div>
        <span className="justify-self-end lg:justify-self-start">
          <Pill label={connected ? (h === "attention" ? "Needs attention" : "Connected") : "Not connected"} tone={!connected ? "muted" : h === "attention" ? "amber" : "mint"} />
        </span>
        <span className="hidden text-14 lg:block">{environment}</span>
        <span className="col-span-2 flex flex-col pl-10 text-14 lg:col-span-1 lg:pl-0" title={run ? formatDateTime(run.finished_at) : undefined}>
          {run ? <span className="figure">{relativeTime(run.finished_at)}</span> : <span className="text-dim">{connected ? "Not synced yet" : "—"}</span>}
          {result && <span className={cn("text-13", run && !run.ok ? "text-amber-ink" : "text-dim")}>{result}</span>}
        </span>
      </div>
      {children && <div className="mt-3 flex flex-col gap-2 pl-10">{children}</div>}
    </li>
  );
}

function StatusIcon() {
  return (
    <span aria-hidden className="grid size-7 flex-none place-items-center rounded-sm border border-line bg-paper text-dim">
      <Activity className="size-4" strokeWidth={1.75} />
    </span>
  );
}

/** Every source, where it stands, how to connect the missing ones, and one "Sync now". */
export function SourcesPage({ sources, isAvailable, isSyncing, onSync }: Props) {
  const status = sources?.connectors.find((c) => c.kind === "status");
  const background = sources?.background_sync;
  return (
    <>
      <PageHeader
        actions={
          <Button variant="primary" size="sm" onClick={onSync} isBusy={isSyncing} busyLabel="Syncing…" disabled={!isAvailable}>
            <RefreshCw aria-hidden className="size-3.5" strokeWidth={2} />
            Sync now
          </Button>
        }
      />
      <Section
        title="Data sources"
        meta={
          background ? (
            <span className={cn(background.last_error && "text-amber-ink")}>
              {background.last_error
                ? `Last background sync failed: ${background.last_error}`
                : background.running && background.interval_minutes > 0
                  ? `Syncs every ${plural(background.interval_minutes, "minute")}`
                  : "Syncs when you ask"}
            </span>
          ) : undefined
        }
      >
        {!sources ? (
          <p className="m-0 py-10 text-center text-14 text-dim">{isAvailable ? "Loading sources…" : "This server doesn't report its sources."}</p>
        ) : (
          <>
            <div className={cn(GRID, "hidden border-b border-line py-2 text-12 font-medium text-dim lg:grid")}>
              <span>Source</span>
              <span>Status</span>
              <span>Environment</span>
              <span>Last sync</span>
            </div>
            <ul className="m-0 flex flex-col p-0">
              <SourceRow
                icon={<VendorLogo name="Ramp" />}
                name="Ramp transactions"
                kind="Ledger · card and bill payments"
                connected={sources.ramp.connected}
                environment={sources.ramp.connected ? (sources.ramp.environment === "sandbox" ? "Sandbox" : "Production") : "—"}
                run={sources.ramp.last_sync}
                result={sources.ramp.last_sync ? runResult("ramp", sources.ramp.last_sync) : null}
              >
                {!sources.ramp.connected && (
                  <>
                    <p className="m-0 text-13 text-dim">To connect, add the Ramp app's keys to backend/.env on the server:</p>
                    <Copyable text={"RECOUP_RAMP_CLIENT_ID=\nRECOUP_RAMP_CLIENT_SECRET="} />
                  </>
                )}
              </SourceRow>
              <SourceRow
                icon={<VendorLogo name="Gmail" />}
                name="Gmail vendor email"
                kind="Inbox · refund promises and replies"
                connected={sources.gmail.connected}
                environment={sources.gmail.connected ? "Read-only" : "—"}
                run={sources.gmail.last_sync}
                result={sources.gmail.last_sync ? runResult("gmail", sources.gmail.last_sync) : null}
              >
                {!sources.gmail.connected && (
                  <>
                    <p className="m-0 text-13 text-dim">
                      To connect, add RECOUP_GMAIL_CLIENT_ID and RECOUP_GMAIL_CLIENT_SECRET to backend/.env, then run this in backend/:
                    </p>
                    <Copyable text="recoup connect gmail" />
                  </>
                )}
              </SourceRow>
              <SourceRow
                icon={<StatusIcon />}
                name="Status pages"
                kind="Public incidents · no credentials needed"
                connected={status?.configured ?? true}
                environment="Public"
                run={status?.last_sync ?? null}
                result={status?.last_sync ? (status.last_sync.ok ? "Finished" : "Didn't finish") : null}
              >
                <ul className="m-0 flex max-w-sm flex-col p-0">
                  {sources.status_feeds.map((feed) => {
                    const seen = num(feed.last_sync?.detail, "incidents_seen");
                    const label = FEED_LABEL[feed.key] ?? feed.key;
                    return (
                      <li key={feed.key} className="flex list-none items-center gap-3 py-1.5">
                        <VendorLogo name={label} size={20} />
                        <a
                          href={feed.page_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-6 items-center gap-1 text-14 font-medium underline decoration-line-strong underline-offset-4 hover:decoration-current"
                        >
                          {label}
                          <ArrowUpRight aria-hidden className="size-3.5 flex-none text-dim" strokeWidth={1.75} />
                        </a>
                        <span className="ml-auto text-13 text-dim">
                          {!feed.last_sync ? "Not read yet" : !feed.last_sync.ok ? "Couldn't reach the page" : seen !== null ? `${plural(seen, "incident")} read` : "Read"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </SourceRow>
            </ul>
          </>
        )}
      </Section>
    </>
  );
}
