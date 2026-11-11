// The scripted demo's state machine. It lives outside React so the conversation and the step survive
// leaving the Agent page, and in sessionStorage so they survive a refresh. Every action here is real:
// it calls the API, then reloads. The server is the truth: `sync` reconciles the stored step with it.
// The words are in script.ts.
import { useSyncExternalStore } from "react";
import { api, errorText, type DemoServer, type Finding, type RunSummary, type Sources, type Summary } from "../api";
import { vendorName } from "../lib/vendors";
import { factsOf, isOut, isSendable, outcomeOf, requestsOf, sum } from "./facts";
import { GMAIL_ADDRESS, HEARS, LINK, NEXT, SAY, type ClaimWords, type Step } from "./script";

export type { Step };

/** What the coin is showing. "radar", "progress" and "plane" only last while something runs. */
export type View = "coin" | "radar" | "bars" | "clock" | "progress" | "plane" | "check" | "savings";
/** What is running. Nothing else can start until it is null. "settling" is a short animation finishing. */
export type Busy = "thinking" | "settling" | "connecting" | "scanning" | "drafting" | "sending" | "restarting" | null;
export type Card = "urgent" | "approval" | "outcome";

export interface Message {
  id: number;
  from: "you" | "agent";
  text: string;
  card?: Card;
  /** The claims the card lists. */
  ids?: number[];
  /** A button under the reply that goes straight to another page. */
  link?: { label: string; href: string };
  isError?: boolean;
}

export interface DemoState {
  step: Step;
  messages: Message[];
  nextId: number;
  view: View;
  /** The claims drafted and sent together, tracked by id from then on. */
  batch: number[];
  /** Finding id to its draft's id. */
  drafts: Record<number, number>;
  // Everything below is about what is running now, and is not stored.
  busy: Busy;
  /** The Gmail pop-up on the Agent page, and the moment before it when the agent "presses" Connect. */
  isDialogOpen: boolean;
  isPressing: boolean;
  connectError: string | null;
  progress: { done: number; total: number };
  scanLine: number;
  scanRun: RunSummary | null;
  /** The coin's "found" burst: on while it plays, and a counter that replays it. */
  isFound: boolean;
  bursts: number;
  /** False until the stored conversation has been checked against the server once. */
  isReady: boolean;
}

/** What the server says, as App last loaded it. */
export interface World {
  summary: Summary;
  findings: Finding[];
  sources: Sources | null;
  server: DemoServer | null;
}

const ORDER: Step[] = ["intro", "offer_gmail", "connect", "ready_scan", "found", "urgent", "approve", "sent", "status", "done"];
const at = (step: Step) => ORDER.indexOf(step);

const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Milliseconds. The coin's own timings (scatter + fly + fuse = 1.6s) are in particle-coin.mjs. */
export const T = {
  think: 1100,
  /** Thinking from a ring or a shape takes longer: it reforms into the coin first. */
  thinkShaped: 1800,
  morph: reduced ? 350 : 1700,
  burst: 1000,
  beforePress: 900,
  press: 350,
  connect: 900,
  scan: 5000,
  draftStep: 700,
  afterDrafts: 500,
  /** If the coin never reports that the plane has gone (it is not on screen, or failed to load). */
  planeFallback: 7000,
};

const STORE_KEY = "recoup.demo.v1";
type Stored = Pick<DemoState, "step" | "messages" | "nextId" | "view" | "batch" | "drafts">;

const RUNNING: Omit<DemoState, keyof Stored> = {
  busy: null,
  isDialogOpen: false,
  isPressing: false,
  connectError: null,
  progress: { done: 0, total: 0 },
  scanLine: 0,
  scanRun: null,
  isFound: false,
  bursts: 0,
  isReady: false,
};

function blank(): Stored {
  return { step: "intro", messages: [{ id: 1, from: "agent", text: SAY.opening }], nextId: 2, view: "coin", batch: [], drafts: {} };
}

