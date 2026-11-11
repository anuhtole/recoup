// The agent page: the particle coin is the one focal object, with one input under it; the agent answers
// and hands over its controls in one box in the top-right corner, which scrolls inside itself.
// The page is a view of the scripted demo: demo/flow.ts holds the conversation and runs each step (real
// calls: connect, scan, draft, send), demo/script.ts holds every word. This file only draws them.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type Ref } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Activity, ArrowRight, ArrowUp, Check, Plus, Radar } from "lucide-react";
import type { Finding, Sources, Summary } from "../api";
import { Button } from "../components/Button";
import { Coin, reducedMotion, type CoinHandle, type CoinState, type RingKind, type ShapeKind } from "../components/coin/Coin";
import SlideToConfirm from "../components/kokonutui/slide-to-confirm";
import { type Connect, ConnectSheet, GmailConnectDialog, num } from "../components/Sources";
import { Tag } from "../components/ui";
import { VendorLogo } from "../components/VendorLogo";
import { factsOf, isOut, outcomeOf, requestsOf, sum, type Facts, type Outcome } from "../demo/facts";
import { demo, useDemo, type DemoState, type Message } from "../demo/flow";
import { APPROVAL, CAPTION, HINT, SAY, SCAN, WORKING } from "../demo/script";
import { daysHint, formatDate, formatMoney, plural } from "../format";
import { typeLabel } from "../lib/claimTypes";
import { vendorName } from "../lib/vendors";
import { cn } from "@/lib/utils";
import { SPRING } from "../motion";
import type { Tone } from "../theme";

const DIAL_DAYS = 120; // one lap of the deadline ring
const WORD_GAP = 0.11; // seconds between words of a reply

interface CoinLook {
  ring: RingKind | null;
  shape: ShapeKind | null;
  value: number;
  bars?: number[];
  figure?: string;
  figureLabel?: string;
}

const PLAIN: CoinLook = { ring: null, shape: null, value: 0 };

/** What the coin turns into for each view: a ring with a figure inside, another shape, or the coin itself. */
function lookOf(state: DemoState, facts: Facts, outcome: Outcome): CoinLook {
  const { view, progress } = state;
  if (view === "radar") return { ...PLAIN, shape: "radar" };
  if (view === "plane") return { ...PLAIN, shape: "plane" };
  if (view === "bars" && facts.vendors.length > 0) {
    const largest = facts.vendors[0].minor;
    return {
      ...PLAIN,
      shape: "bars",
      bars: facts.vendors.map((vendor) => vendor.minor / largest),
      figure: formatMoney(facts.ready),
      figureLabel: `owed by ${plural(facts.vendorCount, "vendor")}`,
    };
  }
  if (view === "check" && outcome.rows.length > 0) {
    return {
      ...PLAIN,
      shape: "check",
      value: outcome.refunded.length / outcome.rows.length,
      figure: formatMoney(outcome.back),
      figureLabel: `back from ${outcome.refunded.length} of ${plural(outcome.rows.length, "request")}`,
    };
  }
  if (view === "savings") {
    const total = facts.recovered + facts.inFlight + facts.ready;
    return {
      ...PLAIN,
      ring: "savings",
      value: total ? facts.recovered / total : 0,
      figure: formatMoney(facts.recovered),
      figureLabel: `recovered of ${formatMoney(total)}`,
    };
  }
  if (view === "clock" && facts.soonest && facts.soonest.days_left !== null) {
    const days = Math.max(0, facts.soonest.days_left);
    return {
      ...PLAIN,
      ring: "deadline",
      value: Math.min(days, DIAL_DAYS) / DIAL_DAYS,
      figure: days === 0 ? "Today" : plural(days, "day"),
      figureLabel: `${vendorName(facts.soonest.merchant)} · ${formatMoney(facts.soonest.amount_minor)}`,
    };
  }
  if (view === "progress") {
    return {
      ...PLAIN,
      ring: "savings",
      value: progress.total ? progress.done / progress.total : 0,
      figure: `${progress.done} of ${progress.total}`,
      figureLabel: "drafted",
    };
  }
  return PLAIN;
}

interface Key {
  label: string;
  value?: string;
  color: string;
}

