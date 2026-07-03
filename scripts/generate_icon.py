#!/usr/bin/env python3
"""Generate iOS home screen icon: dark blue sky, 青雲 hero, 5386 in cloud."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
CJK_FONT = "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf"
NUM_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def draw_cloud(draw: ImageDraw.ImageDraw, cx: int, cy: int, scale: float, color=(245, 248, 252)) -> None:
    s = scale
    blobs = [
        (cx - 1.1 * s, cy, 1.3 * s),
        (cx - 0.2 * s, cy - 0.35 * s, 1.0 * s),
        (cx + 0.8 * s, cy - 0.15 * s, 1.15 * s),
        (cx + 1.7 * s, cy + 0.05 * s, 0.95 * s),
        (cx + 0.4 * s, cy + 0.25 * s, 1.25 * s),
    ]
    for x, y, r in blobs:
        draw.ellipse((x - r, y - r, x + r, y + r), fill=color)


def draw_icon(size: int) -> Image.Image:
    img = Image.new("RGB", (size, size))
    draw = ImageDraw.Draw(img)

    # dark blue gradient background
    for y in range(size):
        t = y / max(size - 1, 1)
        r = int(8 + (22 - 8) * t)
        g = int(38 + (72 - 38) * t)
        b = int(82 + (128 - 82) * t)
        draw.line([(0, y), (size, y)], fill=(r, g, b))

    # subtle stars / depth
    for sx, sy, sr in [(0.18, 0.16, 2), (0.78, 0.12, 2), (0.62, 0.24, 1), (0.32, 0.28, 1)]:
        x, y = int(size * sx), int(size * sy)
        draw.ellipse((x - sr, y - sr, x + sr, y + sr), fill=(180, 210, 235))

    title = "青雲"
    title_size = int(size * 0.36)
    try:
        title_font = ImageFont.truetype(CJK_FONT, title_size)
    except OSError:
        title_font = ImageFont.load_default()

    bbox = draw.textbbox((0, 0), title, font=title_font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = (size - tw) // 2
    ty = int(size * 0.18)

    glow = max(2, size // 120)
    for dx in range(-glow, glow + 1):
        for dy in range(-glow, glow + 1):
            draw.text((tx + dx, ty + dy), title, font=title_font, fill=(6, 28, 58))
    draw.text((tx, ty), title, font=title_font, fill=(255, 255, 255))

    # main cloud band at bottom
    cloud_cy = int(size * 0.78)
    cloud_scale = size * 0.17
    draw_cloud(draw, int(size * 0.50), cloud_cy, cloud_scale)

    # 5386 inside cloud (two sizes smaller than previous hero number)
    code = "5386"
    code_size = int(size * 0.11)
    try:
        code_font = ImageFont.truetype(NUM_FONT, code_size)
    except OSError:
        code_font = ImageFont.load_default()

    cbbox = draw.textbbox((0, 0), code, font=code_font)
    cw = cbbox[2] - cbbox[0]
    ch = cbbox[3] - cbbox[1]
    cx = (size - cw) // 2
    cy = cloud_cy - ch // 2 + int(size * 0.01)
    draw.text((cx, cy), code, font=code_font, fill=(38, 86, 128))

    return img


def main() -> None:
    master = draw_icon(1024)
    outputs = {
        ROOT / "apple-touch-icon.png": 180,
        ROOT / "apple-touch-icon-precomposed.png": 180,
        ROOT / "favicon.png": 32,
    }
    for path, out_size in outputs.items():
        master.resize((out_size, out_size), Image.Resampling.LANCZOS).save(path, optimize=True)
        print(f"Wrote {path} ({out_size}x{out_size})")


if __name__ == "__main__":
    main()
