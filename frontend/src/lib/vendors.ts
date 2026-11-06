import {
  siAtlassian,
  siCalendly,
  siConfluence,
  siDelta,
  siFigma,
  siGithub,
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

/** "Sq *Joes Catering" → "Joes Catering". The vendor's name as people say it. */
export function vendorName(merchant: string): string {
  return merchant.replace(PROCESSOR_PREFIX, "").trim() || merchant;
}

/**
 * Vendor display names → simple-icons (pinned in package.json; every import here is checked by tsc).
 * Slack, WeWork, Amazon, Amazon Web Services, Office Depot and Staples are not in simple-icons (removed or
 * never added at the brand's request), so they get a monogram.
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
};

// Brands whose first word alone is unambiguous: "Lyft Ride", "Uber Trip", "Marriott Union Square".
const FIRST_WORD = new Set(["figma", "loom", "lyft", "uber", "marriott", "zoom", "notion", "github", "calendly"]);

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
  const k = key(merchant);
  if (BY_NAME[k]) return BY_NAME[k];
  const first = k.split(" ")[0];
  return FIRST_WORD.has(first) ? BY_NAME[first] : null;
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
