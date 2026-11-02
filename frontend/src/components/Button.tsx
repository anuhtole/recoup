import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost";

// Only the primary variant uses the accent; there is one per screen.
const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover",
  secondary: "bg-tint text-ink hover:bg-tint-hover",
  ghost: "text-dim hover:bg-tint hover:text-ink",
};

const SIZES = {
  sm: "h-9 px-3 text-14",
  md: "h-11 px-4 text-14 sm:h-10",
};

interface Props {
  children: ReactNode;
  onClick?: () => void;
  variant?: Variant;
  disabled?: boolean;
  isBusy?: boolean;
  title?: string;
  type?: "button" | "submit";
  size?: keyof typeof SIZES;
  className?: string;
}

export function Button({
  children,
  onClick,
  variant = "secondary",
  disabled = false,
  isBusy = false,
  title,
  type = "button",
  size = "md",
  className,
}: Props) {
  const isDisabled = disabled || isBusy;
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={isDisabled}
      aria-busy={isBusy}
      className={cn(
        "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium",
        // Press feedback starts on pointer-down (:active), and only moves transform.
        "transition-[transform,background-color,color,filter] duration-150 ease-out active:scale-[0.97]",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
    >
      {isBusy ? "Working…" : children}
    </button>
  );
}
