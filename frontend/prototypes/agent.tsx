// Prototype only: the agent as the home page. Replies are scripted (no model behind it); every figure
// comes from /api/summary and /api/findings. Nothing is sent, and nothing in the app imports this.
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { MotionConfig, motion } from "motion/react";
import { ArrowUp, Check, Lock, Sparkles } from "lucide-react";
import "./agent.css";
import type { Finding, Summary } from "../src/api";
import { Button } from "../src/components/Button";
import SlideToConfirm from "../src/components/kokonutui/slide-to-confirm";
import { Shell } from "../src/components/shell/Shell";
import { Tag } from "../src/components/ui";
import { VendorLogo } from "../src/components/VendorLogo";
import { daysHint, formatDate, formatMoney, plural, setReferenceYear } from "../src/format";
import { useCases } from "../src/hooks/useCases";
import type { Page } from "../src/hooks/useHashRoute";
import { useSources } from "../src/hooks/useSources";
import { typeLabel } from "../src/lib/claimTypes";
import { cn } from "../src/lib/utils";
import { vendorName } from "../src/lib/vendors";
import { SPRING } from "../src/motion";
import { countsFor, displayReason, rowsFor } from "../src/queue";
import { isUrgent } from "../src/theme";

const go = (hash: string) => {
  window.location.href = `/${hash}`;
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------------------------------
// Facts: everything the agent says is read from here.

interface VendorShare {
  name: string;
  minor: number;
  count: number;
}

interface Facts {
  /** Open claims, soonest deadline first. */
  live: Finding[];
  ready: number;
  recovered: number;
  inFlight: number;
  missed: number;
  soonest: Finding | null;
  /** Open claims due within 30 days. */
  due30: Finding[];
  /** Top four vendors by amount, then "Other". */
  vendors: VendorShare[];
  vendorCount: number;
}

const sum = (rows: Finding[]) => rows.reduce((total, f) => total + f.amount_minor, 0);

function factsOf(summary: Summary, findings: Finding[]): Facts {
  const live = rowsFor(findings, "todo");
  const byVendor = new Map<string, VendorShare>();
  for (const f of live) {
    const name = vendorName(f.merchant);
    const row = byVendor.get(name) ?? { name, minor: 0, count: 0 };
    row.minor += f.amount_minor;
    row.count += 1;
    byVendor.set(name, row);
  }
  const ranked = [...byVendor.values()].sort((a, b) => b.minor - a.minor);
  const rest = ranked.slice(4);
  const vendors = ranked.slice(0, 4);
  if (rest.length) vendors.push({ name: "Other", minor: rest.reduce((t, v) => t + v.minor, 0), count: rest.reduce((t, v) => t + v.count, 0) });
  return {
    live,
    ready: sum(live),
    recovered: summary.recovered_minor,
    inFlight: summary.in_flight_minor,
    missed: summary.expired_minor + sum(rowsFor(findings, "closed").filter((f) => f.status !== "expired")),
    soonest: live.find((f) => f.days_left !== null) ?? null,
    due30: live.filter((f) => f.days_left !== null && f.days_left <= 30),
    vendors,
    vendorCount: ranked.length,
  };
}

// ---------------------------------------------------------------------------------------------------
// The stage: a dial that never moves, and a disc inside it that flips between the icon and a ring.

type View = "icon" | "savings" | "clock" | "vendors" | "progress";
interface Progress {
  done: number;
  total: number;
}

/** Every face is drawn on a 240-unit square around this centre. */
const C = 120;
const RING = 84;
/** One lap of the deadline clock. */
const DIAL_DAYS = 120;
const SHARE = ["var(--share-1)", "var(--share-2)", "var(--share-3)", "var(--share-4)", "var(--share-5)"];

/** A point at radius r, `turn` of the way round clockwise from 12 o'clock. */
function polar(r: number, turn: number) {
  const angle = turn * 2 * Math.PI - Math.PI / 2;
  return { x: C + r * Math.cos(angle), y: C + r * Math.sin(angle) };
}

/** One segment of a ring: starts `start` of the way round and covers `share` of the lap. */
function Arc({ start, share, color, width, delay = 0, round = false }: { start: number; share: number; color: string; width: number; delay?: number; round?: boolean }) {
  const lap = 2 * Math.PI * RING;
  const gap = share > 0 && share < 1 && !round ? 2 : 0;
  const length = Math.max(0, share * lap - gap);
  return (
    <g transform={`rotate(${start * 360 - 90} ${C} ${C})`}>
      <motion.circle
        cx={C}
        cy={C}
        r={RING}
        fill="none"
        strokeWidth={width}
        strokeLinecap={round ? "round" : "butt"}
        style={{ stroke: color }}
        initial={{ strokeDasharray: `0 ${lap}` }}
        animate={{ strokeDasharray: `${length} ${lap}` }}
        transition={{ ...SPRING, duration: 0.9, delay }}
      />
    </g>
  );
}

function Track({ width }: { width: number }) {
  return <circle cx={C} cy={C} r={RING} fill="none" className="stroke-line" strokeWidth={width} />;
}

/** The words in the middle of a ring. */
function Centre({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="flex max-w-[58%] flex-col items-center text-center">{children}</div>
    </div>
  );
}

// Our own shape, built from the Recoup mark: the R whose leg is an arrow coming back.
const MARK = "M58 46H134C158 46 174 64 174 86C174 104 163 119 144 125L174.5 155.5L178 152L184 194L142 188L154 176L86 108V164H58ZM86 72H132C141 72 148 78 148 86C148 94 141 100 132 100H86Z";

function IconFace({ thinking }: { thinking: boolean }) {
  const id = useId().replace(/:/g, "");
  return (
    <motion.svg
      viewBox="0 0 240 240"
      className="size-full"
      role="img"
      aria-label="Recoup agent"
      animate={thinking ? { scale: [1, 0.95, 1] } : { scale: 1 }}
      transition={thinking ? { repeat: Infinity, duration: 1.2, ease: "easeInOut" } : SPRING}
    >
      <defs>
        <pattern id={`${id}-fine`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
          <line x1="0" y1="0" x2="0" y2="6" className="stroke-mint-ink" strokeWidth="1" />
        </pattern>
        <pattern id={`${id}-dense`} width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="3" className="stroke-mint-ink" strokeWidth="1.2" />
        </pattern>
      </defs>
      {/* The slab's depth: the same outline set back, hatched densely. */}
      <path d={MARK} transform="translate(8 8)" fillRule="evenodd" fill={`url(#${id}-dense)`} className="stroke-mint-ink" strokeWidth="1.5" strokeLinejoin="round" />
      <path d={MARK} fillRule="evenodd" className="fill-paper" />
      <path d={MARK} fillRule="evenodd" fill={`url(#${id}-fine)`} className="stroke-mint-ink" strokeWidth="2" strokeLinejoin="round" />
    </motion.svg>
  );
}

function SavingsFace({ facts }: { facts: Facts }) {
  const total = facts.recovered + facts.inFlight + facts.ready + facts.missed || 1;
  const parts = [
    { minor: facts.recovered, color: "var(--mint-ink)" },
    { minor: facts.inFlight, color: "var(--share-2)" },
    { minor: facts.ready, color: "var(--mint)" },
    { minor: facts.missed, color: "var(--line-strong)" },
  ];
  let at = 0;
  return (
    <>
      <svg aria-hidden viewBox="0 0 240 240" className="size-full">
        <Track width={14} />
        {parts.map((part, i) => {
          const start = at;
          at += part.minor / total;
          return part.minor > 0 ? <Arc key={i} start={start} share={part.minor / total} color={part.color} width={14} delay={0.3 + i * 0.08} /> : null;
        })}
      </svg>
      <Centre>
        <span className="text-12 text-dim">Recovered</span>
        <span className="figure text-20 font-semibold md:text-28">{formatMoney(facts.recovered)}</span>
        <span className="figure text-12 text-dim">of {formatMoney(facts.ready + facts.inFlight + facts.recovered)} found</span>
      </Centre>
    </>
  );
}

function ClockFace({ facts }: { facts: Facts }) {
  const soonest = facts.soonest;
  const turnOf = (f: Finding) => Math.min(f.days_left ?? 0, DIAL_DAYS) / DIAL_DAYS;
  const largest = Math.max(1, ...facts.live.map((f) => f.amount_minor));
  const urgent = soonest ? isUrgent(soonest.days_left) : false;
  return (
    <>
      <svg aria-hidden viewBox="0 0 240 240" className="size-full">
        <Track width={2} />
        {Array.from({ length: 12 }, (_, i) => {
          const a = polar(RING - 8, i / 12);
          const b = polar(RING - 3, i / 12);
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="stroke-line-strong" strokeWidth={1} />;
        })}
        {soonest && <Arc start={0} share={turnOf(soonest)} color={urgent ? "var(--amber)" : "var(--mint-ink)"} width={4} delay={0.3} round />}
        {facts.live
          .filter((f) => f.days_left !== null)
          .map((f, i) => {
            const at = polar(RING, turnOf(f));
            const near = (f.days_left ?? 0) <= 30;
            return (
              <motion.circle
                key={f.id}
                cx={at.x}
                cy={at.y}
                r={3 + 4 * Math.sqrt(f.amount_minor / largest)}
                className="stroke-paper"
                strokeWidth={1.5}
                style={{ fill: isUrgent(f.days_left) ? "var(--amber)" : near ? "var(--mint-ink)" : "var(--mint)" }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.25, delay: 0.35 + i * 0.03 }}
              />
            );
          })}
        {soonest &&
          (() => {
            const a = polar(56, turnOf(soonest));
            const b = polar(RING - 12, turnOf(soonest));
            return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="stroke-ink" strokeWidth={2} strokeLinecap="round" />;
          })()}
      </svg>
      <Centre>
        {soonest ? (
          <>
            <span className="text-12 text-dim">Next deadline</span>
            <span className={cn("figure text-20 font-semibold md:text-28", urgent && "text-amber-ink")}>{plural(soonest.days_left ?? 0, "day")}</span>
            <span className="figure text-12 text-dim">
              {vendorName(soonest.merchant)} · {formatMoney(soonest.amount_minor)}
            </span>
          </>
        ) : (
          <span className="text-13 text-dim">No open deadlines</span>
        )}
      </Centre>
    </>
  );
}

function VendorsFace({ facts }: { facts: Facts }) {
  const total = facts.ready || 1;
  const top = facts.vendors[0];
  let at = 0;
  return (
    <>
      <svg aria-hidden viewBox="0 0 240 240" className="size-full">
        <Track width={14} />
        {facts.vendors.map((vendor, i) => {
          const start = at;
          at += vendor.minor / total;
          return <Arc key={vendor.name} start={start} share={vendor.minor / total} color={SHARE[i]} width={14} delay={0.3 + i * 0.08} />;
        })}
      </svg>
      <Centre>
        {top ? (
          <>
            <span className="text-12 text-dim">Owes the most</span>
            <span className="text-14 font-medium">{top.name}</span>
            <span className="figure text-20 font-semibold">{formatMoney(top.minor)}</span>
          </>
        ) : (
          <span className="text-13 text-dim">Nothing open</span>
        )}
      </Centre>
    </>
  );
}

function ProgressFace({ progress }: { progress: Progress }) {
  const isDone = progress.total > 0 && progress.done === progress.total;
  return (
    <>
      <svg aria-hidden viewBox="0 0 240 240" className="size-full">
        <Track width={10} />
        <Arc start={0} share={progress.total ? progress.done / progress.total : 0} color="var(--mint-ink)" width={10} round />
      </svg>
      <Centre>
        {isDone && <Check aria-hidden className="size-5 text-mint-ink" strokeWidth={2} />}
        <span className="figure text-20 font-semibold md:text-28">
          {progress.done} of {progress.total}
        </span>
        <span className="text-12 text-dim">{isDone ? "drafts ready" : "drafted"}</span>
      </Centre>
    </>
  );
}

function Face({ view, facts, progress, thinking }: { view: View; facts: Facts; progress: Progress; thinking: boolean }) {
  if (view === "savings") return <SavingsFace facts={facts} />;
  if (view === "clock") return <ClockFace facts={facts} />;
  if (view === "vendors") return <VendorsFace facts={facts} />;
  if (view === "progress") return <ProgressFace progress={progress} />;
  return <IconFace thinking={thinking} />;
}

/** The dial around the disc: sixty ticks, and a sweep that runs round while the agent works. */
function Dial({ thinking }: { thinking: boolean }) {
  const lap = 2 * Math.PI * 116;
  return (
    <>
      <svg aria-hidden viewBox="0 0 240 240" className="absolute inset-0 size-full">
        {Array.from({ length: 60 }, (_, i) => {
          const a = polar(i % 5 === 0 ? 111 : 114, i / 60);
          const b = polar(118, i / 60);
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={i % 5 === 0 ? "stroke-dim" : "stroke-line-strong"} strokeWidth={1} />;
        })}
      </svg>
      {thinking && (
        <motion.svg aria-hidden viewBox="0 0 240 240" className="absolute inset-0 size-full" animate={{ rotate: 360 }} transition={{ repeat: Infinity, ease: "linear", duration: 1.6 }}>
          <circle cx={C} cy={C} r={116} fill="none" className="stroke-mint-ink" strokeWidth={3} strokeLinecap="round" strokeDasharray={`${0.16 * lap} ${lap}`} transform={`rotate(-90 ${C} ${C})`} />
        </motion.svg>
      )}
    </>
  );
}

function Stage({ view, facts, progress, thinking }: { view: View; facts: Facts; progress: Progress; thinking: boolean }) {
  // Two faces, back to back. A new view is put on the hidden face, then the disc turns half a lap.
  const [faces, setFaces] = useState<{ turn: number; a: View; b: View }>({ turn: 0, a: "icon", b: "icon" });
  useEffect(() => {
    setFaces((f) => {
      const isA = f.turn % 2 === 0;
      if ((isA ? f.a : f.b) === view) return f;
      return isA ? { turn: f.turn + 1, a: f.a, b: view } : { turn: f.turn + 1, a: view, b: f.b };
    });
  }, [view]);
  const isA = faces.turn % 2 === 0;
  const side = "absolute inset-0 overflow-hidden rounded-full border border-line bg-paper backface-hidden";
  return (
    <div className="relative aspect-square w-60 flex-none perspective-distant md:w-full md:max-w-96">
      <Dial thinking={thinking} />
      <motion.div className="absolute inset-4 transform-3d" animate={{ rotateY: faces.turn * 180 }} transition={{ ...SPRING, duration: 0.8 }}>
        <div className={side} aria-hidden={!isA}>
          <Face key={faces.a} view={faces.a} facts={facts} progress={progress} thinking={thinking} />
        </div>
        <div className={cn(side, "rotate-y-180")} aria-hidden={isA}>
          <Face key={faces.b} view={faces.b} facts={facts} progress={progress} thinking={thinking} />
        </div>
      </motion.div>
    </div>
  );
}

interface Key {
  label: string;
  value?: string;
  color: string;
}

function captionOf(view: View, facts: Facts, progress: Progress): { title: string; sub: string; keys: Key[] } {
  if (view === "savings") {
    return {
      title: "Saved so far",
      sub: "Recovered counts only once the credit shows in your ledger.",
      keys: [
        { label: "Recovered", value: formatMoney(facts.recovered), color: "var(--mint-ink)" },
        { label: "Waiting on vendor", value: formatMoney(facts.inFlight), color: "var(--share-2)" },
        { label: "Ready to claim", value: formatMoney(facts.ready), color: "var(--mint)" },
        { label: "Missed", value: formatMoney(facts.missed), color: "var(--line-strong)" },
      ],
    };
  }
  if (view === "clock") {
    return {
      title: "Deadline clock",
      sub: `One lap is ${DIAL_DAYS} days. Each dot is a claim; bigger dots are bigger amounts.`,
      keys: [
        { label: "Due within 3 days", color: "var(--amber)" },
        { label: "Next 30 days", color: "var(--mint-ink)" },
        { label: "Later", color: "var(--mint)" },
      ],
    };
  }
  if (view === "vendors") {
    return {
      title: "Who owes the most",
      sub: `${formatMoney(facts.ready)} open across ${plural(facts.vendorCount, "vendor")}.`,
      keys: facts.vendors.map((vendor, i) => ({ label: vendor.name, value: formatMoney(vendor.minor), color: SHARE[i] })),
    };
  }
  if (view === "progress") {
    return { title: "Drafting requests", sub: `${progress.done} of ${progress.total} drafted. Nothing is sent until you approve it.`, keys: [] };
  }
  return { title: "Recoup agent", sub: "Ask a question and the icon flips to show the answer.", keys: [] };
}

const SWITCH: { view: View; label: string }[] = [
  { view: "icon", label: "Icon" },
  { view: "savings", label: "Saved" },
  { view: "clock", label: "Deadlines" },
  { view: "vendors", label: "Vendors" },
];

// ---------------------------------------------------------------------------------------------------
// The conversation: scripted replies, with controls inline.

type Intent = "savings" | "clock" | "vendors" | "draft" | "other";
type Card = "checklist" | "approval";
interface Message {
  id: number;
  from: "you" | "agent";
  text: string;
  card?: Card;
}

const CHIPS = ["How much have I saved so far?", "What's urgent?", "Who owes us the most?", "Draft the urgent ones"];

function intentOf(text: string): Intent {
  const t = text.toLowerCase();
  if (/draft|write|chase/.test(t)) return "draft";
  if (/urgent|deadline|due|soon|expire|when/.test(t)) return "clock";
  if (/who|vendor|most|owes|biggest|largest/.test(t)) return "vendors";
  if (/saved|recover|so far|how much|available|total/.test(t)) return "savings";
  return "other";
}

function Avatar() {
  return <img src="/brand/recoup-mark-32-ink.png" alt="" width={24} height={24} className="mt-0.5 size-6 flex-none rounded-sm" />;
}

function ClaimLine({ finding }: { finding: Finding }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <VendorLogo name={finding.merchant} size={20} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2">
          <span className="truncate text-14 font-medium">{vendorName(finding.merchant)}</span>
          {finding.outcome === "needs_review" && <Tag tone="amber">Needs review</Tag>}
        </span>
        <span className="truncate text-12 text-dim">
          {typeLabel(finding.leak_type)} · {daysHint(finding.days_left)}
        </span>
      </span>
      <span className="figure flex-none text-14">{formatMoney(finding.amount_minor)}</span>
    </span>
  );
}

