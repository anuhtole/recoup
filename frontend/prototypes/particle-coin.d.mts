// Types for particle-coin.mjs (prototype only).
export type CoinState = "idle" | "thinking" | "talking" | "found" | "approval";
export type RingKind = "savings" | "deadline";

export interface CoinHandle {
  /** Resolves once the poses have loaded and the coin is drawing. Rejects if they cannot be loaded. */
  ready: Promise<void>;
  /** "found" replays its burst on every call. */
  setState(state: CoinState): void;
  /** A kind with a 0..1 value turns the coin into the solid ring; null turns it back. */
  setRing(kind: RingKind | null, value?: number): void;
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
  | "reducedFade";

/** Every duration, in seconds. */
export declare const TIMING: Readonly<Record<TimingKey, number>>;
export declare function createCoin(canvas: HTMLCanvasElement): CoinHandle;
