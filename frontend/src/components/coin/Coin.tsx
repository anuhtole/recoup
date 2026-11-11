// The agent's particle coin as a React component. The engine draws with three.js, which it loads from
// a CDN, so it is imported on demand: if that fails the page still works and shows the brand mark.
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { cn } from "@/lib/utils";
import type { CoinHandle, CoinState, Formation, RingKind, ShapeKind } from "./particle-coin.mjs";

export type { CoinHandle, CoinState, RingKind, ShapeKind };

export const reducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface CoinProps {
  state: CoinState;
  /** Change this to replay a one-shot state ("found"). */
  plays?: number;
  /** The solid ring the coin reforms into, or null for the coin itself. */
  ring: RingKind | null;
  /** How full the ring is, 0..1 (also the ring around the "check" shape). */
  value: number;
  /** Another shape for the dust to reform into, or null/undefined for none. Never together with `ring`. */
  shape?: ShapeKind | null;
  /** "bars": each bar's height, 0..1, left to right; one to five. */
  bars?: number[];
  /** A one-shot shape ("plane") has finished and the coin is back. */
  onShapeDone?: () => void;
  /**
   * The number that goes with a ring, "bars" or "check", and the line under it. A ring shows it in its
   * middle; "bars" and "check" show it under the shape. "radar" and "plane" show none.
   */
  figure?: string;
  figureLabel?: string;
  /** What a screen reader hears in place of the drawing. */
  label: string;
  /** The running coin, for pulse(). Null until it has loaded. */
  handleRef?: MutableRefObject<CoinHandle | null>;
  className?: string;
}

export function Coin({ state, plays = 0, ring, value, shape = null, bars, onShapeDone, figure, figureLabel, label, handleRef, className }: CoinProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coinRef = useRef<CoinHandle | null>(null);
  // The formation that is solid on screen right now, as the engine reports it: a figure waits for its own.
  const [solid, setSolid] = useState<Formation | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let coin: CoinHandle | null = null;
    let isGone = false;
    import("./particle-coin.mjs")
      .then((engine) => {
        if (isGone) return;
        coin = engine.createCoin(canvas);
        coin.watch((formation) => {
          if (!isGone) setSolid(formation);
        });
        coinRef.current = coin;
        if (handleRef) handleRef.current = coin;
        return coin.ready.then(() => {
          if (!isGone) setIsReady(true);
        });
      })
      .catch(() => {
        if (!isGone) setHasFailed(true);
      });
    return () => {
      isGone = true;
      coin?.dispose();
      coinRef.current = null;
      if (handleRef) handleRef.current = null;
      setSolid(null);
    };
  }, [handleRef]);

  // Both run again once the coin is ready: "found" only plays its burst on a coin that has loaded.
  useEffect(() => {
    coinRef.current?.setState(state);
  }, [state, plays, isReady]);

  useEffect(() => {
    coinRef.current?.setRing(ring, value);
  }, [ring, value, isReady]);

  // The latest callback, so a new function each render doesn't restart the shape.
  const doneRef = useRef(onShapeDone);
  doneRef.current = onShapeDone;
  const barsKey = bars?.join(",") ?? "";
  useEffect(() => {
    coinRef.current?.setShape(shape, { value, bars, onDone: () => doneRef.current?.() });
    // `barsKey` stands in for `bars`, which is a new array each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, value, barsKey, isReady]);

  // Without the engine there is no plane to wait for, so the page is told at once that it has gone.
  useEffect(() => {
    if (!hasFailed || shape !== "plane") return;
    const timer = window.setTimeout(() => doneRef.current?.(), 0);
    return () => window.clearTimeout(timer);
  }, [hasFailed, shape]);

  // What the props ask for, and where its figure goes: in a ring's middle, or under the bars and the
  // check (both are drawn in the upper two thirds of the box to leave that room). The figure shows
  // once that formation is solid. Without the engine nothing is drawn, so it shows at once, centred.
  const asked: Formation | null = shape ?? (ring ? "ring" : null);
  const spot = asked === "ring" ? "middle" : asked === "bars" || asked === "check" ? "under" : null;
  const isShown = spot !== null && (hasFailed || solid === asked);

  return (
    <div className={cn("@container relative aspect-square", className)}>
      {hasFailed ? (
        !spot && <img src="/brand/recoup-mark-180-ink.png" alt={label} width={96} height={96} className="absolute inset-0 m-auto size-24 rounded-md" />
      ) : (
        <canvas ref={canvasRef} role="img" aria-label={label} className="absolute inset-0 h-full w-full" />
      )}
      <Figure
        isShown={isShown && (spot === "middle" || hasFailed)}
        isRead={hasFailed}
        figure={figure}
        label={figureLabel}
        className="inset-0 justify-center"
        labelClassName="max-w-[45%]"
      />
      <Figure isShown={isShown && spot === "under" && !hasFailed} isRead={false} figure={figure} label={figureLabel} className="inset-x-0 top-2/3 px-2" />
    </div>
  );
}

interface FigureProps {
  isShown: boolean;
  /** Read out by a screen reader: only when there is no drawing whose label already says it. */
  isRead: boolean;
  figure?: string;
  label?: string;
  className: string;
  labelClassName?: string;
}

/** A number and the line under it, faded in over the coin. */
function Figure({ isShown, isRead, figure, label, className, labelClassName }: FigureProps) {
  // While it fades out it keeps the text it had, so the next formation's figure never flashes in the old place.
  const [kept, setKept] = useState({ figure, label });
  if (isShown && (kept.figure !== figure || kept.label !== label)) setKept({ figure, label });
  const text = isShown ? { figure, label } : kept;
  return (
    <div
      aria-hidden={!isRead}
      className={cn(
        "pointer-events-none absolute flex flex-col items-center text-center transition-opacity duration-300",
        isShown ? "opacity-100" : "opacity-0",
        className,
      )}
    >
      {/* Sized by the coin, not the window: a five-figure sum has to fit a 192px coin too. */}
      <span className="figure text-14 font-semibold @3xs:text-20 @xs:text-28">{text.figure}</span>
      <span className={cn("text-12 text-dim @xs:text-13", labelClassName)}>{text.label}</span>
    </div>
  );
}
