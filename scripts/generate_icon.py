#!/usr/bin/env python3
"""Generate DER-45 A-variant icon: navy rounded tile + 青雲 + waves + half-sunk ship + 5386."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent

# Prefer a serif-like CJK face when available; fall back to system CJK.
CJK_CANDIDATES = [
    "/usr/share/fonts/truetype/noto/NotoSerifCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc",
    "/usr/share/fonts/truetype/noto/NotoSerifTC-Bold.otf",
    "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
]
NUM_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
]


def pick_font(paths: list[str], size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in paths:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def rounded_rect_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def draw_waves(draw: ImageDraw.ImageDraw, size: int) -> None:
    """Two white wave layers near the bottom."""
    y0 = int(size * 0.62)
    amp = int(size * 0.035)
    step = max(2, size // 90)

    def wave_poly(y_base: int, phase: float, amp_mul: float) -> list[tuple[int, int]]:
        pts: list[tuple[int, int]] = []
        for x in range(0, size + step, step):
            # simple sine-ish via triangles of circles approximation
            import math

            y = y_base + int(amp * amp_mul * math.sin(x / size * math.pi * 2 + phase))
            pts.append((x, y))
        pts.append((size, size))
        pts.append((0, size))
        return pts

    draw.polygon(wave_poly(y0, 0.0, 1.0), fill=(255, 255, 255, 210))
    draw.polygon(wave_poly(y0 + int(size * 0.05), 1.2, 0.85), fill=(230, 240, 250, 230))


def draw_ship(draw: ImageDraw.ImageDraw, size: int) -> None:
    """Half-sunk small ship, rotated about −12°, fill #0e2438."""
    import math

    cx, cy = int(size * 0.52), int(size * 0.72)
    angle = math.radians(-12)
    cos_a, sin_a = math.cos(angle), math.sin(angle)

    def rot(px: float, py: float) -> tuple[int, int]:
        x = px * cos_a - py * sin_a
        y = px * sin_a + py * cos_a
        return int(cx + x), int(cy + y)

    s = size * 0.11
    hull = [
        rot(-1.6 * s, 0.35 * s),
        rot(1.7 * s, 0.55 * s),
        rot(1.2 * s, 1.05 * s),
        rot(-1.1 * s, 0.85 * s),
    ]
    cabin = [
        rot(-0.55 * s, -0.35 * s),
        rot(0.55 * s, -0.15 * s),
        rot(0.45 * s, 0.35 * s),
        rot(-0.65 * s, 0.25 * s),
    ]
    draw.polygon(hull, fill=(14, 36, 56))
    draw.polygon(cabin, fill=(14, 36, 56))
    # tiny mast
    draw.line([rot(0.7 * s, -0.9 * s), rot(0.7 * s, 0.2 * s)], fill=(14, 36, 56), width=max(2, size // 90))


def draw_icon(size: int) -> Image.Image:
    bg = Image.new("RGBA", (size, size), (27, 58, 92, 255))  # #1b3a5c
    draw = ImageDraw.Draw(bg)

    # 青雲 hero (white serif)
    title = "青雲"
    title_font = pick_font(CJK_CANDIDATES, int(size * 0.34))
    bbox = draw.textbbox((0, 0), title, font=title_font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = (size - tw) // 2
    ty = int(size * 0.14) - bbox[1]
    draw.text((tx, ty), title, font=title_font, fill=(255, 255, 255, 255))

    draw_waves(draw, size)
    draw_ship(draw, size)

    # 5386 under waves
    code = "5386"
    code_font = pick_font(NUM_CANDIDATES, int(size * 0.12))
    cb = draw.textbbox((0, 0), code, font=code_font)
    cw, ch = cb[2] - cb[0], cb[3] - cb[1]
    cx = (size - cw) // 2
    cy = int(size * 0.86) - cb[1]
    draw.text((cx, cy), code, font=code_font, fill=(255, 255, 255, 255))

    # iOS-style rounded corners for touch icons
    radius = int(size * 0.22)
    mask = rounded_rect_mask(size, radius)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(bg, (0, 0), mask)
    return out


def main() -> None:
    master = draw_icon(1024)
    outputs = {
        ROOT / "apple-touch-icon.png": 180,
        ROOT / "apple-touch-icon-precomposed.png": 180,
        ROOT / "favicon.png": 32,
    }
    for path, out_size in outputs.items():
        resized = master.resize((out_size, out_size), Image.Resampling.LANCZOS)
        # favicon: opaque RGB for broader browser support
        if out_size == 32:
            resized = resized.convert("RGBA")
            flat = Image.new("RGBA", resized.size, (27, 58, 92, 255))
            flat.alpha_composite(resized)
            flat.convert("RGB").save(path, optimize=True)
        else:
            resized.save(path, optimize=True)
        print(f"Wrote {path} ({out_size}x{out_size})")


if __name__ == "__main__":
    main()