function captionOf(state: DemoState, look: CoinLook, facts: Facts, outcome: Outcome, scanLine: string): { title: string; sub: string; keys: Key[] } {
  if (look.shape === "radar") return { title: CAPTION.radar.title, sub: `${scanLine}…`, keys: [] };
  if (look.shape === "plane") return { ...CAPTION.plane, keys: [] };
  if (look.shape === "bars") {
    return {
      title: CAPTION.bars.title,
      sub: CAPTION.bars.sub(facts.ready, facts.vendorCount),
      // Left to right, the same order as the bars.
      keys: facts.vendors.map((vendor) => ({ label: vendor.name, value: formatMoney(vendor.minor), color: "var(--mint-ink)" })),
    };
  }
  if (look.shape === "check") {
    const part = (label: string, rows: Finding[], color: string): Key[] => (rows.length ? [{ label, value: formatMoney(sum(rows)), color }] : []);
    return {
      title: CAPTION.check.title,
      sub: CAPTION.check.sub(outcome.refunded.length, outcome.rows.length),
      keys: [
        { label: "Refunded", value: formatMoney(outcome.back), color: "var(--mint-ink)" },
        ...part("Agreed, awaiting credit", outcome.agreed, "var(--share-2)"),
        ...part("No reply yet", outcome.waiting, "var(--line-strong)"),
        ...part("Needs your reply", outcome.onYou, "var(--amber)"),
      ],
    };
  }
  if (state.view === "savings") {
    return {
      ...CAPTION.savings,
      keys: [
        { label: "Recovered", value: formatMoney(facts.recovered), color: "var(--mint-ink)" },
        { label: "Waiting on vendor", value: formatMoney(facts.inFlight), color: "var(--share-2)" },
        { label: "Ready to claim", value: formatMoney(facts.ready), color: "var(--mint)" },
        { label: "Missed", value: formatMoney(facts.missed), color: "var(--line-strong)" },
      ],
    };
  }
  if (state.view === "clock") return { title: CAPTION.clock.title, sub: look.ring ? CAPTION.clock.sub(DIAL_DAYS) : CAPTION.clock.none, keys: [] };
  if (state.view === "progress") return { title: CAPTION.drafting.title, sub: CAPTION.drafting.sub(state.progress.done, state.progress.total), keys: [] };
  if (state.step === "approve") return { ...CAPTION.approval, keys: [] };
  return { ...CAPTION.coin, keys: [] };
}

/** Who is speaking, above each of the agent's lines. Screen readers get it from the line itself. */
function Speaker() {
  return (
    <span aria-hidden className="text-12 text-dim">
      Recoup
    </span>
  );
}

function ClaimLine({ finding, note }: { finding: Finding; note?: string }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <VendorLogo name={finding.merchant} size={20} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2">
          <span className="truncate text-14 font-medium">{vendorName(finding.merchant)}</span>
          {finding.outcome === "needs_review" && <Tag tone="amber">Needs review</Tag>}
        </span>
        <span className="truncate text-12 text-dim">
          {typeLabel(finding.leak_type)}
          {note && ` · ${note}`}
        </span>
      </span>
    </span>
  );
}

const amount = (finding: Finding) => <span className="figure flex-none text-14">{formatMoney(finding.amount_minor)}</span>;

/** A bordered list of claims with one line under it. */
function ClaimList({ children, footer }: { children: ReactNode; footer: ReactNode }) {
  return (
    <div className="flex flex-col rounded-md border border-line">
      <ul className="m-0 flex flex-col p-0">{children}</ul>
      <div className="flex min-h-10 items-center justify-between gap-3 px-3 py-2 text-13 text-dim">{footer}</div>
    </div>
  );
}

const ROW = "flex min-h-12 list-none items-center gap-3 border-b border-line px-3 py-2";

