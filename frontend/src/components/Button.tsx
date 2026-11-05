import type { ReactNode, Ref } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "ink" | "ink-ghost";

// Only the primary variant uses mint; there is one per screen. "ink" variants sit on dark panels.
const VARIANTS: Record<Variant, string> = {
  primary: "bg-mint text-ink shadow-[inset_0_0_0_1px_rgba(10,11,10,0.10)] hover:bg-mint-press",
  secondary: "bg-paper text-ink border border-line hover:border-line-strong hover:bg-wash",
  ghost: "text-dim hover:bg-wash hover:text-ink",
  ink: "bg-panel-2 text-white border border-rule hover:border-sub/60",
  "ink-ghost": "text-sub hover:bg-panel-2 hover:text-white",
};

const SIZES = {
  sm: "h-8 px-3 text-13",
  md: "h-10 px-4 text-14",
  lg: "h-12 px-5 text-16",
};

interface Props {
  children: ReactNode;
  onClick?: () => void;
  variant?: Variant;
  disabled?: boolean;
  isBusy?: boolean;
  busyLabel?: string;
  title?: string;
  type?: "button" | "submit";
  size?: keyof typeof SIZES;
  className?: string;
  buttonRef?: Ref<HTMLButtonElement>;
  "aria-label"?: string;
}

export function Button({
  children,
  onClick,
  variant = "secondary",
  disabled = false,
  isBusy = false,
  busyLabel = "Working…",
  title,
  type = "button",
  size = "md",
  className,
  buttonRef,
  ...rest
}: Props) {
  const isDisabled = disabled || isBusy;
  return (
    <button
      ref={buttonRef}
      type={type}
      title={title}
      onClick={onClick}
      disabled={isDisabled}
      aria-busy={isBusy}
      aria-label={rest["aria-label"]}
      className={cn(
        "inline-flex min-w-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-sm font-medium",
        // Press feedback starts on pointer-down (:active), and only moves transform.
        "transition-[transform,background-color,border-color,color] duration-150 ease-out active:scale-[0.98]",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
    >
      {isBusy ? busyLabel : children}
    </button>
  );
}
