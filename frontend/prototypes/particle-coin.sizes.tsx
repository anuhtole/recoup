// Prototype only: the Coin component at 400, 300, 256 and 192 pixels, side by side, with one button
// for each formation, to check that every shape and its figure fit the box at every size.
// Nothing in the app imports this and it calls no API. Every figure on it is a labelled sample.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import "./coins.css";
import { Button } from "../src/components/Button";
import { Coin, type CoinState, type RingKind, type ShapeKind } from "../src/components/coin/Coin";

interface Look {
  label: string;
  state?: CoinState;
  ring?: RingKind;
  shape?: ShapeKind;
  value?: number;
  bars?: number[];
  figure?: string;
  figureLabel?: string;
}

const LOOKS: Record<string, Look> = {
  coin: { label: "Coin" },
  thinking: { label: "Thinking", state: "thinking" },
  savings: { label: "Savings ring", ring: "savings", value: 0.62, figure: "$4,789.38", figureLabel: "recovered (sample)" },
  deadline: { label: "Deadline clock", ring: "deadline", value: 0.4, figure: "12", figureLabel: "of 30 days left (sample)" },
  radar: { label: "Radar", shape: "radar" },
  bars: { label: "Bars", shape: "bars", bars: [1, 0.72, 0.5, 0.33, 0.18], figure: "$13,710.09", figureLabel: "owed across 11 vendors" },
  bars3: { label: "Three bars", shape: "bars", bars: [0.4, 1, 0.7], figure: "$13,710.09", figureLabel: "owed across 11 vendors" },
  plane: { label: "Paper plane", shape: "plane" },
  check: { label: "Check", shape: "check", value: 0.6, figure: "$4,789.38", figureLabel: "back from 3 of 5 requests" },
};
// Spacing tokens: 100 is 400px, 75 is 300px, 64 is 256px, 48 is 192px.
const SIZES = [
  { name: "400", className: "size-100" },
  { name: "300", className: "size-75" },
  { name: "256", className: "size-64" },
  { name: "192", className: "size-48" },
];

function App() {
  const [id, setId] = useState("coin");
  const [done, setDone] = useState(0);
  const look = LOOKS[id] ?? LOOKS.coin;
  // A handle for scripts: window.__look("bars") changes all four coins.
  Object.assign(window, { __look: setId });

  return (
    <main className="flex flex-col gap-4 p-4">
      <div role="group" aria-label="Formation" className="flex flex-wrap gap-2">
        {Object.entries(LOOKS).map(([key, item]) => (
          <Button key={key} variant={id === key ? "primary" : "secondary"} onClick={() => setId(key)}>
            {item.label}
          </Button>
        ))}
      </div>
      <p className="text-13 text-dim" data-done={done}>
        Planes that have gone and reported back: {done}
      </p>
      <div className="flex flex-wrap items-start gap-4">
        {SIZES.map((size) => (
          <div key={size.name} data-size={size.name} className="rounded-md border border-line">
            <Coin
              state={look.state ?? "idle"}
              ring={look.ring ?? null}
              shape={look.shape ?? null}
              value={look.value ?? 0}
              bars={look.bars}
              figure={look.figure}
              figureLabel={look.figureLabel}
              onShapeDone={() => setDone((count) => count + 1)}
              label={`${look.label} at ${size.name} pixels`}
              className={size.className}
            />
          </div>
        ))}
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
