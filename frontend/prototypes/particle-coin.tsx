// Prototype only: a test page for the particle coin's motion, with one button for each state.
// Nothing in the app imports this and it calls no API. Every figure on it is a labelled sample.
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./coins.css";
import { Button } from "../src/components/Button";
import { cn } from "../src/lib/utils";
import { createCoin, TIMING, type CoinHandle, type CoinState, type RingKind } from "./particle-coin.mjs";

type View = CoinState | RingKind;

const STATES: { id: CoinState; label: string; note: string }[] = [
  { id: "idle", label: "Idle", note: `Slow breathing every ${TIMING.idleLoop} seconds. Every point drifts loosely on its own path, and a few stray further out.` },
  { id: "thinking", label: "Thinking", note: "The R and the inner points hold still. The dark rim gathers into three streaks that circle the coin." },
  { id: "talking", label: "Talking", note: "The rim breaks into bars that rise and fall with the voice, like a sound meter around the coin. When the voice stops they close back into the rim. The R holds still." },
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
const NOTES = Object.fromEntries([...STATES, ...RINGS].map((v) => [v.id, v.note])) as Record<View, string>;

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

  const ring: RingKind | null = view === "savings" || view === "deadline" ? view : null;
  const state: CoinState = view === "savings" || view === "deadline" ? "idle" : view;
  const speed = slow ? 0.25 : 1;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const coin = createCoin(canvas);
    coinRef.current = coin;
    // A handle for poking at the motion from the console while this is a prototype.
    (window as unknown as { __coin?: CoinHandle }).__coin = coin;
    coin.ready.catch(() => setFailed(true));
    return () => {
      coin.dispose();
      coinRef.current = null;
    };
  }, []);

  useEffect(() => {
    coinRef.current?.setState(state);
  }, [state, plays]);

  useEffect(() => {
    coinRef.current?.setRing(ring, ring === "savings" ? saved / 100 : daysLeft / DAYS);
  }, [ring, saved, daysLeft]);

  useEffect(() => {
    coinRef.current?.setSpeed(speed);
  }, [speed]);

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
  const figure = ring === "savings" ? `${saved}%` : `${daysLeft}`;
  const figureLabel = ring === "savings" ? "recovered (sample)" : `of ${DAYS} days left (sample)`;

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-4 md:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-20 font-semibold">Particle coin: motion test</h1>
        <p className="text-14 text-dim">One button for each state. Move over the coin to stir the particles.</p>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="relative mx-auto aspect-square w-full max-w-120 rounded-md border border-line bg-paper md:mx-0">
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={ring ? `The Recoup coin as a solid ring: ${figure} ${figureLabel}` : "The Recoup coin, drawn in particles"}
            className="absolute inset-0 h-full w-full"
          />
          <div
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-0 flex flex-col items-center justify-center transition-opacity duration-300",
              ring ? "opacity-100" : "opacity-0",
            )}
            style={{ transitionDelay: ring ? `${(reducedMotion ? TIMING.reducedFade : MORPH) / speed}s` : "0s" }}
          >
            <span className="figure text-28 font-semibold md:text-44">{figure}</span>
            <span className="text-13 text-dim">{figureLabel}</span>
          </div>
        </div>

        <div className="flex flex-col gap-5">
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

          <p aria-live="polite" className="text-14">
            {NOTES[view]}
          </p>

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
