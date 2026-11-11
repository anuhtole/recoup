import { AnimatePresence } from "motion/react";
import { Activity, ArrowUpRight, RefreshCw } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { Sources, SyncRun } from "../api";
import { Button } from "../components/Button";
import { Section } from "../components/Section";
import { type Connect, ConnectSheet, FEED_LABEL, GmailConnectDialog, num, relativeTime, runError, runResult } from "../components/Sources";
import { PageHeader, Pill } from "../components/ui";
import { VendorLogo } from "../components/VendorLogo";
import { demo, useDemo } from "../demo/flow";
import { formatDateTime, plural } from "../format";
import { cn } from "@/lib/utils";

interface Props {
  sources: Sources | null;
  /** The scripted demo: Gmail connects through the staged pop-up, not server setup. */
  isDemo: boolean;
  isAvailable: boolean;
  isSyncing: boolean;
  onSync: () => void;
}

function health(connected: boolean, run: SyncRun | null) {
  if (!connected) return "none" as const;
  if (run && !run.ok) return "attention" as const;
  return run ? ("ok" as const) : ("none" as const);
}

/**
 * One grid for every row, sub-rows included, so Status, Environment and Last sync line up. From 1024px it
 * is five columns; below that the name and status share a line and the rest wraps under the name.
 */
const GRID = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 lg:grid-cols-[minmax(0,1.5fr)_136px_96px_minmax(0,1fr)_88px]";

/** An empty cell: the one muted dash used everywhere on this page. Below 1024px it isn't shown at all. */
function Empty() {
  return (
    <span className="text-dim">
      <span aria-hidden>—</span>
      <span className="sr-only">None</span>
    </span>
  );
}

function SourceRow({
  icon,
  name,
  description,
  connected,
  environment,
  run,
  result,
  onConnect,
}: {
  icon: ReactNode;
  name: string;
  description: string;
  connected: boolean;
  environment: string | null;
  run: SyncRun | null;
  result: string | null;
  onConnect?: () => void;
}) {
  const h = health(connected, run);
  const error = runError(run);
  const hasSync = Boolean(run) || connected;
  return (
    <div className={cn(GRID, "border-t border-line py-4")}>
      <div className="flex min-w-0 items-center gap-3">
        {icon}
        <span className="flex min-w-0 flex-col">
          <span className="text-14 font-medium">{name}</span>
          <span className="text-13 text-dim text-pretty">{description}</span>
        </span>
      </div>
      <span className="justify-self-end lg:justify-self-start">
        {/* Mint means money; a working connection is plain ink on the neutral pill. */}
        <Pill label={connected ? (h === "attention" ? "Needs attention" : "Connected") : "Not connected"} tone={!connected ? "muted" : h === "attention" ? "amber" : "neutral"} />
      </span>
      <span className={cn("col-span-2 pl-10 text-14 lg:col-span-1 lg:block lg:pl-0", environment ? "block" : "hidden")}>{environment ?? <Empty />}</span>
      <span
        className={cn("col-span-2 flex-col pl-10 text-14 lg:col-span-1 lg:flex lg:pl-0", hasSync ? "flex" : "hidden")}
        title={error ?? (run ? formatDateTime(run.finished_at) : undefined)}
      >
        {run ? <span className="figure">{relativeTime(run.finished_at)}</span> : connected ? <span className="text-dim">Not synced yet</span> : <Empty />}
        {result && <span className={cn("text-13", run && !run.ok ? "text-amber-ink" : "text-dim")}>{result}</span>}
      </span>
      <span className={cn("col-span-2 pl-10 lg:col-span-1 lg:block lg:justify-self-end lg:pl-0", onConnect ? "block" : "hidden")}>
        {onConnect && (
          <Button size="sm" onClick={onConnect}>
            Connect
          </Button>
        )}
      </span>
    </div>
  );
}

