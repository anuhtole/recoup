// Where the recovered money came from and what it was for: vendors on the left, the total in the middle,
// claim types on the right, each band as thick as its money. A vendor or a type can be picked, which the
// page uses to filter its list. Drawn in SVG by hand: the app has no chart library, and three columns
// don't need one.
import { type KeyboardEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Finding } from "../api";
import { formatMoney, plural } from "../format";
import { typeLabel } from "../lib/claimTypes";
import { vendorName } from "../lib/vendors";

const FLOW = 176; // height of the whole flow, i.e. of the middle bar
const BAR = 8; // width of a node's bar
const SLOT = 40; // the least room a node gets, so its two-line label never touches its neighbour's
const GAP = 8;
const TOP = 48; // room above the columns for the middle bar's label
const MAX_VENDORS = 8; // past this, the smallest are folded into "Other"

interface Item {
  label: string;
  minor: number;
  count: number;
}

interface Node extends Item {
  /** Top and height of the bar. */
  y: number;
  h: number;
  /** Top and height of the row the node owns, label included. */
  top: number;
  slot: number;
}

/** A vendor or a claim type chosen in the diagram. */
export interface Pick {
  kind: "vendor" | "type";
  label: string;
}

const OTHER = "Other";

const recoveredMinor = (f: Finding) => f.recovered_minor ?? f.amount_minor;

function group(findings: Finding[], labelOf: (f: Finding) => string): Item[] {
  const map = new Map<string, Item>();
  for (const f of findings) {
    const label = labelOf(f);
    const item = map.get(label) ?? { label, minor: 0, count: 0 };
    item.minor += recoveredMinor(f);
    item.count += 1;
    map.set(label, item);
  }
  return [...map.values()].sort((a, b) => b.minor - a.minor);
}

/** Stack a column's nodes top to bottom; a thin node is centred in its slot. */
function stack(items: Item[], scale: number): { nodes: Node[]; height: number } {
  let y = 0;
  const nodes = items.map((item) => {
    const h = Math.max(2, item.minor * scale);
    const slot = Math.max(h, SLOT);
    const node = { ...item, h, y: y + (slot - h) / 2, top: y, slot };
    y += slot + GAP;
    return node;
  });
  return { nodes, height: Math.max(0, y - GAP) };
}

/** A band from one bar to another, as thick as its money at both ends. */
function band(x0: number, y0: number, x1: number, y1: number, h: number): string {
  const mid = (x0 + x1) / 2;
  return `M${x0},${y0} C${mid},${y0} ${mid},${y1} ${x1},${y1} L${x1},${y1 + h} C${mid},${y1 + h} ${mid},${y0 + h} ${x0},${y0 + h} Z`;
}

const clip = (text: string, chars: number) => (text.length > chars ? `${text.slice(0, Math.max(1, chars - 1)).trimEnd()}…` : text);

interface Props {
  findings: Finding[];
  currency: string;
  pick?: Pick | null;
  /** Given, the vendors and types become buttons; picking the picked one again clears it. */
  onPick?: (pick: Pick | null) => void;
}