function read(): Stored {
  try {
    const raw = window.sessionStorage.getItem(STORE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Stored;
      const isWhole =
        saved !== null &&
        typeof saved === "object" &&
        ORDER.includes(saved.step) &&
        Array.isArray(saved.messages) &&
        saved.messages.length > 0 &&
        typeof saved.nextId === "number" &&
        typeof saved.view === "string" &&
        Array.isArray(saved.batch) &&
        saved.drafts !== null &&
        typeof saved.drafts === "object";
      if (isWhole) return saved;
    }
  } catch {
    // No storage, or something else's data under the key: start clean.
  }
  return blank();
}

function write(): void {
  const { step, messages, nextId, view, batch, drafts } = state;
  // A view that only lasts while something runs comes back as the coin.
  const held = view === "radar" || view === "progress" || view === "plane" ? "coin" : view;
  try {
    window.sessionStorage.setItem(STORE_KEY, JSON.stringify({ step, messages, nextId, view: held, batch, drafts } satisfies Stored));
  } catch {
    // Storage is full or off: the conversation still works, it just won't survive a refresh.
  }
}

let state: DemoState = { ...read(), ...RUNNING };
let world: World | null = null;
/** Bumped by a restart: whatever was running sees it after its next wait and stops. */
let epoch = 0;
let planeTimer = 0;
let refreshApp: () => Promise<void> = async () => undefined;
const listeners = new Set<() => void>();

function set(patch: Partial<DemoState>): void {
  const wasBusy = state.busy !== null;
  state = { ...state, ...patch };
  write();
  listeners.forEach((listener) => listener());
  // `sync` leaves the step alone while something runs; catch up the moment it stops.
  if (wasBusy && state.busy === null && state.isReady) reconcile();
}

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function say(text: string, extra: Partial<Message> = {}, from: Message["from"] = "agent"): void {
  set({ messages: [...state.messages, { id: state.nextId, from, text, ...extra }], nextId: state.nextId + 1 });
}

const words = (f: Finding): ClaimWords => ({ vendor: vendorName(f.merchant), amount: f.amount_minor, daysLeft: f.days_left });
const isConnected = (w: World) => w.server?.gmail_connected ?? w.sources?.gmail.connected ?? false;
// Findings without the flag means detection ran some other way (the date menu's "Run detection").
const isScanned = (w: World) => Boolean(w.server?.scanned) || w.findings.length > 0;

/** A new conversation that starts where the server already is. */
function startAt(step: "intro" | "ready_scan" | "found" | "sent", w: World): Stored {
  const facts = factsOf(w.summary, w.findings);
  const out = w.findings.filter(isOut);
  const text =
    step === "intro"
      ? SAY.opening
      : step === "ready_scan"
        ? SAY.openingConnected
        : step === "found"
          ? SAY.openingFound(facts.live.length, facts.ready, facts.soonest ? words(facts.soonest) : null)
          : SAY.openingSent(out.length, sum(out));
  return { ...blank(), step, messages: [{ id: 1, from: "agent", text }], batch: step === "sent" ? out.map((f) => f.id) : [] };
}

/**
 * Bring the stored step in line with the server. Ahead of the server (it was reset): start over from
 * where the server is. Behind it (connected, scanned or sent somewhere else): move up.
 */
function reconcile(): void {
  if (!world) return;
  const w = world;
  const here = at(state.step);
  const byId = new Map(w.findings.map((f) => [f.id, f]));
  const batch = state.batch.map((id) => byId.get(id));
  if (!isScanned(w)) {
    if (!isConnected(w)) {
      if (here > at("connect")) set(startAt("intro", w));
    } else if (here < at("ready_scan")) {
      set({ step: "ready_scan", isDialogOpen: false });
      say(SAY.connected(address()));
    } else if (here > at("ready_scan")) {
      set(startAt("ready_scan", w));
    }
  } else if (here < at("found")) {
    set(startAt(w.findings.some(isOut) ? "sent" : "found", w));
  } else if (here <= at("approve")) {
    if (batch.length > 0 && batch.every((f) => f && isOut(f))) {
      // Sent from somewhere else, or the page was refreshed as the last one went.
      const rows = batch as Finding[];
      set({ step: "sent", view: "coin" });
      say(SAY.sent(rows.length, sum(rows)), { link: { label: LINK.inFlight, href: "#/recovered?view=inflight" } });
    } else if (state.step === "approve" && !batch.some((f) => f && isSendable(f))) {
      set(startAt("found", w));
    }
  } else if (requestsOf(w.findings, state.batch).length === 0 && (state.step !== "done" || state.batch.length > 0)) {
    // The requests this conversation is about are gone: the server was reset and scanned again.
    set(startAt("found", w));
  }
  if (!state.isReady) set({ isReady: true });
}

