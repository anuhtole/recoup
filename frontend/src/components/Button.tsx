import type { ReactNode, Ref } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "ink" | "ink-ghost";

// Primary is solid ink, one per screen. On an ink surface (.on-ink) it inverts to paper so it still reads
// as the one action. Mint is never a button colour; it is reserved for money and the slide-to-send.
// "ink" and "ink-ghost" are the quiet buttons for dark panels.
const VARIANTS: Record<Variant, string> = {
  primary: "bg-ink text-white hover:bg-panel-2 in-[.on-ink]:bg-paper in-[.on-ink]:text-ink in-[.on-ink]:hover:bg-wash",
  secondary: "bg-paper text-ink border border-line hover:border-line-strong hover:bg-wash",
  ghost: "text-dim hover:bg-wash hover:text-ink",
  ink: "bg-panel-2 text-white border border-rule hover:border-sub/60",
  "ink-ghost": "text-sub hover:bg-panel-2 hover:text-white",
};

// 36px is the default; 40px is the page's main call to action.
const SIZES = {
  sm: "h-8 px-3 text-13",
  md: "h-9 px-3.5 text-14",
  lg: "h-10 px-4 text-14",
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