/** The claims due soon. The ones that can be sent get a tick as each is drafted. */
function UrgentCard({ rows, drafts }: { rows: Finding[]; drafts: Record<number, number> }) {
  const sendable = rows.filter((f) => f.outcome === "recoverable");
  return (
    <ClaimList
      footer={
        <>
          <span>{plural(sendable.length, "request")} to draft</span>
          <span className="figure text-ink">{formatMoney(sum(sendable))}</span>
        </>
      }
    >
      {rows.map((f) => {
        const mark = isOut(f) ? "Sent" : f.status === "drafted" || drafts[f.id] ? "Drafted" : null;
        return (
          <li key={f.id} className={ROW}>
            <ClaimLine finding={f} note={isOut(f) ? undefined : (daysHint(f.days_left) ?? undefined)} />
            {mark && (
              <span className="flex flex-none items-center gap-1 text-12 text-dim">
                <Check aria-hidden className="size-3.5 text-mint-ink" strokeWidth={2} />
                {mark}
              </span>
            )}
            {amount(f)}
          </li>
        );
      })}
    </ClaimList>
  );
}

/**
 * The drafted requests, then the one step the agent can't take for you: one slide sends them all.
 * Once they have gone the slide is replaced by a line saying so.
 */
function ApprovalCard({ rows, isLive, isBusy, sentOn }: { rows: Finding[]; isLive: boolean; isBusy: boolean; sentOn: string }) {
  // A slide that was used in this visit stays, showing "Sent"; one restored after a refresh is not drawn again.
  const [wasLive] = useState(isLive);
  const isSent = rows.length > 0 && rows.every(isOut);
  // The day they went, kept from the moment they did: the clock may move on while this is on screen.
  const sentDay = useRef<string | null>(null);
  if (isSent && sentDay.current === null) sentDay.current = sentOn;
  return (
    <div className="flex flex-col gap-3">
      <ClaimList
        footer={
          <>
            <span>
              {plural(rows.length, "request")} · {isSent ? "sent" : "not sent"}
            </span>
            <span className="figure font-semibold text-ink">{formatMoney(sum(rows))}</span>
          </>
        }
      >
        {rows.map((f) => (
          <li key={f.id} className="list-none border-b border-line">
            <a href={`#/claims/${f.id}`} className="flex min-h-12 items-center gap-3 px-3 py-2 transition-colors hover:bg-wash">
              <ClaimLine finding={f} note={!isOut(f) && f.recover_by ? `respond by ${formatDate(f.recover_by, "short")}` : undefined} />
              {amount(f)}
            </a>
          </li>
        ))}
      </ClaimList>
      {wasLive ? (
        // Amber while it waits on you; once they have gone it is no longer a question.
        <div className={cn("flex flex-col gap-3 rounded-md p-4 transition-colors duration-200 ease-out", isSent ? "bg-wash" : "bg-amber-wash")}>
          <div className="flex flex-col">
            <span className={cn("text-14 font-medium", !isSent && "text-amber-ink")}>{isSent ? APPROVAL.sentTitle : APPROVAL.title}</span>
            <span className="text-13 text-dim">{isSent ? APPROVAL.sentNote(rows.length, sentDay.current ?? sentOn) : APPROVAL.note}</span>
          </div>
          <SlideToConfirm
            surface="paper"
            label={APPROVAL.slide(rows.length)}
            armedLabel={APPROVAL.armed}
            confirmingLabel={APPROVAL.sending}
            doneLabel={APPROVAL.done}
            resetAfter={null}
            disabled={isLive && isBusy}
            onConfirm={demo.sendBatch}
          />
        </div>
      ) : (
        isSent && (
          <p className="m-0 flex items-center gap-2 text-13 text-dim">
            <Check aria-hidden className="size-4 flex-none text-mint-ink" strokeWidth={2} />
            {APPROVAL.sentTitle}
          </p>
        )
      )}
    </div>
  );
}

const STANDING: Partial<Record<Finding["status"], { label: string; tone: Tone }>> = {
  recovered: { label: "Refunded", tone: "mint" },
  vendor_agreed: { label: "Agreed", tone: "neutral" },
  sent: { label: "No reply yet", tone: "muted" },
  info_requested: { label: "Needs your reply", tone: "amber" },
  vendor_declined: { label: "Declined", tone: "amber" },
};

