"""Recolour the brand PNGs for the ink sidebar from the pine sources in public/brand.

    python3 frontend/scripts/recolor-brand.py

Writes:
  recoup-wordmark-ink.png  white "ecoup" with the mint arrow-R, transparent, for dark surfaces
  recoup-mark-{32,180,512}-ink.png  mint arrow-R on an ink tile, for the favicon and touch icon
Only the alpha channel of the sources is used, so anti-aliased edges stay clean.
"""

from pathlib import Path

from PIL import Image, ImageDraw

BRAND = Path(__file__).resolve().parent.parent / "public" / "brand"
MINT = (0x9B, 0xF0, 0xC8)
WHITE = (0xFF, 0xFF, 0xFF)
INK = (0x0E, 0x10, 0x0F)


def first_gap(alpha: Image.Image) -> int:
    """The first fully transparent column after the R: where 'ecoup' starts."""
    w, h = alpha.size
    px = alpha.load()
    seen_ink = False
    for x in range(w):
        has = any(px[x, y] > 8 for y in range(h))
        if has:
            seen_ink = True
        elif seen_ink:
            return x
    raise SystemExit("no gap between the R and the rest of the wordmark")


def wordmark() -> None:
    src = Image.open(BRAND / "recoup-wordmark.png").convert("RGBA")
    alpha = src.getchannel("A")
    split = first_gap(alpha)
    out = Image.new("RGBA", src.size)
    r_part = Image.new("RGBA", src.size, MINT + (0,))
    rest = Image.new("RGBA", src.size, WHITE + (0,))
    mask_r = Image.new("L", src.size, 0)
    mask_r.paste(alpha.crop((0, 0, split, src.height)), (0, 0))
    mask_rest = Image.new("L", src.size, 0)
    mask_rest.paste(alpha.crop((split, 0, src.width, src.height)), (split, 0))
    r_part.putalpha(mask_r)
    rest.putalpha(mask_rest)
    out = Image.alpha_composite(out, r_part)
    out = Image.alpha_composite(out, rest)
    out.save(BRAND / "recoup-wordmark-ink.png", optimize=True)


def mark() -> None:
    src = Image.open(BRAND / "recoup-mark-512.png").convert("RGBA")
    glyph = Image.new("RGBA", src.size, MINT + (0,))
    glyph.putalpha(src.getchannel("A"))
    size = 512
    tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(tile).rounded_rectangle((0, 0, size - 1, size - 1), radius=72, fill=INK + (255,))
    inner = glyph.resize((372, 372), Image.LANCZOS)
    tile.alpha_composite(inner, ((size - 372) // 2, (size - 372) // 2 + 4))
    for px in (32, 180, 512):
        tile.resize((px, px), Image.LANCZOS).save(BRAND / f"recoup-mark-{px}-ink.png", optimize=True)


if __name__ == "__main__":
    wordmark()
    mark()