/** The findings and the demo's state, straight from the server, for a reply that follows an action. */
async function load(withSources = false): Promise<World> {
  const [summary, findings, server, sources] = await Promise.all([
    api.summary(),
    api.findings(),
    api.demoState().catch(() => null),
    withSources ? api.sources().catch(() => null) : Promise.resolve(null),
  ]);
  return { summary, findings, server: server ?? world?.server ?? null, sources: sources ?? world?.sources ?? null };
}

/** The same again, and the rest of the app reloaded with it, so every page shows what just happened. */
async function reloadAll(withSources = false): Promise<World> {
  const [next] = await Promise.all([load(withSources), refreshApp().catch(() => undefined)]);
  return next;
}

function address(): string {
  return world?.server?.gmail_address ?? GMAIL_ADDRESS;
}

type Intent = "owed" | "connect" | "no" | "scan" | "urgent" | "draft" | "send" | "requests" | "saved" | "vendors" | "other";

/** Typed text, loosely: the line this step is waiting for first, then the questions it answers at any point. */
function intentOf(text: string, step: Step): Intent {
  const t = text.toLowerCase().trim();
  const hears = (pattern: RegExp) => pattern.test(t);
  if (step === "intro" && hears(HEARS.owed)) return "owed";
  if ((step === "offer_gmail" || step === "connect") && (hears(HEARS.yes) || hears(HEARS.connect))) return "connect";
  if (step === "ready_scan" && (hears(HEARS.scan) || hears(HEARS.yes))) return "scan";
  if (step === "found" && hears(HEARS.urgent)) return "urgent";
  if (step === "urgent" && (hears(HEARS.yes) || hears(HEARS.draft))) return "draft";
  if (step === "approve" && (hears(HEARS.send) || hears(HEARS.yes))) return "send";
  if (step === "sent" && hears(HEARS.requests)) return "requests";
  if (step === "status" && hears(HEARS.saved)) return "saved";
  if ((step === "offer_gmail" || step === "urgent") && hears(HEARS.no)) return "no";
  if (hears(HEARS.urgent)) return "urgent";
  if (hears(HEARS.vendors)) return "vendors";
  if (hears(HEARS.requests)) return "requests";
  if (hears(HEARS.saved)) return "saved";
  if (hears(HEARS.scan)) return "scan";
  if (hears(HEARS.connect)) return "connect";
  if (hears(HEARS.draft)) return "draft";
  if (hears(HEARS.send)) return "send";
  if (hears(HEARS.owed)) return "owed";
  return "other";
}

/** The agent says it is opening the pop-up, "presses" Gmail's Connect, and the pop-up opens. */
async function presentConnect(run: number): Promise<void> {
  if (at(state.step) < at("connect")) set({ step: "connect" });
  say(SAY.openingDialog);
  set({ busy: "settling" });
  await wait(T.beforePress);
  if (run !== epoch) return;
  set({ isPressing: true });
  await wait(T.press);
  if (run !== epoch) return;
  set({ isPressing: false, isDialogOpen: true, connectError: null, busy: null });
}

