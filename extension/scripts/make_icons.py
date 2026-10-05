#!/usr/bin/env python3
"""Generates extension icons (no external assets required)."""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / "public" / "icons"
BG = (15, 15, 15, 255)
RED = (229, 72, 77, 255)
WHITE = (255, 255, 255, 255)


def draw_icon(size: int) -> Image.Image:
    scale = 8
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = int(s * 0.22)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=BG)
    # play triangle
    tri = [(s * 0.36, s * 0.28), (s * 0.74, s * 0.5), (s * 0.36, s * 0.72)]
    d.polygon(tri, fill=RED)
    # sparkle (four-point star) top-right
    cx, cy, r = s * 0.72, s * 0.26, s * 0.11
    star = [
        (cx, cy - r),
        (cx + r * 0.22, cy - r * 0.22),
        (cx + r, cy),
        (cx + r * 0.22, cy + r * 0.22),
        (cx, cy + r),
        (cx - r * 0.22, cy + r * 0.22),
        (cx - r, cy),
        (cx - r * 0.22, cy - r * 0.22),
    ]
    d.polygon(star, fill=WHITE)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 128):
        draw_icon(size).save(OUT / f"icon{size}.png")
        print(f"wrote {OUT / f'icon{size}.png'}")


if __name__ == "__main__":
    main()
