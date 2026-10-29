import { useState, type CSSProperties, type ReactNode } from "react";
import { COLORS, FONTS } from "../theme";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, { base: CSSProperties; hover: CSSProperties }> = {
  primary: {
    base: { background: COLORS.accent, color: COLORS.ink, borderColor: COLORS.accent },
    hover: { background: "#6AAACB", borderColor: "#6AAACB" },
  },
  secondary: {
    base: { background: COLORS.surface, color: COLORS.ink, borderColor: COLORS.borderStrong },
    hover: { background: COLORS.sunken },
  },
  ghost: {
    base: { background: "transparent", color: COLORS.inkSoft, borderColor: "transparent" },
    hover: { background: COLORS.muted },
  },
  danger: {
    base: { background: COLORS.surface, color: "#8C3B2E", borderColor: COLORS.borderStrong },
    hover: { background: "#FBEFEC" },
  },
};

interface Props {
  children: ReactNode;
  onClick?: () => void;
  variant?: Variant;
  disabled?: boolean;
  isBusy?: boolean;
  title?: string;
  type?: "button" | "submit";
  size?: "sm" | "md";
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
}: Props) {
  const [isHover, setIsHover] = useState(false);
  const { base, hover } = VARIANTS[variant];
  const isDisabled = disabled || isBusy;
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={isDisabled}
      aria-busy={isBusy}
      onMouseEnter={() => setIsHover(true)}
      onMouseLeave={() => setIsHover(false)}
      style={{
        fontFamily: FONTS.mono,
        fontSize: size === "sm" ? 12 : 13,
        padding: size === "sm" ? "6px 10px" : "9px 14px",
        borderRadius: 8,
        cursor: isDisabled ? "not-allowed" : "pointer",
        opacity: isDisabled ? 0.55 : 1,
        transition: "background 120ms ease, border-color 120ms ease",
        whiteSpace: "nowrap",
        borderWidth: 1,
        borderStyle: "solid",
        ...base,
        ...(isHover && !isDisabled ? hover : {}),
      }}
    >
      {isBusy ? "Working…" : children}
    </button>
  );
}
