// The demo's words, all in one place. Edit the wording here; flow.ts only decides which line is said when.
//
//   REPLY    the presenter's reply buttons (above the input)
//   HEARS    what typed text counts as each of those lines
//   SAY      everything Recoup says, as plain strings or small functions of the real figures
//   NEXT     the one-line pointer to the next step, added to "nothing found yet" and "can't do that" answers
//   HINT     the quiet line shown where the reply buttons go when the next step is not a reply
//   WORKING  the running line in the conversation while something is in progress
//   CAPTION  the title and line under the coin for each thing it turns into
//
// Voice: short, plain, figures first. No exclamation marks.
import { daysHint, formatMoney, plural } from "../format";

export type Step = "intro" | "offer_gmail" | "connect" | "ready_scan" | "found" | "urgent" | "approve" | "sent" | "status" | "done";

/** A claim as a line needs it: who, how much (minor units), how long is left. */
export interface ClaimWords {
  vendor: string;
  amount: number;
  daysLeft?: number | null;
}

const money = (minor: number) => formatMoney(minor);
const left = (days: number | null | undefined) => daysHint(days ?? null)?.toLowerCase() ?? "no deadline";
const names = (claims: ClaimWords[]) => {
  const list = claims.map((c) => c.vendor);
  return list.length <= 2 ? list.join(" and ") : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
};
const total = (claims: ClaimWords[]) => money(claims.reduce((t, c) => t + c.amount, 0));
const missedLine = (missed: number) => (missed > 0 ? ` ${money(missed)} was missed because the window closed.` : "");

/** Shown in the Gmail pop-up when the server does not say which inbox. */
export const GMAIL_ADDRESS = "finance@acme.com";

export const REPLY = {
  owed: "What is my company owed?",
  yesConnect: "Yes, connect Gmail",
  openConnect: "Connect Gmail",
  urgent: "Which ones are urgent?",
  yesDraft: "Yes, draft them",
  requests: "How are my requests doing?",
  saved: "How much has the company saved now?",
  vendors: "Who owes the most?",
};

/** The reply buttons each step shows. A step with none waits on a control somewhere else (see HINT). */
export const REPLIES: Record<Step, string[]> = {
  intro: [REPLY.owed],
  offer_gmail: [REPLY.yesConnect],
  connect: [REPLY.openConnect],
  ready_scan: [],
  found: [REPLY.urgent],
  urgent: [REPLY.yesDraft],
  approve: [],
  sent: [REPLY.requests],
  status: [REPLY.saved],
  done: [REPLY.vendors, REPLY.urgent],
};

