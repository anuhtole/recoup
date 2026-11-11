// Prototype only: a test page for the particle coin's motion, with one button for each state.
// Nothing in the app imports this and it calls no API. Every figure on it is a labelled sample.
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./coins.css";
import { Button } from "../src/components/Button";
import { cn } from "../src/lib/utils";
import {
  createCoin as createCoinV2,
  TIMING,
  type CoinHandle,
  type CoinState,
  type Formation,
  type RingKind,
  type ShapeKind,
} from "../src/components/coin/particle-coin.mjs";
import { createCoin as createCoinV1 } from "./particle-coin-v1.mjs";

type View = CoinState | RingKind | ShapeKind;
type Version = "v1" | "v2";

// Two engines side by side so the versions can be compared. v1 is the frozen first version.
const VERSIONS: { id: Version; label: string; create: typeof createCoinV2; hint: string }[] = [
  { id: "v1", label: "v1 (saved)", create: createCoinV1, hint: "Move over the coin: the particles ripple like water." },
  {
    id: "v2",
    label: "v2 (new)",
    create: createCoinV2,
    hint: "Move over the coin: the particles hang like dust in the air, scatter as you pass and drift back.",
  },
];
// Where v1 behaves differently from the notes below.
const V1_NOTES: Partial<Record<View, string>> = {
  talking: "The rim breaks into bars that rise and fall with the voice, like a sound meter around the coin. When the voice stops they close back into the rim. The R holds still.",
};

const STATES: { id: CoinState; label: string; note: string }[] = [
  { id: "idle", label: "Idle", note: `Slow breathing every ${TIMING.idleLoop} seconds. Every point drifts loosely on its own path, and a few stray further out.` },
  { id: "thinking", label: "Thinking", note: "The R and the inner points hold still. The dark rim gathers into three streaks that circle the coin." },
  { id: "talking", label: "Talking", note: "The rim stays one unbroken ring whose outline bumps and travels with the voice. When the voice stops it settles back into the rim. The R holds still." },
  {
    id: "found",
    label: "Found money",
    note: `A burst outward (${TIMING.burstOut} s), a spring back (${TIMING.burstSettle} s) and one mint flash. Press again to replay.`,
  },
  { id: "approval", label: "Needs approval", note: `A slow amber pulse every ${TIMING.approvalLoop} seconds. It holds until you act.` },
];
const RINGS: { id: RingKind; label: string; note: string }[] = [
  { id: "savings", label: "Savings ring", note: "The points stream onto a ring, and a solid ring grows clockwise from 12 o'clock, taking them in. It then settles to the value." },
  { id: "deadline", label: "Deadline clock", note: "The same move, ending in a solid clock ring that shows the time left." },
];
// The other things the dust can make. v1 has none of them.
const SHAPES: { id: ShapeKind; label: string; note: string }[] = [
  { id: "radar", label: "Radar", note: `The ring, a smaller ring and a hub. Once they are solid a sweep line turns, one lap every ${TIMING.radarTurn} seconds, with a fade behind it.` },
  { id: "bars", label: "Bars", note: "A line runs out from the left and one to five bars rise off it. New heights move the bars; a new number of bars goes through the dust." },
  {
    id: "plane",
    label: "Paper plane",
    note: `Drawn in one line, held for ${TIMING.planeHold} seconds, then it flies up and to the right (${TIMING.planeFly} s) and drops its dust, and the coin reforms. One shot.`,
  },
  { id: "check", label: "Check", note: "A smaller ring with a check mark in it. The ring fills to the share that came back, the way the savings ring does." },
];
const SHAPE_IDS = SHAPES.map((item) => item.id) as readonly string[];
const NOTES = Object.fromEntries([...STATES, ...RINGS, ...SHAPES].map((v) => [v.id, v.note])) as Record<View, string>;
const SAMPLE_BARS = [1, 0.72, 0.5, 0.33, 0.18];
const REQUESTS = 5;