export function RecoverySankey({ findings, currency, pick = null, onPick }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { vendors, types, total } = useMemo(() => {
    const ranked = group(findings, (f) => vendorName(f.merchant));
    // "Other" takes the last row, and only when it stands for more than one vendor.
    const keep = ranked.length > MAX_VENDORS ? MAX_VENDORS - 1 : ranked.length;
    const rest = ranked.slice(keep);
    const top = ranked.slice(0, keep);
    if (rest.length) top.push({ label: OTHER, minor: rest.reduce((t, v) => t + v.minor, 0), count: rest.reduce((t, v) => t + v.count, 0) });
    return { vendors: top, types: group(findings, (f) => typeLabel(f.leak_type)), total: findings.reduce((t, f) => t + recoveredMinor(f), 0) };
  }, [findings]);

  if (total <= 0) return null;

  const scale = FLOW / total;
  const left = stack(vendors, scale);
  const right = stack(types, scale);
  const height = Math.max(left.height, right.height, FLOW);
  const gutter = width < 480 ? 120 : width < 680 ? 168 : 208; // room for the labels on each side
  const chars = Math.floor((gutter - 16) / 7.4); // a 13px medium letter is about 7.4px wide
  const xLeft = gutter;
  const xMid = width / 2 - BAR / 2;
  const xRight = width - gutter - BAR;
  const yLeft = TOP + (height - left.height) / 2;
  const yRight = TOP + (height - right.height) / 2;
  const yMid = TOP + (height - FLOW) / 2;

  // Where each band lands on the middle bar: in column order, so bands never cross.
  let inAt = yMid;
  let outAt = yMid;

  const isPicked = (kind: Pick["kind"], label: string) => pick?.kind === kind && pick.label === label;
  const canPick = (label: string) => Boolean(onPick) && label !== OTHER;
  const toggle = (kind: Pick["kind"], label: string) => onPick?.(isPicked(kind, label) ? null : { kind, label });
  // A band is full when its node is picked, faint when another node in its column is, and half otherwise.
  const bandClass = (kind: Pick["kind"], label: string) =>
    `fill-mint transition-opacity duration-150 ease-out ${pick?.kind === kind ? (pick.label === label ? "opacity-90" : "opacity-20") : "opacity-50 hover:opacity-90"} ${canPick(label) ? "cursor-pointer" : ""}`;
  const button = (kind: Pick["kind"], node: Node) =>
    canPick(node.label)
      ? {
          role: "button",
          tabIndex: 0,
          "aria-pressed": isPicked(kind, node.label),
          "aria-label": `${node.label}, ${formatMoney(node.minor, currency)}, ${plural(node.count, "claim")}. Show only these.`,
          onClick: () => toggle(kind, node.label),
          onKeyDown: (event: KeyboardEvent<SVGGElement>) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            toggle(kind, node.label);
          },
          className: "group cursor-pointer outline-none",
        }
      : {};
  // The row behind a node's label: its hover tint and its focus ring.
  const hit = "fill-transparent stroke-transparent transition-colors duration-150 ease-out group-hover:fill-wash group-focus-visible:stroke-mint-ink group-aria-pressed:fill-wash";

  return (
    <div ref={root} className="mx-auto w-full max-w-4xl pt-4">
      <svg
        role="group"
        aria-label={`${formatMoney(total, currency)} recovered, by vendor and by claim type`}
        width={width}
        height={TOP + height + 8}
        className="block"
      >
        {left.nodes.map((node) => {
          const h = node.minor * scale;
          const d = band(xLeft + BAR, yLeft + node.y + (node.h - h) / 2, xMid, inAt, h);
          inAt += h;
          return (
            <path key={node.label} d={d} className={bandClass("vendor", node.label)} onClick={canPick(node.label) ? () => toggle("vendor", node.label) : undefined}>
              <title>{`${node.label}: ${formatMoney(node.minor, currency)}`}</title>
            </path>
          );
        })}
        {right.nodes.map((node) => {
          const h = node.minor * scale;
          const d = band(xMid + BAR, outAt, xRight, yRight + node.y + (node.h - h) / 2, h);
          outAt += h;
          return (
            <path key={node.label} d={d} className={bandClass("type", node.label)} onClick={canPick(node.label) ? () => toggle("type", node.label) : undefined}>
              <title>{`${node.label}: ${formatMoney(node.minor, currency)}`}</title>
            </path>
          );
        })}

        {left.nodes.map((node) => (
          <g key={node.label} {...button("vendor", node)}>
            <rect x={2} y={yLeft + node.top + 1} width={xLeft + BAR - 2} height={node.slot - 2} rx={4} strokeWidth={2} className={hit} />
            <rect x={xLeft} y={yLeft + node.y} width={BAR} height={node.h} rx={2} className="fill-mint-ink" />
            <text x={xLeft - 12} y={yLeft + node.y + node.h / 2 - 3} textAnchor="end" className="fill-ink text-13 font-medium">
              {clip(node.label, chars)}
            </text>
            <text x={xLeft - 12} y={yLeft + node.y + node.h / 2 + 13} textAnchor="end" className="figure fill-dim text-12">
              {formatMoney(node.minor, currency)}
            </text>
          </g>
        ))}

        <rect x={xMid} y={yMid} width={BAR} height={FLOW} rx={2} className="fill-mint-ink" />
        {/* The halo keeps the label readable where a band passes behind it. */}
        <text x={width / 2} y={yMid - 28} textAnchor="middle" paintOrder="stroke" strokeWidth={4} className="fill-dim stroke-paper text-12">
          Recovered
        </text>
        <text x={width / 2} y={yMid - 10} textAnchor="middle" paintOrder="stroke" strokeWidth={4} className="figure fill-ink stroke-paper text-14 font-semibold">
          {formatMoney(total, currency)}
        </text>

        {right.nodes.map((node) => (
          <g key={node.label} {...button("type", node)}>
            <rect x={xRight} y={yRight + node.top + 1} width={width - xRight - 2} height={node.slot - 2} rx={4} strokeWidth={2} className={hit} />
            <rect x={xRight} y={yRight + node.y} width={BAR} height={node.h} rx={2} className="fill-mint-ink" />
            <text x={xRight + BAR + 12} y={yRight + node.y + node.h / 2 - 3} className="fill-ink text-13 font-medium">
              {clip(node.label, chars)}
            </text>
            <text x={xRight + BAR + 12} y={yRight + node.y + node.h / 2 + 13} className="figure fill-dim text-12">
              {formatMoney(node.minor, currency)}
            </text>
          </g>
        ))}
      </svg>

      <div className="sr-only">
        <p>By vendor</p>
        <ul>
          {vendors.map((v) => (
            <li key={v.label}>
              {v.label}: {formatMoney(v.minor, currency)}, {plural(v.count, "claim")}
            </li>
          ))}
        </ul>
        <p>By claim type</p>
        <ul>
          {types.map((t) => (
            <li key={t.label}>
              {t.label}: {formatMoney(t.minor, currency)}, {plural(t.count, "claim")}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