/** Where each sent request stands, and the money that is back. */
function OutcomeCard({ rows }: { rows: Finding[] }) {
  const { refunded, back } = outcomeOf(rows);
  return (
    <ClaimList
      footer={
        <>
          <span>
            {refunded.length} of {rows.length} refunded
          </span>
          <span className="figure font-semibold text-mint-ink">+{formatMoney(back)}</span>
        </>
      }
    >
      {rows.map((f) => {
        const standing = STANDING[f.status];
        return (
          <li key={f.id} className="list-none border-b border-line">
            <a href={`#/claims/${f.id}`} className="flex min-h-12 items-center gap-3 px-3 py-2 transition-colors hover:bg-wash">
              <ClaimLine finding={f} />
              {standing && <Tag tone={standing.tone}>{standing.label}</Tag>}
              <span className={cn("figure flex-none text-14", f.status === "recovered" && "text-mint-ink")}>
                {f.status === "recovered" ? `+${formatMoney(f.recovered_minor ?? f.amount_minor)}` : formatMoney(f.amount_minor)}
              </span>
            </a>
          </li>
        );
      })}
    </ClaimList>
  );
}

/**
 * What the agent reads from, with a way to connect what is missing without leaving the page, and under
 * the list the scan's own button: off, with the reason beside it, until Gmail is connected.
 */
function AgentSources({
  sources,
  state,
  scanLine,
  gmailRef,
  scanRef,
  onConnect,
}: {
  sources: Sources | null;
  state: DemoState;
  scanLine: string;
  gmailRef: Ref<HTMLButtonElement>;
  scanRef: Ref<HTMLButtonElement>;
  onConnect: (source: Connect) => void;
}) {
  const status = sources?.connectors.find((c) => c.kind === "status");
  const gmail = sources?.gmail.connected ?? false;
  const rows: { key: string; name: string; note: string; connected: boolean; connect?: Connect }[] = [
    { key: "ramp", name: "Ramp", note: "Transactions", connected: sources?.ramp.connected ?? false, connect: "ramp" },
    { key: "gmail", name: "Gmail", note: "Vendor email", connected: gmail, connect: "gmail" },
    { key: "status", name: "Status pages", note: "Outages", connected: status?.configured ?? true },
  ];
  const isScanning = state.busy === "scanning";
  const hasScanned = state.step !== "intro" && state.step !== "offer_gmail" && state.step !== "connect" && state.step !== "ready_scan";
  const note = !gmail ? SCAN.needsGmail : isScanning ? `${scanLine}…` : hasScanned ? SCAN.done(num(sources?.gmail.last_sync?.detail, "fetched")) : SCAN.ready;
  return (
    <>
      <section aria-label="Sources" className="flex flex-none flex-col gap-2 border-t border-line px-5 pb-3 pt-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="m-0 text-12 font-medium text-dim">Sources the agent reads</h2>
          <a href="#/sources" className="text-12 font-medium text-mint-ink underline-offset-4 hover:underline">
            Manage
          </a>
        </div>
        <ul className="m-0 flex flex-col p-0">
          {rows.map((row) => (
            <li key={row.key} className="flex min-h-10 list-none items-center gap-3">
              {row.key === "status" ? (
                <span aria-hidden className="grid size-5 flex-none place-items-center rounded-xs border border-line text-dim">
                  <Activity className="size-3" strokeWidth={1.75} />
                </span>
              ) : (
                <VendorLogo name={row.name} size={20} />
              )}
              <span className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="truncate text-14 font-medium">{row.name}</span>
                <span className="truncate text-12 text-dim">{row.note}</span>
              </span>
              {!sources ? (
                <span className="text-12 text-dim">Checking…</span>
              ) : row.connected ? (
                <span className="flex flex-none items-center gap-1.5 text-12 text-dim">
                  <Check aria-hidden className="size-3.5 text-mint-ink" strokeWidth={2} />
                  Connected
                </span>
              ) : (
                row.connect && (
                  <Button
                    size="sm"
                    buttonRef={row.key === "gmail" ? gmailRef : undefined}
                    // The agent pressing it: the same look as a finger on it, held for a moment.
                    className={cn("flex-none", row.key === "gmail" && state.isPressing && "scale-[0.96] border-line-strong bg-ground")}
                    aria-label={`Connect ${row.name}`}
                    disabled={state.busy !== null && !(row.key === "gmail" && state.isPressing)}
                    onClick={() => onConnect(row.connect as Connect)}
                  >
                    <Plus aria-hidden className="size-3.5 text-dim" strokeWidth={2} />
                    Connect
                  </Button>
                )
              )}
            </li>
          ))}
        </ul>
      </section>
      <div className="flex flex-none items-center justify-between gap-3 border-t border-line px-5 py-3">
        <p aria-live="polite" className="m-0 min-w-0 flex-1 truncate text-12 text-dim">
          {note}
        </p>
        <Button
          size="sm"
          // The one green button while the scan is the next step; a quiet one after.
          variant={state.step === "ready_scan" ? "primary" : "secondary"}
          buttonRef={scanRef}
          className="flex-none"
          disabled={!gmail || state.busy !== null}
          onClick={() => void demo.scan()}
        >
          <Radar aria-hidden className="size-3.5" strokeWidth={2} />
          {isScanning ? SCAN.running : hasScanned ? SCAN.again : SCAN.button}
        </Button>
      </div>
    </>
  );
}

