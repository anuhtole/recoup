import {
  siAtlassian,
  siCalendly,
  siConfluence,
  siDelta,
  siFigma,
  siGithub,
  siGmail,
  siGoogle,
  siJira,
  siLinear,
  siLoom,
  siLyft,
  siMarriott,
  siNotion,
  siUber,
  siUnitedairlines,
  siZoom,
  type SimpleIcon,
} from "simple-icons";

// Card processors put their own prefix on the descriptor: "SQ *JOES CATERING", "TST* ZUNI", "PAYPAL *FOO".
const PROCESSOR_PREFIX = /^(sq|tst|paypal|pp|sp)\s?\*\s*/i;

// Brands whose first word alone names them; the rest of a card descriptor is the product or the place:
// "Lyft Ride" → Lyft, "Uber Trip" → Uber, "Marriott Union Square" → Marriott, "Slack Technologies" → Slack.
const BRAND: Record<string, string> = {
  figma: "Figma",
  loom: "Loom",
  lyft: "Lyft",
  uber: "Uber",
  marriott: "Marriott",
  zoom: "Zoom",
  notion: "Notion",
  github: "GitHub",
  calendly: "Calendly",
  gmail: "Gmail",
  slack: "Slack",
  wework: "WeWork",
};

/**
 * "Sq *Joes Catering" → "Joes Catering", "Uber Trip" → "Uber". The vendor's name as people say it;
 * the raw card descriptor stays in the ledger's Description column.
 */
export function vendorName(merchant: string): string {
  const name = merchant.replace(PROCESSOR_PREFIX, "").trim() || merchant;
  const first = name.split(/[\s.]+/)[0]?.toLowerCase() ?? "";
  return BRAND[first] ?? name;
}

/**
 * Vendor display names → simple-icons (pinned in package.json; every import here is checked by tsc).
 * Slack, WeWork, Amazon, Amazon Web Services, Ramp and Office Depot are not in simple-icons, so they have
 * local marks in public/logos (LOCAL below). Only true one-offs fall back to a monogram.
 */
const BY_NAME: Record<string, SimpleIcon> = {
  figma: siFigma,
  loom: siLoom,
  lyft: siLyft,
  uber: siUber,
  "united airlines": siUnitedairlines,
  united: siUnitedairlines,
  marriott: siMarriott,
  zoom: siZoom,
  notion: siNotion,
  github: siGithub,
  linear: siLinear,
  calendly: siCalendly,
  jira: siJira,
  confluence: siConfluence,
  atlassian: siAtlassian,
  delta: siDelta,
  "delta air lines": siDelta,
  "google workspace": siGoogle,
  gmail: siGmail,
};

/** How a mark sits on its tile. Most get padding on white; some need their own treatment. */
export interface LogoStyle {
  /** Share of the tile the mark fills. */
  scale: number;
  /** Fill the tile with the brand colour and draw the mark in white: wordmarks that are unreadable small. */
  onBrand?: boolean;
}

const STYLE: Record<string, LogoStyle> = {
  // The globe badge is already a filled circle: edge to edge, clipped to the tile's radius.
  [siUnitedairlines.slug]: { scale: 1 },
  // Wordmarks: white on the brand colour, about 70% wide, so they read at 20px.
  [siUber.slug]: { scale: 0.7, onBrand: true },
  [siZoom.slug]: { scale: 0.72, onBrand: true },
};
const DEFAULT_STYLE: LogoStyle = { scale: 0.56 };

export function logoStyle(icon: SimpleIcon): LogoStyle {
  return STYLE[icon.slug] ?? DEFAULT_STYLE;
}

/** Local marks for vendors simple-icons doesn't carry. `bleed`: the file paints its own background. */
export interface LocalLogo {
  src: string;
  bleed: boolean;
}

const LOCAL: Record<string, LocalLogo> = {
  slack: { src: "/logos/slack.svg", bleed: false },
  "amazon web services": { src: "/logos/aws.svg", bleed: true },
  aws: { src: "/logos/aws.svg", bleed: true },
  amazon: { src: "/logos/amazon.svg", bleed: true },
  "amzn mktp": { src: "/logos/amazon.svg", bleed: true },
  amzn: { src: "/logos/amazon.svg", bleed: true },
  wework: { src: "/logos/wework.svg", bleed: true },
  ramp: { src: "/logos/ramp.svg", bleed: true },
  "office depot": { src: "/logos/officedepot.svg", bleed: true },
};

function key(name: string): string {
  return vendorName(name)
    .toLowerCase()
    .replace(/\(.*?\)/g, "") // "Jira (Atlassian)"
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(inc|llc|ltd|co|corp|com|us)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function vendorIcon(merchant: string): SimpleIcon | null {
  // key() already reads "Lyft Ride" as "lyft" (vendorName), so an exact lookup is enough.
  return BY_NAME[key(merchant)] ?? null;
}

/** A local mark (checked before simple-icons), or null. */
export function localLogo(merchant: string): LocalLogo | null {
  return LOCAL[key(merchant)] ?? null;
}

/** 1–6: the same vendor always gets the same monogram tint. */
export function vendorTint(merchant: string): number {
  const k = key(merchant);
  // FNV-1a: spreads short names across the six tints better than a plain multiply-add.
  let hash = 0x811c9dc5;
  for (let i = 0; i < k.length; i += 1) hash = Math.imul(hash ^ k.charCodeAt(i), 0x01000193) >>> 0;
  return (hash % 6) + 1;
}

export function vendorInitial(merchant: string): string {
  return vendorName(merchant).replace(/^[^A-Za-z0-9]+/, "").charAt(0).toUpperCase() || "?";
}