async function answer(intent: Intent, run: number): Promise<void> {
  if (!world) return;
  const w = world;
  const facts = factsOf(w.summary, w.findings);
  const step = state.step;
  const next = NEXT[step];
  const hasData = isScanned(w);

  if (intent === "owed") {
    if (step === "intro") {
      set({ step: "offer_gmail" });
      say(SAY.offerGmail);
    } else if (!hasData) say(SAY.nothingYet(next));
    else say(SAY.openingFound(facts.live.length, facts.ready, facts.soonest ? words(facts.soonest) : null));
  } else if (intent === "no") {
    say(SAY.declined);
  } else if (intent === "connect") {
    if (isConnected(w)) say(`${SAY.alreadyConnected} ${next}`);
    else await presentConnect(run);
  } else if (intent === "scan") {
    // Only reached without Gmail: with it, the scan starts at once.
    say(SAY.scanNeedsGmail);
  } else if (intent === "urgent" || (intent === "draft" && step === "found")) {
    if (!hasData) say(SAY.nothingYet(next));
    else if (facts.due30.length === 0) {
      // Nothing to draft, so the script has nowhere to go: leave it open for questions.
      if (step === "found" || step === "urgent") set({ step: "done" });
      say(SAY.noneUrgent);
    } else {
      const isOffer = (step === "found" || step === "urgent") && facts.urgent.length > 0;
      set({ view: "clock", ...(isOffer ? { step: "urgent" as const, batch: facts.urgent.map((f) => f.id) } : {}) });
      say(
        SAY.urgent({
          due: facts.due30.map(words),
          first: words(facts.due30[0]),
          held: facts.due30.filter((f) => f.outcome === "needs_review").length,
          sendable: facts.urgent.map(words),
          isOffer,
        }),
        { card: "urgent", ids: facts.due30.map((f) => f.id) },
      );
    }
  } else if (intent === "draft" || intent === "send") {
    say(step === "approve" ? SAY.sendNudge : SAY.offScript(next));
  } else if (intent === "requests") {
    const rows = requestsOf(w.findings, state.batch);
    const result = outcomeOf(rows);
    if (rows.length === 0) say(hasData ? `${SAY.noRequests} ${next}` : SAY.nothingYet(next));
    else if (result.waiting.length === rows.length) {
      say(SAY.requestsNoNews(rows.length, sum(rows)), { link: { label: LINK.inFlight, href: "#/recovered?view=inflight" } });
    } else {
      set({ view: "check", step: step === "sent" ? "status" : step });
      say(
        SAY.requests({
          sent: rows.length,
          refunded: result.refunded.map(words),
          back: result.back,
          agreed: result.agreed.map(words),
          waiting: result.waiting.map(words),
          onYou: result.onYou.map(words),
        }),
        { card: "outcome", ids: rows.map((f) => f.id), link: { label: LINK.recovered, href: "#/recovered" } },
      );
    }
  } else if (intent === "saved") {
    if (!hasData) say(SAY.nothingYet(next));
    else {
      if (step === "status") set({ step: "done" });
      const link = { label: LINK.recovered, href: "#/recovered" };
      if (facts.recovered > 0) {
        // Money has come back: the coin bursts first, then reforms into the savings ring.
        say(SAY.saved({ recovered: facts.recovered, inFlight: facts.inFlight, ready: facts.ready, missed: facts.missed }), { link });
        set({ busy: "settling", isFound: true, bursts: state.bursts + 1 });
        await wait(T.burst);
        if (run !== epoch) return;
        set({ isFound: false, view: "savings", busy: null });
      } else {
        set({ view: "savings" });
        say(SAY.savedNothingYet({ ready: facts.ready, count: facts.live.length, inFlight: facts.inFlight, missed: facts.missed }), { link });
      }
    }
  } else if (intent === "vendors") {
    const top = facts.vendors[0];
    if (!hasData) say(SAY.nothingYet(next));
    else if (!top) say(SAY.nothingOpen);
    else {
      set({ view: "bars" });
      say(SAY.vendors({ vendor: top.name, amount: top.minor, count: top.count }, facts.ready, facts.vendorCount));
    }
  } else {
    say(SAY.offScript(next));
  }
}

/** A reply button or a typed line. */
function ask(text: string): void {
  const body = text.trim();
  if (!body || state.busy || state.isDialogOpen || !world) return;
  say(body, {}, "you");
  const intent = intentOf(body, state.step);
  // The two lines that start real work skip the pause: the work is the answer.
  if (intent === "scan" && isConnected(world)) return void scan();
  if (intent === "draft" && state.step === "urgent") return void draftBatch();
  const run = epoch;
  const isShaped = state.view !== "coin";
  set({ busy: "thinking", view: "coin" });
  void wait(isShaped ? T.thinkShaped : T.think).then(async () => {
    if (run !== epoch) return;
    try {
      await answer(intent, run);
    } finally {
      if (run === epoch && state.busy === "thinking") set({ busy: null });
    }
  });
}

/** Opens the Gmail pop-up on the Agent page (the Connect button in its sources list, or the reply button). */
function openConnect(): void {
  if (state.busy || !world || isConnected(world)) return;
  set({ isDialogOpen: true, connectError: null });
}