/** The claims due soon, ticked by default; the ones that need a person's review can't be ticked. */
function Checklist({ rows, drafted, isLocked, onDraft }: { rows: Finding[]; drafted: number; isLocked: boolean; onDraft: (picked: Finding[]) => void }) {
  const [off, setOff] = useState<Set<number>>(new Set());
  const canDraft = (f: Finding) => f.outcome === "recoverable";
  const picked = rows.filter((f) => canDraft(f) && !off.has(f.id));
  return (
    <div className="flex flex-col rounded-md border border-line">
      <ul className="m-0 flex flex-col p-0">
        {rows.map((f) => {
          const isPicked = picked.includes(f);
          const isDrafted = isLocked && isPicked && picked.indexOf(f) < drafted;
          return (
            <li key={f.id} className="list-none border-b border-line">
              <label className={cn("flex min-h-12 items-center gap-3 px-3 py-2", canDraft(f) && !isLocked ? "cursor-pointer hover:bg-wash" : "cursor-default")}>
                {isDrafted ? (
                  <Check aria-label="Drafted" className="size-4 flex-none text-mint-ink" strokeWidth={2} />
                ) : (
                  <input
                    type="checkbox"
                    name={`claim-${f.id}`}
                    className="size-4 flex-none accent-mint-ink"
                    checked={isPicked}
                    disabled={!canDraft(f) || isLocked}
                    onChange={() =>
                      setOff((prev) => {
                        const next = new Set(prev);
                        if (next.has(f.id)) next.delete(f.id);
                        else next.add(f.id);
                        return next;
                      })
                    }
                  />
                )}
                <ClaimLine finding={f} />
              </label>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <span className="figure text-13 text-dim">
          {plural(picked.length, "claim")} · {formatMoney(sum(picked))}
        </span>
        <Button variant="primary" size="sm" disabled={isLocked || picked.length === 0} onClick={() => onDraft(picked)}>
          {isLocked ? (drafted >= picked.length ? "Drafted" : "Drafting…") : `Draft ${plural(picked.length, "request")}`}
        </Button>
      </div>
    </div>
  );
}

/** The one step the agent can't take for you: the same slide-to-send the case page uses. */
function Approval({ finding, onApproved }: { finding: Finding; onApproved: () => void }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-line">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-3">
          <VendorLogo name={finding.merchant} size={28} />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-14 font-medium">Request to {vendorName(finding.merchant)}</span>
            <span className="text-12 text-dim">
              {typeLabel(finding.leak_type)}
              {finding.recover_by && ` · respond by ${formatDate(finding.recover_by, "short")}`}
            </span>
          </div>
          <span className="figure text-16 font-semibold">{formatMoney(finding.amount_minor)}</span>
        </div>
        <p className="m-0 text-13 text-dim">{displayReason(finding.reason, finding.merchant)}</p>
        <a href={`/#/claims/${finding.id}`} className="self-start text-13 font-medium text-mint-ink hover:underline">
          Read the draft and the evidence
        </a>
      </div>
      <div className="on-ink flex flex-col gap-3 bg-panel px-4 pb-4 pt-3">
        <p className="m-0 flex items-start gap-2 text-13 text-sub">
          <Lock aria-hidden className="mt-0.5 size-3.5 flex-none text-mint" strokeWidth={2} />
          <span>
            <span className="font-medium text-white">Only you can send.</span> In this mock-up, sliding sends nothing.
          </span>
        </p>
        <SlideToConfirm
          label="Slide to send"
          armedLabel="Press Enter again to send"
          confirmingLabel="Sending"
          doneLabel="Approved"
          resetAfter={null}
          onConfirm={async () => {
            await wait(900);
            onApproved();
          }}
        />
      </div>
    </div>
  );
}

function Agent({ facts }: { facts: Facts }) {
  const [view, setView] = useState<View>("icon");
  const [thinking, setThinking] = useState(false);
  const [progress, setProgress] = useState<Progress>({ done: 0, total: 0 });
  const [isDrafting, setIsDrafting] = useState(false);
  const [text, setText] = useState("");
  const nextId = useRef(2);
  const end = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);

  const soonest = facts.soonest;
  const [messages, setMessages] = useState<Message[]>(() => [
    {
      id: 1,
      from: "agent",
      text: soonest
        ? `${plural(facts.live.length, "claim")} open, worth ${formatMoney(facts.ready)}. ${vendorName(soonest.merchant)} is first: ${formatMoney(soonest.amount_minor)}, ${daysHint(soonest.days_left)?.toLowerCase()}. What do you want to do?`
        : "Nothing is open right now. I'll tell you when something new is found.",
    },
  ]);

  const say = (from: Message["from"], body: string, card?: Card) => setMessages((list) => [...list, { id: nextId.current++, from, text: body, card }]);
  const later = (ms: number, run: () => void) => timers.current.push(window.setTimeout(run, ms));
  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

  // Keep the newest message in view (not on load: the page should open at the top).
  useEffect(() => {
    if (messages.length > 1 || thinking) end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages, thinking]);

  const reply = (intent: Intent) => {
    if (intent === "savings") {
      setView("savings");
      const missed = facts.missed > 0 ? ` ${formatMoney(facts.missed)} was missed because the window closed.` : "";
      say(
        "agent",
        facts.recovered > 0
          ? `${formatMoney(facts.recovered)} recovered so far, with ${formatMoney(facts.ready)} still ready to claim.${missed}`
          : `Nothing has come back yet. ${formatMoney(facts.ready)} is ready to claim across ${plural(facts.live.length, "claim")}.${missed} I only count money as recovered once the credit shows in your ledger.`,
      );
    } else if (intent === "clock") {
      setView("clock");
      say(
        "agent",
        soonest
          ? `${vendorName(soonest.merchant)} is first: ${formatMoney(soonest.amount_minor)}, ${daysHint(soonest.days_left)?.toLowerCase()}. ${plural(facts.due30.length, "claim")} fall due in the next 30 days, worth ${formatMoney(sum(facts.due30))}.`
          : "No open claim has a deadline right now.",
      );
    } else if (intent === "vendors") {
      setView("vendors");
      const top = facts.vendors[0];
      say("agent", top ? `${top.name} owes the most: ${formatMoney(top.minor)} across ${plural(top.count, "claim")}. ${formatMoney(facts.ready)} is open across ${plural(facts.vendorCount, "vendor")}.` : "Nothing is open right now.");
    } else if (intent === "draft") {
      setView("clock");
      const held = facts.due30.filter((f) => f.outcome !== "recoverable").length;
      say(
        "agent",
        facts.due30.length
          ? `${plural(facts.due30.length, "claim")} fall due in the next 30 days.${held ? ` ${held === 1 ? "One needs" : `${held} need`} your review first, so I've left ${held === 1 ? "it" : "them"} out.` : ""} Untick any you want to hold.`
          : "Nothing falls due in the next 30 days.",
        facts.due30.length ? "checklist" : undefined,
      );
    } else {
      say("agent", "This is a mock-up, so I can only answer the four questions below for now.");
    }
  };

  const ask = (question: string) => {
    const body = question.trim();
    if (!body || thinking || isDrafting) return;
    say("you", body);
    setText("");
    setThinking(true);
    later(900, () => {
      setThinking(false);
      reply(intentOf(body));
    });
  };

  const draft = (picked: Finding[]) => {
    setIsDrafting(true);
    setProgress({ done: 0, total: picked.length });
    setView("progress");
    picked.forEach((_, i) => later(700 * (i + 1), () => setProgress({ done: i + 1, total: picked.length })));
    later(700 * picked.length + 600, () => {
      setIsDrafting(false);
      say("agent", `${plural(picked.length, "draft is", "drafts are")} ready. Nothing goes out until you approve each one. ${vendorName(picked[0].merchant)} is due first.`, "approval");
    });
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    ask(text);
  };

  const caption = captionOf(view, facts, progress);
  const first = facts.due30.find((f) => f.outcome === "recoverable") ?? null;
  const isBusy = thinking || isDrafting;

  return (
    <div className="agent-frame flex min-h-0 flex-col gap-8 md:flex-row md:gap-0">
      <aside aria-label="Agent" className="flex flex-none flex-col items-center gap-4 md:w-2/5 md:max-w-112 md:justify-center md:pr-8">
        <Stage view={view} facts={facts} progress={progress} thinking={thinking} />
        <div className="flex w-full max-w-70 flex-col gap-2 md:min-h-44">
          <div className="flex flex-col text-center">
            <h2 className="m-0 text-14 font-medium">{caption.title}</h2>
            <p className="m-0 text-13 text-dim">{caption.sub}</p>
          </div>
          {caption.keys.length > 0 && (
            <ul className="m-0 flex flex-col gap-1 p-0">
              {caption.keys.map((key) => (
                <li key={key.label} className="flex list-none items-center gap-2 text-13">
                  <span aria-hidden className="size-2 flex-none rounded-full" style={{ background: key.color }} />
                  <span className="flex-1 text-dim">{key.label}</span>
                  {key.value && <span className="figure">{key.value}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div role="group" aria-label="Show on the icon" className="flex gap-1">
          {SWITCH.map((item) => (
            <button
              key={item.view}
              type="button"
              aria-pressed={view === item.view}
              onClick={() => setView(item.view)}
              className={cn("h-8 rounded-sm px-2 text-13 transition-colors", view === item.view ? "font-medium text-mint-ink" : "text-dim hover:bg-wash hover:text-ink")}
            >
              {item.label}
            </button>
          ))}
        </div>
      </aside>

      <section aria-label="Conversation" className="flex min-h-0 min-w-0 flex-1 flex-col md:border-l md:border-line md:pl-8">
        <p className="m-0 flex flex-none items-center gap-2 pb-4 text-13 text-dim">
          <Tag tone="amber">Mock-up</Tag>
          Scripted replies, real figures. Nothing is sent.
        </p>
        <div role="log" aria-live="polite" className="flex min-h-0 flex-1 flex-col gap-5 pb-32 md:overflow-y-auto md:pb-4 md:pr-2">
          {messages.map((message) =>
            message.from === "you" ? (
              <p key={message.id} className="m-0 max-w-[80%] self-end rounded-md border border-line bg-wash px-3 py-2 text-14">
                <span className="sr-only">You: </span>
                {message.text}
              </p>
            ) : (
              <motion.div key={message.id} className="flex gap-3" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={SPRING}>
                <Avatar />
                <div className="flex min-w-0 max-w-xl flex-1 flex-col gap-3">
                  <p className="m-0 text-14">
                    <span className="sr-only">Recoup: </span>
                    {message.text}
                  </p>
                  {message.card === "checklist" && <Checklist rows={facts.due30} drafted={progress.done} isLocked={isDrafting || progress.total > 0} onDraft={draft} />}
                  {message.card === "approval" && first && (
                    <Approval
                      finding={first}
                      onApproved={() => say("agent", `That's the approval step. In the real agent this sends the request to ${vendorName(first.merchant)} and moves it to Waiting. Here nothing was sent.`)}
                    />
                  )}
                </div>
              </motion.div>
            ),
          )}
          {thinking && (
            <div className="flex items-center gap-3">
              <Avatar />
              <span className="text-14 text-dim">Checking your claims…</span>
            </div>
          )}
          <div ref={end} aria-hidden />
        </div>

        <div className="fixed inset-x-0 bottom-14 z-10 flex flex-none flex-col gap-3 border-t border-line bg-paper px-4 pb-3 pt-3 md:static md:px-0 md:pb-0">
          <div className="flex gap-2 overflow-x-auto md:flex-wrap">
            {CHIPS.map((chip) => (
              <Button key={chip} size="sm" className="flex-none" disabled={isBusy} onClick={() => ask(chip)}>
                {chip}
              </Button>
            ))}
          </div>
          <form onSubmit={onSubmit} className="flex gap-2">
            <label htmlFor="ask" className="sr-only">
              Message Recoup
            </label>
            <input
              id="ask"
              name="ask"
              type="text"
              autoComplete="off"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Ask Recoup, or tell it what to do"
              className="h-10 min-w-0 flex-1 rounded-sm border border-line-strong bg-paper px-3 text-14 text-ink placeholder:text-dim"
            />
            <Button type="submit" size="lg" aria-label="Send" disabled={isBusy || !text.trim()}>
              <ArrowUp aria-hidden className="size-4" strokeWidth={2} />
            </Button>
          </form>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------

/** The sidebar has no Home item yet; the mock adds one so the page reads as the landing screen. */
function HomeNavItem() {
  const [list, setList] = useState<Element | null>(null);
  useEffect(() => setList(document.querySelector('nav[aria-label="Pages"] ul')), []);
  if (!list) return null;
  return createPortal(
    <li className="order-first list-none">
      <a href="#" aria-current="page" className="flex h-9 items-center gap-3 rounded-sm px-3 text-14 font-medium text-mint-ink">
        <Sparkles aria-hidden className="size-4 flex-none" strokeWidth={1.75} />
        <span className="flex-1">Home</span>
      </a>
    </li>,
    list,
  );
}

function Harness() {
  const { summary, findings, error } = useCases();
  const { sources } = useSources();
  if (summary) setReferenceYear(summary.as_of);
  const facts = useMemo(() => (summary ? factsOf(summary, findings) : null), [summary, findings]);

  return (
    <MotionConfig reducedMotion="user">
      <Shell
        page={"home" as unknown as Page}
        title="Home"
        claimsCount={countsFor(findings).todo}
        summary={summary}
        sources={sources}
        findings={findings}
        isRunning={false}
        isAdvancing={false}
        onRun={() => {}}
        onAdvance={() => {}}
        onExport={() => {}}
        onOpenCase={(id) => go(`#/claims/${id}`)}
        onGo={(page) => go(`#/${page}`)}
      >
        <HomeNavItem />
        {error && <p className="m-0 text-14 text-danger">{error}</p>}
        {facts && <Agent facts={facts} />}
      </Shell>
    </MotionConfig>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
