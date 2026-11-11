// Types for particle-coin.mjs.
export type CoinState = "idle" | "thinking" | "talking" | "found" | "approval";
export type RingKind = "savings" | "deadline";
/**
 * Other things the dust can reform into, each reached with the same let-go, flight and settle as the ring:
 * "radar" a circle with a sweep line that keeps turning; "bars" a small bar chart; "plane" a paper plane
 * that forms, flies off to the right and is gone (one shot); "check" a check mark inside a ring that
 * fills to `value`.
 */
export type ShapeKind = "radar" | "bars" | "plane" | "check";
export interface ShapeOptions {
  /** "check": how full its ring is, 0..1. */
  value?: number;
  /** "bars": each bar's height, 0..1, left to right; one to five bars. New heights move the bars; a new number of bars reforms through dust. */
  bars?: number[];
  /** "plane": called once it has flown off and the coin has reformed. Not called if the shape is changed before that. */
  onDone?: () => void;
}
/** What is solid on screen: the ring (either kind), a shape, or null while it is the coin or dust. */
export type Formation = "ring" | ShapeKind;

export interface CoinHandle {
  /** Resolves once the poses have loaded and the coin is drawing. Rejects if they cannot be loaded. */
  ready: Promise<void>;
  /** "found" replays its burst on every call. */
  setState(state: CoinState): void;
  /** A kind with a 0..1 value turns the coin into the solid ring; null turns it back. */
  setRing(kind: RingKind | null, value?: number): void;
  /**
   * A kind turns the coin into that shape; null turns it back. A shape and a ring are never set together
   * (the shape wins if they are). "plane" is one shot: asking for it again while it is the shape does nothing.
   */
  setShape(kind: ShapeKind | null, options?: ShapeOptions): void;
  /** Calls `listener` when a formation becomes solid, and with null when it starts to leave: when a figure can show. */
  watch(listener: ((solid: Formation | null) => void) | null): void;
  /** Keeps the voice going; call it per word while a reply streams in. */
  pulse(): void;
  /** 1 is real time. */
  setSpeed(speed: number): void;
  dispose(): void;
}

type TimingKey =
  | "idleLoop"
  | "approvalLoop"
  | "burstOut"
  | "burstSettle"
  | "scatter"
  | "fly"
  | "fuse"
  | "swirlTurn"
  | "talkHold"
  | "arcFill"
  | "reducedFade"
  | "radarTurn"
  | "planeHold"
  | "planeFly";

/** Every duration, in seconds. */
export declare const TIMING: Readonly<Record<TimingKey, number>>;
export declare function createCoin(canvas: HTMLCanvasElement): CoinHandle;