function closeConnect(): void {
  if (state.busy === "connecting") return;
  set({ isDialogOpen: false, connectError: null });
}

/** The pop-up's Connect, from the Agent page or the Sources page. True once Gmail is connected. */
async function connectGmail(): Promise<boolean> {
  if (state.busy) return false;
  const run = epoch;
  set({ busy: "connecting", connectError: null });
  try {
    await Promise.all([api.demoConnect(), wait(T.connect)]);
    const next = await reloadAll(true);
    if (run !== epoch) return false;
    world = next;
    set({ busy: null, isDialogOpen: false });
    if (at(state.step) < at("ready_scan") && !isScanned(next)) {
      set({ step: "ready_scan" });
      say(SAY.connected(address()));
    }
    return true;
  } catch (error) {
    if (run === epoch) set({ busy: null, connectError: SAY.connectFailed(errorText(error)) });
    return false;
  }
}

/** Run scan: about five seconds of radar while the server reads the emails and runs detection. */
async function scan(): Promise<void> {
  if (state.busy || !world) return;
  if (!isConnected(world)) return say(SAY.scanNeedsGmail);
  const run = epoch;
  const isFirst = at(state.step) < at("found");
  const lines = SAY.scanSteps(null, null).length;
  set({ busy: "scanning", view: "radar", scanLine: 0, scanRun: null });
  const ticker = window.setInterval(() => {
    if (run === epoch && state.busy === "scanning") set({ scanLine: Math.min(state.scanLine + 1, lines - 1) });
  }, T.scan / lines);
  try {
    const [result] = await Promise.all([
      api.demoScan().then((summary) => {
        if (run === epoch) set({ scanRun: summary });
        return summary;
      }),
      wait(T.scan),
    ]);
    const next = await reloadAll(true);
    if (run !== epoch) return;
    world = next;
    // The radar lets go into the coin, the coin bursts, and the dust lands as bars.
    set({ view: "coin" });
    await wait(T.morph);
    if (run !== epoch) return;
    const facts = factsOf(next.summary, next.findings);
    const top = facts.vendors[0];
    if (isFirst) set({ step: "found" });
    if (!top) {
      set({ busy: null });
      say(isFirst ? SAY.foundNothing : SAY.rescanned(result.created));
      return;
    }
    say(
      isFirst
        ? SAY.found({
            count: facts.live.length,
            ready: facts.ready,
            vendorCount: facts.vendorCount,
            top: { vendor: top.name, amount: top.minor },
            first: facts.soonest ? words(facts.soonest) : null,
            missed: facts.missed,
          })
        : SAY.rescanned(result.created),
      isFirst ? { link: { label: LINK.overview, href: "#/overview" } } : {},
    );
    set({ busy: "settling", isFound: true, bursts: state.bursts + 1 });
    await wait(T.burst);
    if (run !== epoch) return;
    set({ busy: null, isFound: false, view: "bars" });
  } catch (error) {
    if (run !== epoch) return;
    set({ busy: null, view: "coin" });
    say(SAY.scanFailed(errorText(error)), { isError: true });
  } finally {
    window.clearInterval(ticker);
  }
}

/** The id of a claim's unsent draft: the one already written, or a new one. */
async function draftIdFor(finding: Finding): Promise<number> {
  if (finding.status === "drafted") {
    const known = state.drafts[finding.id];
    if (known) return known;
    const existing = (await api.finding(finding.id)).drafts.find((draft) => draft.status === "draft");
    if (existing) return existing.id;
  }
  return (await api.draft(finding.id)).id;
}

function batchRows(w: World): Finding[] {
  const byId = new Map(w.findings.map((f) => [f.id, f]));
  return state.batch.map((id) => byId.get(id)).filter((f): f is Finding => f !== undefined);
}

