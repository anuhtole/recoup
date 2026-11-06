import { vendorIcon, vendorInitial, vendorTint } from "@/lib/vendors";
import { cn } from "@/lib/utils";

interface Props {
  name: string;
  /** 28 by default; 20 in dense lists; 40 in the case header. */
  size?: 20 | 28 | 40;
  className?: string;
}

/**
 * The vendor's brand mark in its own colour on a white tile with a hairline. Vendors without a mark get
 * their initial on one of six soft tints, picked from the name so it never changes.
 */
export function VendorLogo({ name, size = 28, className }: Props) {
  const icon = vendorIcon(name);
  const box = { width: size, height: size };
  if (icon) {
    return (
      <span
        aria-hidden
        className={cn("grid flex-none place-items-center rounded-sm border border-line bg-paper", className)}
        style={box}
      >
        <svg viewBox="0 0 24 24" style={{ width: Math.round(size * 0.56), height: Math.round(size * 0.56) }}>
          <path d={icon.path} fill={`#${icon.hex}`} />
        </svg>
      </span>
    );
  }
  const tint = vendorTint(name);
  return (
    <span
      aria-hidden
      className={cn("grid flex-none place-items-center rounded-sm font-semibold leading-none", className)}
      style={{ ...box, background: `var(--tint-${tint})`, color: `var(--tint-${tint}-ink)`, fontSize: Math.round(size * 0.46) }}
    >
      {vendorInitial(name)}
    </span>
  );
}