const DAYS = 30;
const MORPH = TIMING.scatter + TIMING.fly + TIMING.fuse;
const WORD_GAP = 0.11; // seconds between words of the sample reply
const SAMPLE_REPLY =
  "Figma billed you for 40 seats after you dropped to 31 in March. That is $1,620 you can ask for back. I drafted the request and it is ready for you to review.";
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coinRef = useRef<CoinHandle | null>(null);
  const [view, setView] = useState<View>("idle");
  const [plays, setPlays] = useState(0);
  const [saved, setSaved] = useState(62);
  const [daysLeft, setDaysLeft] = useState(12);
  const [slow, setSlow] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reply, setReply] = useState("");
  const [version, setVersion] = useState<Version>("v2");
  const [barCount, setBarCount] = useState(5);
  const [barOrder, setBarOrder] = useState(0);
  const [back, setBack] = useState(3);
  const [solid, setSolid] = useState<Formation | null>(null);

  const ring: RingKind | null = view === "savings" || view === "deadline" ? view : null;
  const shape: ShapeKind | null = SHAPE_IDS.includes(view) ? (view as ShapeKind) : null;
  const state: CoinState = ring || shape ? "idle" : (view as CoinState);
  // The sample heights, turned around by the "Move the bars" button.
  const bars = SAMPLE_BARS.slice(0, barCount).map((_, k, list) => list[(k + barOrder) % list.length]);
  const speed = slow ? 0.25 : 1;
  const engine = VERSIONS.find((item) => item.id === version)!;

  // Each version gets its own canvas (keyed below) and its own coin; the effects after this one
  // also run on a version change, so the new coin picks up the current state, ring and speed.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const coin = engine.create(canvas);
    coinRef.current = coin;
    // A handle for poking at the motion from the console while this is a prototype.
    (window as unknown as { __coin?: CoinHandle }).__coin = coin;
    coin.ready.catch(() => setFailed(true));
    coin.watch?.(setSolid);
    return () => {
      coin.dispose();
      coinRef.current = null;
      setSolid(null);
    };
  }, [engine]);

  useEffect(() => {
    coinRef.current?.setState(state);
  }, [state, plays, version]);

  useEffect(() => {
    coinRef.current?.setRing(ring, ring === "savings" ? saved / 100 : daysLeft / DAYS);
  }, [ring, saved, daysLeft, version]);

  // v1 has no shapes, so the call is skipped there. The plane puts the page back on Idle when it has gone.
  const barsKey = bars.join(",");
  useEffect(() => {
    coinRef.current?.setShape?.(shape, { value: back / REQUESTS, bars, onDone: () => setView("idle") });
    // `barsKey` stands in for `bars`, which is a new array each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, back, barsKey, version]);

  useEffect(() => {
    coinRef.current?.setSpeed(speed);
  }, [speed, version]);

  // Talking: a scripted reply arrives word by word, and each word keeps the voice going.
  useEffect(() => {
    if (view !== "talking") {
      setReply("");
      return;
    }
    const words = SAMPLE_REPLY.split(" ");
    let shown = 0;
    let timer = 0;
    const next = () => {
      if (shown === words.length) {
        shown = 0;
        timer = window.setTimeout(next, 1600);
        return;
      }
      shown += 1;
      setReply(words.slice(0, shown).join(" "));
      coinRef.current?.pulse();
      timer = window.setTimeout(next, (WORD_GAP * 1000) / speed);
    };
    next();
    return () => window.clearTimeout(timer);
  }, [view, speed]);

  const choose = (id: View) => {
    setView(id);
    setPlays((count) => count + 1);
  };
  const figure = ring === "savings" ? `${saved}%` : ring ? `${daysLeft}` : shape === "bars" ? "$13,710.09" : "$4,789.38";
  const figureLabel =
    ring === "savings"
      ? "recovered (sample)"
      : ring
        ? `of ${DAYS} days left (sample)`
        : shape === "bars"
          ? `owed across ${barCount} vendors (sample)`
          : `back from ${back} of ${REQUESTS} requests (sample)`;
  // A ring's figure sits in its middle; the bars' and the check's sit under the shape. It shows once
  // the engine says that formation is solid.
  const hasFigureUnder = shape === "bars" || shape === "check";
  // v1 cannot say, so its ring's figure waits out the morph instead.
  const isSolid = version === "v1" ? ring !== null : solid === (shape ?? (ring ? "ring" : null));
  const figureWait = version === "v1" && ring ? (reducedMotion ? TIMING.reducedFade : MORPH) / speed : 0;

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-4 md:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-20 font-semibold">Particle coin: motion test</h1>
        <p className="text-14 text-dim">One button for each state. {engine.hint}</p>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="relative mx-auto aspect-square w-full max-w-120 rounded-md border border-line bg-paper md:mx-0">
          <canvas
            key={version}
            ref={canvasRef}
            role="img"
            aria-label={
              ring
                ? `The Recoup coin as a solid ring: ${figure} ${figureLabel}`
                : hasFigureUnder
                  ? `The Recoup coin as ${shape}: ${figure} ${figureLabel}`
                  : shape
                    ? `The Recoup coin as a ${shape}`
                    : "The Recoup coin, drawn in particles"
            }
            className="absolute inset-0 h-full w-full"
          />
          <div
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute flex flex-col items-center transition-opacity duration-300",
              hasFigureUnder ? "inset-x-0 top-2/3" : "inset-0 justify-center",
              (ring || hasFigureUnder) && isSolid ? "opacity-100" : "opacity-0",
            )}
            style={{ transitionDelay: `${figureWait}s` }}
          >
            <span className={cn("figure font-semibold", hasFigureUnder ? "text-28" : "text-28 md:text-44")}>{figure}</span>
            <span className="text-13 text-dim">{figureLabel}</span>
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-2">
            <h2 className="text-13 font-medium text-dim">Version</h2>
            <div role="group" aria-label="Coin version" className="flex flex-wrap gap-2">
              {VERSIONS.map((item) => (
                <Button key={item.id} variant={version === item.id ? "primary" : "secondary"} onClick={() => setVersion(item.id)}>
                  {item.label}
                </Button>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-13 font-medium text-dim">States</h2>
            <div role="group" aria-label="Coin state" className="flex flex-wrap gap-2">
              {STATES.map((item) => (
                <Button key={item.id} variant={view === item.id ? "primary" : "secondary"} onClick={() => choose(item.id)}>
                  {item.label}
                </Button>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-13 font-medium text-dim">Coin to ring</h2>
            <div role="group" aria-label="Ring" className="flex flex-wrap gap-2">
              {RINGS.map((item) => (
                <Button key={item.id} variant={view === item.id ? "primary" : "secondary"} onClick={() => choose(item.id)}>
                  {item.label}
                </Button>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-13 font-medium text-dim">Coin to another shape (v2 only)</h2>
            <div role="group" aria-label="Shape" className="flex flex-wrap gap-2">
              {SHAPES.map((item) => (
                <Button key={item.id} variant={view === item.id ? "primary" : "secondary"} disabled={version === "v1"} onClick={() => choose(item.id)}>
                  {item.label}
                </Button>
              ))}
            </div>
          </section>

          <p aria-live="polite" className="text-14">
            {(version === "v1" && V1_NOTES[view]) || NOTES[view]}
          </p>

          {shape === "bars" && (
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1 text-13 text-dim">
                Sample: {barCount} {barCount === 1 ? "bar" : "bars"}
                <input
                  type="range"
                  min={1}
                  max={SAMPLE_BARS.length}
                  value={barCount}
                  onChange={(e) => setBarCount(Number(e.target.value))}
                  className="w-full accent-mint-ink"
                />
              </label>
              <div>
                <Button variant="secondary" onClick={() => setBarOrder((n) => n + 1)}>
                  Move the bars
                </Button>
              </div>
            </div>
          )}
          {shape === "check" && (
            <label className="flex flex-col gap-1 text-13 text-dim">
              Sample value: {back} of {REQUESTS} requests back
              <input
                type="range"
                min={0}
                max={REQUESTS}
                value={back}
                onChange={(e) => setBack(Number(e.target.value))}
                className="w-full accent-mint-ink"
              />
            </label>
          )}

          {ring === "savings" && (
            <label className="flex flex-col gap-1 text-13 text-dim">
              Sample value: {saved}% recovered
              <input
                type="range"
                min={0}
                max={100}
                value={saved}
                onChange={(e) => setSaved(Number(e.target.value))}
                className="w-full accent-mint-ink"
              />
            </label>
          )}
          {ring === "deadline" && (
            <label className="flex flex-col gap-1 text-13 text-dim">
              Sample value: {daysLeft} of {DAYS} days left
              <input
                type="range"
                min={0}
                max={DAYS}
                value={daysLeft}
                onChange={(e) => setDaysLeft(Number(e.target.value))}
                className="w-full accent-mint-ink"
              />
            </label>
          )}
          {view === "talking" && (
            <div className="flex flex-col gap-1">
              <span className="text-13 text-dim">Sample reply (scripted)</span>
              <p className="min-h-24 rounded-md border border-line bg-wash p-3 text-14">{reply}</p>
            </div>
          )}

          <label className="flex items-center gap-2 text-14">
            <input type="checkbox" checked={slow} onChange={(e) => setSlow(e.target.checked)} className="size-4 accent-mint-ink" />
            Slow motion (¼ speed)
          </label>

          {reducedMotion && (
            <p className="text-13 text-dim">Reduced motion is on, so every state is a simple fade instead of movement.</p>
          )}
          {failed && (
            <p role="alert" className="text-13 text-amber-ink">
              The coin's shapes could not be loaded. Run blender/coin_poses.py to export them again.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