/** Drafts every claim in the batch, one at a time, with the count on the coin. Safe to run again after a failure. */
async function draftBatch(): Promise<void> {
  if (state.busy || !world) return;
  const run = epoch;
  const rows = batchRows(world).filter(isSendable);
  if (rows.length === 0) return say(SAY.offScript(NEXT[state.step]));
  set({ busy: "drafting", view: "progress", progress: { done: 0, total: rows.length } });
  await wait(T.morph);
  let failure: unknown = null;
  let done = 0;
  for (const finding of rows) {
    if (run !== epoch) return;
    try {
      const [draftId] = await Promise.all([draftIdFor(finding), wait(T.draftStep)]);
      if (run !== epoch) return;
      done += 1;
      set({ drafts: { ...state.drafts, [finding.id]: draftId }, progress: { done, total: rows.length } });
    } catch (error) {
      failure = error;
      break;
    }
  }
  const next = await reloadAll().catch(() => world);
  if (run !== epoch) return;
  if (next) world = next;
  if (failure) {
    set({ busy: null, view: "coin" });
    say(SAY.draftFailed(done, rows.length, errorText(failure)), { isError: true });
    return;
  }
  await wait(T.afterDrafts);
  if (run !== epoch) return;
  set({ busy: null, view: "coin", step: "approve" });
  say(SAY.draftsReady(rows.length, sum(rows)), { card: "approval", ids: rows.map((f) => f.id) });
}

/**
 * The slide: sends every drafted request in the batch. Rejects when one fails, so the slide springs
 * back; the ones that went stay sent, and sliding again sends the rest.
 */
async function sendBatch(): Promise<void> {
  if (state.busy || !world) throw new Error("busy");
  const run = epoch;
  const all = batchRows(world);
  const rows = all.filter(isSendable);
  let done = all.length - rows.length;
  set({ busy: "sending", progress: { done, total: all.length } });
  let failure: unknown = null;
  for (const finding of rows) {
    try {
      await api.send(await draftIdFor(finding));
      done += 1;
      if (run === epoch) set({ progress: { done, total: all.length } });
    } catch (error) {
      failure = error;
      break;
    }
  }
  const next = await reloadAll().catch(() => world);
  if (run !== epoch) return;
  if (next) world = next;
  if (failure) {
    set({ busy: null });
    say(SAY.sendFailed(done, all.length, errorText(failure)), { isError: true });
    throw failure;
  }
  set({ busy: null, step: "sent", view: "plane" });
  say(SAY.sent(all.length, sum(all)), { link: { label: LINK.inFlight, href: "#/recovered?view=inflight" } });
  window.clearTimeout(planeTimer);
  planeTimer = window.setTimeout(planeDone, T.planeFallback);
}

/** The plane has flown and the coin is back (or the coin never said so and the fallback fired). */
function planeDone(): void {
  window.clearTimeout(planeTimer);
  if (state.view === "plane") set({ view: "coin" });
}

/** Restart demo: the server goes back to its clean slate and the conversation starts over. Rejects if the server can't. */
async function restart(): Promise<void> {
  const run = ++epoch;
  window.clearTimeout(planeTimer);
  set({ busy: "restarting", isDialogOpen: false, isPressing: false, isFound: false });
  try {
    await api.demoReset();
  } catch (error) {
    // Whatever was running has been stopped; pick up from where the server really is.
    const next = await load(true).catch(() => world);
    if (run === epoch) {
      if (next) world = next;
      set({ busy: null, view: state.view === "radar" || state.view === "progress" || state.view === "plane" ? "coin" : state.view });
      reconcile();
    }
    throw error;
  }
  set({ ...blank(), ...RUNNING, busy: "restarting", isReady: true });
  const next = await reloadAll(true).catch(() => null);
  if (run !== epoch) return;
  if (next) world = next;
  // The reset worked but the reload did not: the server is at the clean slate, so say so here too.
  else if (world) world = { ...world, findings: [], sources: null, server: world.server ? { ...world.server, scanned: false, gmail_connected: false } : null };
  set({ busy: null });
}

export const demo = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getState: () => state,
  /** App hands over how to reload everything it holds. */
  bind(refresh: () => Promise<void>): void {
    refreshApp = refresh;
  },
  /** App's latest copy of the server's data. While something runs, the step is left to what is running. */
  sync(next: World): void {
    world = next;
    if (!state.busy) reconcile();
  },
  address,
  ask,
  openConnect,
  closeConnect,
  connectGmail,
  scan,
  sendBatch,
  planeDone,
  restart,
};

export function useDemo(): DemoState {
  return useSyncExternalStore(demo.subscribe, demo.getState);
}