/** Loose matches for typed text, tested against the lower-cased line. The step's own line is tried first. */
export const HEARS = {
  owed: /\bowed\b|what.*\bowe|money back|get started|\bstart\b|\bbegin\b/,
  yes: /^(y|yes|yep|yeah|sure|ok|okay|please|go|go ahead|do it|let'?s go)\b/,
  no: /^(no|nope|not now|not yet|later|skip)\b/,
  connect: /connect|gmail|inbox/,
  scan: /\bscan|\brun\b/,
  urgent: /urgent|deadline|\bdue\b|soon|expir|\bfirst\b/,
  draft: /draft|write|chase/,
  send: /\bsend\b|approve|slide/,
  requests: /requests?\b|doing|status|repl(y|ies|ied)|heard|update|progress/,
  saved: /\bsaved?\b|savings|recover|so far|how much/,
  vendors: /\bwho ow|\bowes?\b.*\bmost\b|biggest|largest|top vendors?|which vendors?/,
};

export const SAY = {
  // Where the conversation starts, or picks up when the stored one is gone.
  opening: "Ramp is connected. Nothing found yet. Ask what your company is owed and I'll start.",
  openingConnected: "Gmail is connected. Press Run scan and I'll read the vendor emails against the Ramp ledger.",
  openingFound: (count: number, ready: number, first: ClaimWords | null) =>
    first
      ? `${plural(count, "claim")} open, worth ${money(ready)}. ${first.vendor} is due first: ${money(first.amount)}, ${left(first.daysLeft)}.`
      : "Nothing is open right now.",
  openingSent: (count: number, worth: number) => `${plural(count, "request is", "requests are")} out, worth ${money(worth)}. Ask how they are doing.`,

  // Step 1: connect Gmail.
  offerGmail:
    "I find what you're owed by checking Ramp charges against what vendors said by email. Ramp is connected. Gmail is not. Connect it? Access is read-only.",
  declined: "Understood. Say yes when you want to go on.",
  openingDialog: "Opening the Gmail connection. Press Connect to allow it.",
  alreadyConnected: "Gmail is already connected.",
  connected: (address: string) => `Gmail is connected: ${address}, read-only. Press Run scan and I'll read the vendor emails against the Ramp ledger.`,
  connectFailed: (reason: string) => `Gmail didn't connect. ${reason}`,

  // Step 2: the scan.
  scanNeedsGmail: "Connect Gmail first, then I can scan.",
  /** The running line, about five seconds in all. The counts arrive with the scan's answer. */
  scanSteps: (emails: number | null, transactions: number | null) => [
    emails ? `Reading ${plural(emails, "vendor email")}` : "Reading vendor emails",
    transactions ? `Matching them to ${plural(transactions, "Ramp transaction")}` : "Matching them to the Ramp ledger",
    "Checking contracts and uptime credits",
    "Checking claim deadlines",
  ],
  found: (f: { count: number; ready: number; vendorCount: number; top: ClaimWords; first: ClaimWords | null; missed: number }) =>
    `${plural(f.count, "claim")} found, worth ${money(f.ready)}, across ${plural(f.vendorCount, "vendor")}. ${f.top.vendor} owes the most: ${money(f.top.amount)}.` +
    (f.first ? ` ${f.first.vendor} is due first: ${money(f.first.amount)}, ${left(f.first.daysLeft)}.` : "") +
    missedLine(f.missed),
  foundNothing: "The scan finished. Nothing is owed right now.",
  rescanned: (created: number) => (created > 0 ? `Scanned again. ${plural(created, "new claim")} found.` : "Scanned again. Nothing new."),
  scanFailed: (reason: string) => `The scan didn't finish. ${reason} Press Run scan to try again.`,

  // Step 3: urgent, draft, send.
  urgent: (f: { due: ClaimWords[]; first: ClaimWords; held: number; sendable: ClaimWords[]; isOffer: boolean }) =>
    `${plural(f.due.length, "claim falls", "claims fall")} due in the next 30 days, worth ${total(f.due)}. ${f.first.vendor} is first: ${money(f.first.amount)}, ${left(f.first.daysLeft)}.` +
    (f.held > 0 ? ` ${f.held === 1 ? "One needs" : `${f.held} need`} your review first, so I've left ${f.held === 1 ? "it" : "them"} out.` : "") +
    (f.isOffer && f.sendable.length > 0
      ? ` Draft ${f.sendable.length === 1 ? "the request" : `requests for the ${f.held > 0 ? "other " : ""}${f.sendable.length}`}, worth ${total(f.sendable)}?`
      : ""),
  noneUrgent: "Nothing falls due in the next 30 days.",
  draftsReady: (count: number, worth: number) =>
    `${plural(count, "request is", "requests are")} drafted, worth ${money(worth)}. Nothing goes out until you slide to send.`,
  draftFailed: (done: number, of: number, reason: string) => `${done} of ${of} drafted, then it stopped. ${reason} Say yes to draft the rest.`,
  sendNudge: "Only you can send. Slide the control to send them.",
  sent: (count: number, worth: number) =>
    `${plural(count, "request")} sent, worth ${money(worth)}. I'll watch for replies and for the credits in Ramp.`,
  sendFailed: (done: number, of: number, reason: string) => `${done} of ${of} sent, then it stopped. ${reason} Slide again to send the rest.`,

  // Steps 5 and 6: after the two weeks.
  noRequests: "No requests are out yet.",
  requestsNoNews: (count: number, worth: number) => `${plural(count, "request is", "requests are")} out, worth ${money(worth)}. No replies yet.`,
  requests: (f: { sent: number; refunded: ClaimWords[]; back: number; agreed: ClaimWords[]; waiting: ClaimWords[]; onYou: ClaimWords[] }) =>
    [
      f.refunded.length > 0
        ? `${f.refunded.length} of ${f.sent} refunded: ${money(f.back)} is back in Ramp.`
        : `Nothing has posted to Ramp yet from the ${plural(f.sent, "request")}.`,
      f.agreed.length > 0 ? `${names(f.agreed)} agreed to ${total(f.agreed)}; the credit hasn't posted yet.` : "",
      f.waiting.length > 0 ? `${names(f.waiting)} ${f.waiting.length === 1 ? "hasn't" : "haven't"} replied about ${total(f.waiting)}.` : "",
      f.onYou.length > 0 ? `${names(f.onYou)} ${f.onYou.length === 1 ? "needs" : "need"} your reply.` : "",
    ]
      .filter(Boolean)
      .join(" "),
  saved: (f: { recovered: number; inFlight: number; ready: number; missed: number }) =>
    `${money(f.recovered)} recovered so far.` +
    (f.inFlight > 0 ? ` ${money(f.inFlight)} is waiting on vendors.` : "") +
    ` ${money(f.ready)} is still ready to claim.` +
    missedLine(f.missed),
  savedNothingYet: (f: { ready: number; count: number; inFlight: number; missed: number }) =>
    `Nothing has come back yet. ${money(f.ready)} is ready to claim across ${plural(f.count, "claim")}.` +
    (f.inFlight > 0 ? ` ${money(f.inFlight)} is waiting on vendors.` : "") +
    missedLine(f.missed) +
    " I count money as recovered once the credit shows in Ramp.",

  // Asked at any point.
  vendors: (top: { vendor: string; amount: number; count: number }, ready: number, vendorCount: number) =>
    `${top.vendor} owes the most: ${money(top.amount)} across ${plural(top.count, "claim")}. ${money(ready)} is open across ${plural(vendorCount, "vendor")}.`,
  nothingOpen: "Nothing is open right now.",
  nothingYet: (next: string) => `Nothing found yet. ${next}`,
  offScript: (next: string) => `I can't do that in this demo yet. ${next}`,
};

/** The buttons under a reply that go straight to another page. */
export const LINK = {
  overview: "Open Overview",
  inFlight: "See them in flight",
  recovered: "Open Recovered",
};

export const NEXT: Record<Step, string> = {
  intro: "Ask what your company is owed to start.",
  offer_gmail: "Say yes to connect Gmail.",
  connect: "Press Connect Gmail.",
  ready_scan: "Press Run scan, under the sources.",
  found: "Ask which ones are urgent.",
  urgent: "Say yes and I'll draft them.",
  approve: "Slide to send the requests.",
  sent: "Ask how your requests are doing.",
  status: "Ask how much the company has saved.",
  done: "Ask who owes the most, or what is urgent.",
};

export const HINT: Partial<Record<Step, string>> = {
  ready_scan: "Press Run scan, under the sources.",
  approve: "Slide to send, in the reply.",
};

export const WORKING = {
  thinking: "Checking your claims…",
  connecting: "Connecting Gmail…",
  drafting: (done: number, of: number) => `Drafting ${Math.min(done + 1, of)} of ${of}…`,
  sending: (done: number, of: number) => `Sending ${Math.min(done + 1, of)} of ${of}…`,
};

/** The scan button's own element, under the sources list. */
export const SCAN = {
  button: "Run scan",
  again: "Scan again",
  running: "Scanning…",
  needsGmail: "Connect Gmail to scan.",
  ready: "Reads Gmail against the Ramp ledger.",
  done: (emails: number | null) => (emails ? `Last scan read ${plural(emails, "vendor email")}.` : "Scanned."),
};

/** The Gmail pop-up. */
export const CONNECT = {
  title: "Connect your Gmail",
  account: "Finance inbox",
  note: "Read-only. Recoup reads vendor emails about refunds, credits and cancellations. It can't send, change or delete anything in this inbox.",
  cancel: "Cancel",
  confirm: "Connect",
  busy: "Connecting…",
};

/** The approval card. */
export const APPROVAL = {
  title: "Needs your approval",
  note: "Only you can send. Nothing goes out without the slide.",
  slide: (count: number) => (count === 1 ? "Slide to send" : `Slide to send all ${count}`),
  armed: "Press Enter again to send",
  sending: "Sending",
  done: "Sent",
  sentTitle: "Sent with your approval",
  sentNote: (count: number, on: string) => `${plural(count, "request")} went out on ${on}.`,
};

export const CAPTION = {
  coin: { title: "Recoup agent", sub: "Ask what you are owed, or what is due next." },
  approval: { title: "Needs your approval", sub: "Nothing is sent until you slide to send." },
  radar: { title: "Scanning" },
  bars: { title: "Who owes the most", sub: (ready: number, vendorCount: number) => `${money(ready)} open across ${plural(vendorCount, "vendor")}.` },
  clock: { title: "Deadline clock", sub: (lapDays: number) => `One lap is ${lapDays} days. The ring shows the time left on the next deadline.`, none: "No open claim has a deadline right now." },
  drafting: { title: "Drafting requests", sub: (done: number, of: number) => `${done} of ${of} drafted. Nothing is sent until you approve it.` },
  plane: { title: "Requests sent", sub: "Each one is with its vendor now." },
  check: { title: "Money back", sub: (refunded: number, sent: number) => `${refunded} of ${plural(sent, "request")} refunded so far.` },
  savings: { title: "Saved so far", sub: "Recovered counts only once the credit shows in your ledger." },
};
