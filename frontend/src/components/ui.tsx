import type { ReactNode } from "react";
import type { Tone } from "../theme";
import { cn } from "@/lib/utils";
import { TopBarActions } from "./shell/TopBarActions";

const PILL: Record<Tone, string> = {
  mint: "bg-mint-wash text-mint-ink",
  amber: "bg-amber-wash text-amber-ink",
  neutral: "bg-ground text-ink",
  muted: "bg-wash text-dim",
};
const DOT: Record<Tone, string> = {
  mint: "bg-mint-ink",
  amber: "bg-amber",
  neutral: "bg-dim",
  muted: "bg-line-strong",
};

/** A status pill: dot and label on the fixed four-tone scale. */
export function Pill({ label, tone, className }: { label: string; tone: Tone; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 flex-none items-center gap-1.5 whitespace-nowrap rounded-xs px-2 text-12 font-medium", PILL[tone], className)}>
      <span aria-hidden className={cn("size-1.5 rounded-full", DOT[tone])} />
      {label}
    </span>
  );
}

const TAG: Record<Tone, string> = {
  mint: "bg-mint-wash text-mint-ink",
  amber: "bg-amber-wash text-amber-ink",
  neutral: "bg-ground text-dim",
  muted: "bg-wash text-dim",
};

/** A small inline tag with no dot: a case's type, or "Needs review" beside a vendor name. */
export function Tag({ children, tone = "neutral", className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 flex-none items-center whitespace-nowrap rounded-xs px-1.5 text-12 font-medium", TAG[tone], className)}>
      {children}
    </span>
  );
}

/**
 * What is left of the v1 page header: the title lives in the top bar, so this moves a page's actions
 * there and keeps its meta line in place.
 */
export function PageHeader({ actions, meta }: { actions?: ReactNode; meta?: ReactNode }) {
  return (
    <>
      {actions && (
        <TopBarActions>
          <div className="flex items-center gap-2">{actions}</div>
        </TopBarActions>
      )}
      {meta}
    </>
  );
}
