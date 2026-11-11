import { localLogo, logoStyle, vendorIcon, vendorInitial, vendorTint } from "@/lib/vendors";
import { cn } from "@/lib/utils";

interface Props {
  name: string;
  /** 28 by default; 20 in dense lists; 40 in the case header. */
  size?: 20 | 28 | 40;
  className?: string;
}

const TILE = "grid flex-none place-items-center overflow-hidden rounded-sm";

/**
 * The vendor's brand mark on a tile with a hairline: a local mark first (vendors simple-icons doesn't
 * carry), then simple-icons in the brand's colour, padded per mark (a full-bleed badge, a white wordmark
 * on its brand colour). Only one-off merchants get their initial on one of six soft tints.
 */
export function VendorLogo({ name, size = 28, className }: Props) {
  const box = { width: size, height: size };
  const local = localLogo(name);
  if (local) {
    return (
      <span aria-hidden className={cn(TILE, "border border-line bg-paper", className)} style={box}>
        <img
          src={local.src}
          alt=""
          draggable={false}
          className="block"
          style={local.bleed ? { width: "100%", height: "100%" } : { width: Math.round(size * 0.6), height: Math.round(size * 0.6) }}
        />
      </span>
    );
  }
  const icon = vendorIcon(name);
  if (icon) {
    const { scale, onBrand } = logoStyle(icon);
    const mark = Math.round(size * scale);
    return (
      <span
        aria-hidden
        className={cn(TILE, onBrand ? "border border-transparent" : "border border-line bg-paper", className)}
        style={onBrand ? { ...box, background: `#${icon.hex}` } : box}
      >
        <svg viewBox="0 0 24 24" style={{ width: mark, height: mark }}>
          <path d={icon.path} fill={onBrand ? "var(--paper)" : `#${icon.hex}`} />
        </svg>
      </span>
    );
  }
  const tint = vendorTint(name);
  return (
    <span
      aria-hidden
      className={cn(TILE, "font-semibold leading-none", className)}
      style={{ ...box, background: `var(--tint-${tint})`, color: `var(--tint-${tint}-ink)`, fontSize: Math.round(size * 0.46) }}
    >
      {vendorInitial(name)}
    </span>
  );
}