interface AgentProps {
  summary: Summary;
  findings: Finding[];
  sources: Sources | null;
  /** The app is advancing the clock, running detection or restarting: answers would use data about to change. */
  isHeld?: boolean;
}

export function Agent({ summary, findings, sources, isHeld = false }: AgentProps) {
  const state = useDemo();
  const { messages, busy, step } = state;
  const facts = useMemo(() => factsOf(summary, findings), [summary, findings]);
  const byId = useMemo(() => new Map(findings.map((f) => [f.id, f])), [findings]);
  const outcome = useMemo(() => outcomeOf(requestsOf(findings, state.batch)), [findings, state.batch]);
  const rowsOf = (message: Message) => (message.ids ?? []).map((id) => byId.get(id)).filter((f): f is Finding => f !== undefined);

  const [text, setText] = useState("");
  const [connecting, setConnecting] = useState<Connect | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const coin = useRef<CoinHandle | null>(null);
  const gmailButton = useRef<HTMLButtonElement>(null);
  const scanButton = useRef<HTMLButtonElement>(null);

  // The reply being spoken: its words arrive one at a time and each one keeps the coin's voice going.
  // Only a reply that arrives while the page is open is spoken; a stored conversation is just shown.
  const last = messages[messages.length - 1];
  const shownAtOpen = useRef(state.nextId);
  const [heard, setHeard] = useState(last?.id ?? 0);
  const [speech, setSpeech] = useState<{ id: number; shown: number } | null>(null);
  // Set while rendering, so a new reply never shows whole for a frame before its first word.
  if (last && last.id !== heard) {
    setHeard(last.id);
    setSpeech(last.from === "agent" && !reducedMotion ? { id: last.id, shown: 0 } : null);
  }

  const spoken = speech ? messages.find((m) => m.id === speech.id) : undefined;
  const wordCount = spoken ? spoken.text.split(" ").length : 0;
  useEffect(() => {
    if (!speech) return;
    if (speech.shown >= wordCount) {
      setSpeech(null);
      return;
    }
    const timer = window.setTimeout(() => {
      coin.current?.pulse();
      setSpeech((now) => (now && now.id === speech.id ? { id: now.id, shown: now.shown + 1 } : now));
    }, WORD_GAP * 1000);
    return () => window.clearTimeout(timer);
  }, [speech, wordCount]);

  // A stored conversation opens at its latest line. After that the newest line is kept in view (not on
  // load on a phone, where the page itself scrolls and should open at the top).
  useLayoutEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, []);
  const isSpeaking = speech !== null;
  const isOpening = useRef(true);
  useEffect(() => {
    if (isOpening.current) {
      isOpening.current = false;
      return;
    }
    end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages.length, busy, isSpeaking, state.progress.done]);

  const pulled = num(sources?.ramp.last_sync?.detail, "pulled");
  const scanSteps = SAY.scanSteps(state.scanRun?.emails_read ?? null, state.scanRun?.transactions ?? pulled);
  const scanLine = scanSteps[Math.min(state.scanLine, scanSteps.length - 1)];

  const look = lookOf(state, facts, outcome);
  const caption = captionOf(state, look, facts, outcome, scanLine);
  const isShaped = look.ring !== null || look.shape !== null;
  // A ring or a shape is a still thing, so the coin's states only play while it is a coin.
  const coinState: CoinState = isShaped
    ? "idle"
    : busy === "thinking" || busy === "connecting"
      ? "thinking"
      : state.isFound
        ? "found"
        : speech
          ? "talking"
          : step === "approve"
            ? "approval"
            : "idle";

  const isBusy = busy !== null || state.isDialogOpen || isHeld;
  const running =
    busy === "thinking"
      ? WORKING.thinking
      : busy === "connecting"
        ? WORKING.connecting
        : busy === "drafting"
            ? WORKING.drafting(state.progress.done, state.progress.total)
            : busy === "sending"
              ? WORKING.sending(state.progress.done, state.progress.total)
              : null;
  const liveApproval = [...messages].reverse().find((m) => m.card === "approval")?.id;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (isBusy || !text.trim()) return;
    demo.ask(text);
    setText("");
  };
  const onConnect = (source: Connect) => {
    if (source === "gmail" && summary.demo_mode) demo.openConnect();
    else setConnecting(source);
  };

  return (
    <div className="agent-frame flex min-h-0 flex-col gap-6 pb-28 md:flex-row md:gap-8 md:pb-0">
      {/* The coin's column. The space above the coin and the caption's block below it share what is left 7:10,
          which puts the coin where the design has it and keeps it there when a view adds its key. */}
      <div className="flex min-w-0 flex-col items-center md:flex-1">
        <div aria-hidden className="hidden md:block md:grow-7 md:basis-0" />
        <Coin
          state={coinState}
          plays={state.bursts}
          ring={look.ring}
          shape={look.shape}
          bars={look.bars}
          value={look.value}
          figure={look.figure}
          figureLabel={look.figureLabel}
          onShapeDone={demo.planeDone}
          label={look.figure ? `${caption.title}: ${look.figure} ${look.figureLabel ?? ""}` : isShaped ? `${caption.title}. ${caption.sub}` : "The Recoup coin, drawn in particles"}
          handleRef={coin}
          className="agent-coin flex-none max-md:w-48 sm:max-md:w-64"
        />
        <div className="flex w-full max-w-70 flex-none flex-col gap-3 pt-4 md:grow-10 md:basis-0 md:pb-4 md:pt-6 xl:max-w-120">
          <div className="flex flex-col gap-1 text-center">
            <h2 className="m-0 text-16 font-semibold md:text-20">{caption.title}</h2>
            <p className="m-0 text-14 text-dim">{caption.sub}</p>
          </div>
          {caption.keys.length > 0 && (
            // Two columns on wide screens, read down the first and then the second, like the bars left to right.
            <ul className={cn("m-0 grid gap-x-6 gap-y-1 p-0 xl:grid-flow-col", caption.keys.length > 4 ? "xl:grid-rows-3" : caption.keys.length > 2 ? "xl:grid-rows-2" : "xl:grid-rows-1")}>
              {caption.keys.map((key) => (
                <li key={key.label} className="flex min-w-0 list-none items-center gap-2 text-13">
                  <span aria-hidden className="size-2 flex-none rounded-full" style={{ background: key.color }} />
                  <span className="min-w-0 flex-1 truncate text-dim">{key.label}</span>
                  {key.value && <span className="figure flex-none">{key.value}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="agent-composer fixed inset-x-0 z-10 flex flex-none flex-col gap-3 border-t border-line bg-paper px-4 py-3 md:static md:w-full md:border-t-0 md:p-0">
          {/* Typing only: no preset replies. Where the next step is a control somewhere else, a pointer to it.
              The row keeps its height either way, so the input never moves. */}
          <div className="flex overflow-x-auto">
            <div className="mx-auto flex min-h-10 items-center gap-1.5 md:min-h-8">
              {busy === null && <p className="m-0 whitespace-nowrap text-13 text-dim">{HINT[step]}</p>}
            </div>
          </div>
          <form
            onSubmit={onSubmit}
            className="mx-auto flex h-12 w-full max-w-140 items-center gap-2 rounded-sm border border-line-strong bg-paper pr-1 md:pr-2 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-mint-ink"
          >
            <label htmlFor="agent-ask" className="sr-only">
              Message Recoup
            </label>
            <input
              id="agent-ask"
              name="ask"
              type="text"
              autoComplete="off"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Ask about a vendor, a deadline or a claim"
              className="h-full min-w-0 flex-1 text-ellipsis bg-transparent pl-4 text-16 text-ink outline-none placeholder:text-14 placeholder:text-dim md:text-14"
            />
            <Button type="submit" variant="primary" size="sm" aria-label="Send" className="size-10 flex-none px-0 md:size-8" disabled={isBusy || !text.trim()}>
              <ArrowUp aria-hidden className="size-4" strokeWidth={2} />
            </Button>
          </form>
        </div>
      </div>

      <section
        aria-label="Reply and controls"
        className="card mx-auto flex min-h-0 w-full max-w-140 flex-none flex-col md:mx-0 md:max-h-full md:min-h-[min(--spacing(117),100%)] md:w-80 md:self-start lg:w-90 wide:w-110"
      >
        <div
          ref={log}
          role="log"
          aria-live="polite"
          tabIndex={0}
          aria-label="Conversation"
          className="relative flex min-h-0 flex-1 flex-col gap-4 px-5 py-4 md:overflow-y-auto"
        >
          {messages.map((message) => {
            if (message.from === "you") {
              return (
                <p key={message.id} className="m-0 max-w-[80%] self-end rounded-md border border-line bg-wash px-3 py-2 text-14">
                  <span className="sr-only">You: </span>
                  {message.text}
                </p>
              );
            }
            // While a reply is spoken its unsaid words keep their space, so nothing below it jumps.
            const words = message.text.split(" ");
            const shown = speech?.id === message.id ? speech.shown : words.length;
            const isDone = shown >= words.length;
            const rows = rowsOf(message);
            return (
              <motion.div
                key={message.id}
                className="flex flex-col gap-3"
                // Lines that were already there when the page opened don't arrive again.
                initial={message.id < shownAtOpen.current ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={SPRING}
              >
                <div className="flex flex-col gap-1">
                  <Speaker />
                  <p className={cn("m-0 text-14", message.isError && "text-amber-ink")}>
                    <span className="sr-only">Recoup: {message.text}</span>
                    <span aria-hidden>
                      {words.slice(0, shown).join(" ")}
                      {!isDone && <span className="invisible"> {words.slice(shown).join(" ")}</span>}
                    </span>
                  </p>
                </div>
                {isDone && message.card === "urgent" && rows.length > 0 && <UrgentCard rows={rows} drafts={state.drafts} />}
                {isDone && message.card === "approval" && rows.length > 0 && (
                  <ApprovalCard
                    rows={rows}
                    isLive={step === "approve" && message.id === liveApproval}
                    isBusy={busy !== null && busy !== "sending"}
                    sentOn={formatDate(summary.as_of, "short")}
                  />
                )}
                {isDone && message.card === "outcome" && rows.length > 0 && <OutcomeCard rows={rows} />}
                {isDone && message.link && (
                  <Button
                    size="sm"
                    className="self-start"
                    onClick={() => {
                      window.location.hash = (message.link as NonNullable<Message["link"]>).href;
                    }}
                  >
                    {message.link.label}
                    <ArrowRight aria-hidden className="size-3.5 text-dim" strokeWidth={2} />
                  </Button>
                )}
              </motion.div>
            );
          })}
          {running && (
            <div className="flex flex-col gap-1">
              <Speaker />
              <span className="text-14 text-dim">{running}</span>
            </div>
          )}
          <div ref={end} aria-hidden className="scroll-mb-48 md:scroll-mb-0" />
        </div>
        <AgentSources sources={sources} state={state} scanLine={scanLine} gmailRef={gmailButton} scanRef={scanButton} onConnect={onConnect} />
      </section>
      <AnimatePresence>
        {state.isDialogOpen ? (
          <GmailConnectDialog
            key="gmail"
            address={demo.address()}
            isConnecting={busy === "connecting"}
            error={state.connectError}
            onConnect={() => void demo.connectGmail()}
            onClose={demo.closeConnect}
            // Connected: on to the scan. Cancelled: back to the Connect button that opened it.
            returnFocus={() => (scanButton.current && !scanButton.current.disabled ? scanButton.current : gmailButton.current)}
          />
        ) : (
          connecting && <ConnectSheet key="connect" source={connecting} onClose={() => setConnecting(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