/** A status feed under "Status pages": same grid, its state in the Status column. */
function FeedRow({ feed }: { feed: Sources["status_feeds"][number] }) {
  const seen = num(feed.last_sync?.detail, "incidents_seen");
  const label = FEED_LABEL[feed.key] ?? feed.key;
  const state = !feed.last_sync ? "Not read yet" : !feed.last_sync.ok ? "Couldn't reach the page" : seen !== null ? `${plural(seen, "incident")} read` : "Read";
  return (
    <div className={cn(GRID, "py-1.5")}>
      <span className="flex min-w-0 items-center gap-3 pl-10">
        <VendorLogo name={label} size={20} />
        <a
          href={feed.page_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-6 items-center gap-1 text-14 font-medium text-mint-ink underline-offset-4 hover:underline"
        >
          {label}
          <ArrowUpRight aria-hidden className="size-3.5 flex-none text-dim" strokeWidth={1.75} />
        </a>
      </span>
      <span className={cn("justify-self-end text-13 lg:justify-self-start", feed.last_sync && !feed.last_sync.ok ? "text-amber-ink" : "text-dim")}>{state}</span>
    </div>
  );
}

function StatusIcon() {
  return (
    <span aria-hidden className="grid size-7 flex-none place-items-center rounded-sm border border-line bg-paper text-dim">
      <Activity className="size-4" strokeWidth={1.75} />
    </span>
  );
}

/** Every source, where it stands, a Connect for the missing ones, and one "Sync now". */
export function SourcesPage({ sources, isDemo, isAvailable, isSyncing, onSync }: Props) {
  const [connecting, setConnecting] = useState<Connect | null>(null);
  const { busy, connectError } = useDemo();
  const isStaged = isDemo && connecting === "gmail";
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
            <span className={cn(background.last_error && "text-amber-ink")} title={background.last_error ?? undefined}>
              {background.last_error
                ? "Last background sync didn't finish"
                : background.running && background.interval_minutes > 0
                  ? `Syncs every ${plural(background.interval_minutes, "minute")}`
                  : "Syncs when you ask"}
            </span>
          ) : undefined
        }
      >
        {!sources ? (
          <p className="m-0 py-10 text-center text-14 text-dim">{isAvailable ? "Loading sources…" : "Sources aren't available right now."}</p>
        ) : (
          <div className="flex flex-col">
            <div className={cn(GRID, "hidden py-2 text-12 font-medium text-dim lg:grid")}>
              <span>Source</span>
              <span>Status</span>
              <span>Environment</span>
              <span>Last sync</span>
              <span />
            </div>
            <SourceRow
              icon={<VendorLogo name="Ramp" />}
              name="Ramp transactions"
              description="Ledger · card and bill payments"
              connected={sources.ramp.connected}
              environment={sources.ramp.connected ? (sources.ramp.environment === "sandbox" ? "Sandbox" : "Live") : null}
              run={sources.ramp.last_sync}
              result={sources.ramp.last_sync ? runResult("ramp", sources.ramp.last_sync) : null}
              onConnect={sources.ramp.connected ? undefined : () => setConnecting("ramp")}
            />
            <SourceRow
              icon={<VendorLogo name="Gmail" />}
              name="Gmail"
              description="Inbox · read-only · refund promises and replies"
              connected={sources.gmail.connected}
              environment={null}
              run={sources.gmail.last_sync}
              result={sources.gmail.last_sync ? runResult("gmail", sources.gmail.last_sync) : null}
              onConnect={sources.gmail.connected ? undefined : () => setConnecting("gmail")}
            />
            <SourceRow
              icon={<StatusIcon />}
              name="Status pages"
              description="Public incident feeds"
              connected={status?.configured ?? true}
              environment="Public"
              run={status?.last_sync ?? null}
              result={status?.last_sync ? (status.last_sync.ok ? "Finished" : "Didn't finish. Try Sync now again.") : null}
            />
            <div className="flex flex-col pb-3">
              {sources.status_feeds.map((feed) => (
                <FeedRow key={feed.key} feed={feed} />
              ))}
            </div>
          </div>
        )}
      </Section>
      <AnimatePresence>
        {isStaged ? (
          <GmailConnectDialog
            key="gmail"
            address={demo.address()}
            isConnecting={busy === "connecting"}
            error={connectError}
            onConnect={() => void demo.connectGmail().then((ok) => ok && setConnecting(null))}
            onClose={() => {
              demo.closeConnect();
              setConnecting(null);
            }}
          />
        ) : (
          connecting && <ConnectSheet key="connect" source={connecting} onClose={() => setConnecting(null)} />
        )}
      </AnimatePresence>
    </>
  );
}
