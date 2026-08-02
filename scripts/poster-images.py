#!/usr/bin/env python3
"""Raster treatment for the El Nino Listening Party poster.

Reads source photos from previews/poster/src/, writes treated PNG layers to
previews/poster/layers/. Anything missing is stood in with a clearly-marked
placeholder so the layout can still be judged.

    python3 scripts/poster-images.py

Sources it looks for (drop them in previews/poster/src/):
    woodland.jpg   the light-shaft forest photo   -> hero field
    mushroom.jpg   the top-down mushroom photo    -> macro subject
    face1..5.jpg   the five headshots, in poster order
    stripes.png    the climate warming-stripes bar
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "previews" / "poster" / "src"
OUT = ROOT / "previews" / "poster" / "layers"

# Palette. Beige and the greys are derived - see the spec.
GROUND = (0x0B, 0x35, 0x36)
SMOKE = (0x6E, 0x75, 0x73)
BLUE_GY = (0x8C, 0xA6, 0xB4)
BEIGE = (0xE8, 0xE0, 0xCF)
MINT = (0x98, 0xE2, 0xC3)

# Luminance stops for the duotone ramp, dark -> light.
RAMP = [GROUND, SMOKE, BLUE_GY, BEIGE]

# Above this luminance a pixel is treated as the sun shaft and goes mint.
# Mint is reserved for exactly this, so the shaft is the brightest thing
# on the poster. Only applied where use_mint=True.
SHAFT_CUT = 0.93


def build_lut(stops, levels=6):
    """Posterised colour LUT indexed by 0-255 luminance.

    `levels` is what makes this read as data rather than a photo filter: the
    ramp is quantised into flat bands instead of a smooth gradient.
    """
    lut = np.zeros((256, 3), np.uint8)
    n = len(stops) - 1
    for i in range(256):
        # quantise first, then interpolate, so we land on flat steps
        q = round(i / 255 * (levels - 1)) / (levels - 1)
        pos = q * n
        lo = min(int(pos), n - 1)
        t = pos - lo
        lut[i] = [round(stops[lo][c] + (stops[lo + 1][c] - stops[lo][c]) * t) for c in range(3)]
    return lut


LUT = build_lut(RAMP)


def luminance(arr):
    return arr[..., :3].astype(np.float32) @ np.array([0.2126, 0.7152, 0.0722], np.float32)


def duotone(img, use_mint=True):
    """Map a photo onto the poster palette by luminance."""
    arr = np.asarray(img.convert("RGB"), np.uint8)
    lum = luminance(arr)
    # normalise so every photo uses the full ramp regardless of exposure
    lo, hi = np.percentile(lum, 1), np.percentile(lum, 99)
    norm = np.clip((lum - lo) / max(hi - lo, 1e-6), 0, 1)
    out = LUT[(norm * 255).astype(np.uint8)]
    if use_mint:
        out[norm > SHAFT_CUT] = MINT
    return Image.fromarray(out, "RGB")


def pixelate(img, block):
    """Hard nearest-neighbour blocks. No smoothing anywhere."""
    if block <= 1:
        return img.copy()
    w, h = img.size
    small = img.resize((max(w // block, 1), max(h // block, 1)), Image.BOX)
    return small.resize((w, h), Image.NEAREST)


def bayer(shape, block):
    """8x8 ordered dither threshold field, scaled to the block grid.

    Used at dissolve boundaries so the edge breaks up into pixels rather
    than fading smoothly - a gradient would read as blur, which is the one
    thing the brief rules out.
    """
    m = np.array([
        [0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26],
        [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
        [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25],
        [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21],
    ], np.float32) / 64.0
    h, w = shape
    cells = np.kron(m, np.ones((max(block, 1), max(block, 1)), np.float32))
    reps = (h // cells.shape[0] + 1, w // cells.shape[1] + 1)
    return np.tile(cells, reps)[:h, :w]


def block_ramp(img, mask, blocks=(3, 6, 10, 16, 24)):
    """Variable pixelation: mask 0 = sharpest block, 1 = coarsest.

    Built by compositing a handful of fully-pixelated copies rather than
    per-block resampling - same look, a fraction of the code.
    """
    w, h = img.size
    mask = np.clip(mask, 0, 1)
    out = np.asarray(pixelate(img, blocks[0]), np.uint8).copy()
    n = len(blocks)
    for i, b in enumerate(blocks[1:], start=1):
        layer = np.asarray(pixelate(img, b), np.uint8)
        # dithered threshold so each step change is a pixel edge, not a seam
        thresh = i / n + (bayer((h, w), b) - 0.5) * (0.8 / n)
        out = np.where((mask > thresh)[..., None], layer, out)
    return Image.fromarray(out, "RGB")


def radial(w, h, cx, cy, r_in, r_out):
    """0 inside r_in, ramping to 1 at r_out. Normalised to the short edge."""
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    s = min(w, h)
    d = np.sqrt(((xs - cx * w) / s) ** 2 + ((ys - cy * h) / s) ** 2)
    return np.clip((d - r_in) / max(r_out - r_in, 1e-6), 0, 1)


def cover(img, w, h):
    """Crop to fill w*h without distortion."""
    sw, sh = img.size
    scale = max(w / sw, h / sh)
    img = img.resize((round(sw * scale), round(sh * scale)), Image.LANCZOS)
    sw, sh = img.size
    return img.crop(((sw - w) // 2, (sh - h) // 2, (sw - w) // 2 + w, (sh - h) // 2 + h))


def placeholder(w, h, label):
    """Obvious stand-in. Must never be mistaken for a finished layer."""
    img = Image.new("RGB", (w, h), SMOKE)
    d = ImageDraw.Draw(img)
    for i in range(0, w + h, 24):  # diagonal hatch = "not real artwork"
        d.line([(i, 0), (0, i)], fill=BLUE_GY, width=2)
    d.rectangle([0, 0, w - 1, h - 1], outline=BEIGE, width=2)
    d.text((14, h // 2 - 6), f"PLACEHOLDER / {label}", fill=BEIGE)
    return img


def load(name, w, h, label):
    """Load a source photo, or a placeholder if it hasn't been supplied yet."""
    for ext in (".jpg", ".jpeg", ".png", ".webp", ".JPG", ".JPEG", ".PNG"):
        p = SRC / f"{name}{ext}"
        if p.exists():
            return cover(Image.open(p).convert("RGB"), w, h), True
    return placeholder(w, h, label), False


# --------------------------------------------------------------------------
# layers
# --------------------------------------------------------------------------

HERO_W, HERO_H = 1080, 470
FACE = 172


def make_hero(report):
    wood, real = load("woodland", HERO_W, HERO_H, "WOODLAND")
    report.append(("woodland.jpg", real))
    hero = duotone(wood, use_mint=real)  # no fake mint shaft on a placeholder

    # coarser toward the frame edges, sharpest through the middle band
    ys, xs = np.mgrid[0:HERO_H, 0:HERO_W].astype(np.float32)
    edge = np.maximum(
        np.abs(xs / HERO_W - 0.5) * 2,
        np.abs(ys / HERO_H - 0.5) * 2,
    )
    hero = block_ramp(hero, np.clip((edge - 0.35) / 0.6, 0, 1))

    mush, real_m = load("mushroom", 430, 430, "MUSHROOM")
    report.append(("mushroom.jpg", real_m))
    mush = duotone(mush, use_mint=False)
    mask = radial(430, 430, 0.5, 0.5, 0.16, 0.46)
    mush = block_ramp(mush, mask, blocks=(3, 5, 9, 14, 22))

    # dissolve to transparent in blocks instead of a soft alpha edge
    alpha = 1.0 - np.clip((mask - 0.45) / 0.5, 0, 1)
    alpha = (alpha > bayer((430, 430), 6) * 0.95).astype(np.uint8) * 255
    mush = mush.convert("RGBA")
    mush.putalpha(Image.fromarray(alpha, "L"))

    hero = hero.convert("RGBA")
    hero.alpha_composite(mush, (596, 34))
    hero.save(OUT / "hero.png")


def make_faces(report):
    for i in range(1, 6):
        img, real = load(f"face{i}", FACE, FACE, f"FACE {i}")
        report.append((f"face{i}.jpg", real))
        img = duotone(img, use_mint=False)
        # gentle: faces stay readable, the effect lives in the surround
        mask = radial(FACE, FACE, 0.5, 0.42, 0.20, 0.52)
        img = block_ramp(img, mask, blocks=(2, 4, 7, 11, 16))

        alpha = 1.0 - np.clip((mask - 0.55) / 0.45, 0, 1)
        alpha = (alpha > bayer((FACE, FACE), 4) * 0.95).astype(np.uint8) * 255
        img = img.convert("RGBA")
        img.putalpha(Image.fromarray(alpha, "L"))
        img.save(OUT / f"face{i}.png")


def make_mark():
    """Lift the triangle off its glow background and recolour it mint.

    A plain colour key also catches the cyan glow bleeding off the artwork, so
    take the largest connected blob of saturated cyan instead - that is the
    triangle and nothing else. The internal wave lines are kept as darker
    strokes rather than flattened away.
    """
    import cv2

    src = ROOT / "public" / "deltalogo.png"
    if not src.exists():
        return
    img = Image.open(src).convert("RGB")
    hsv = np.asarray(img.convert("HSV"), np.float32)
    S, V = hsv[..., 1], hsv[..., 2]

    solid = ((S > 200) & (V > 200)).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(solid, 8)
    if n < 2:
        return
    biggest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    mask = (labels == biggest).astype(np.uint8)
    # close the gaps the wave strokes cut into the silhouette
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(mask, contours, -1, 1, cv2.FILLED)

    out = np.zeros(mask.shape + (4,), np.uint8)
    out[..., :3] = MINT
    # wave lines sit a little darker than the flat fill inside the triangle
    lines = (mask == 1) & (V < 236)
    out[lines, :3] = GROUND
    out[..., 3] = mask * 255
    mark = Image.fromarray(out, "RGBA")
    mark.crop(mark.getbbox()).save(OUT / "mark-mint.png")


def make_venue():
    """Knock the venue's black badge out, keep the white script.

    Their logo is white lettering on a black hexagon. Dropped straight onto the
    teal ground the black block would read as a hole, so use luminance as alpha
    and keep only the script and its outline.
    """
    p = OUT / "venue-logo.png"
    if not p.exists():
        return
    arr = np.asarray(Image.open(p).convert("RGBA"), np.float32)
    lum = luminance(arr) / 255.0
    keep = np.clip((lum - 0.45) / 0.35, 0, 1) * (arr[..., 3] / 255.0)
    out = np.zeros(arr.shape, np.uint8)
    out[..., :3] = BEIGE
    out[..., 3] = (keep * 255).astype(np.uint8)
    img = Image.fromarray(out, "RGBA")
    box = img.getbbox()
    if box:
        img = img.crop(box)
    img.save(OUT / "venue-mark.png")


def make_stripes(report):
    """Use the supplied stripes bar. Never recolour it - it is data."""
    for ext in (".png", ".jpg", ".jpeg", ".webp"):
        p = SRC / f"stripes{ext}"
        if p.exists():
            img = Image.open(p).convert("RGB")
            w, h = img.size
            img.resize((1080, round(h * 1080 / w)), Image.LANCZOS).save(OUT / "stripes.png")
            report.append(("stripes.png", True))
            return
    report.append(("stripes.png", False))
    img = placeholder(1080, 60, "CLIMATE STRIPES - SUPPLY THE REAL BAR")
    img.save(OUT / "stripes.png")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    report = []
    make_hero(report)
    make_faces(report)
    make_stripes(report)
    make_mark()
    make_venue()

    missing = [n for n, ok in report if not ok]
    print(f"layers -> {OUT}")
    for name, ok in report:
        print(f"  {'ok  ' if ok else 'MISS'}  {name}")
    if missing:
        print(f"\n{len(missing)} source(s) missing, placeholders used.")
        print(f"Drop the real files in {SRC} and re-run.")
    return 0


def demo():
    """Self-check: the treatment must posterise, block up, and stay in palette."""
    photo = Image.fromarray(
        (np.mgrid[0:64, 0:64][1] * 4).astype(np.uint8)[..., None].repeat(3, 2), "RGB"
    )
    d = np.asarray(duotone(photo, use_mint=False))
    palette = {GROUND, SMOKE, BLUE_GY, BEIGE}
    uniq = {tuple(int(v) for v in c) for c in d.reshape(-1, 3)}
    assert len(uniq) <= 6, f"duotone should posterise, got {len(uniq)} colours"
    assert min(uniq, key=sum) == GROUND, "darkest stop must be the ground teal"

    p = np.asarray(pixelate(photo, 8))
    assert (p[0, 0] == p[0, 7]).all(), "8px block should be flat across its width"
    assert not (p[0, 0] == p[0, 8]).all(), "adjacent blocks should differ"

    flat = Image.new("RGB", (64, 64), (200, 200, 200))
    m = radial(64, 64, 0.5, 0.5, 0.1, 0.5)
    assert m[32, 32] == 0 and m[0, 0] > 0.9, "radial mask ramps centre -> corner"
    assert np.asarray(block_ramp(flat, m)).std() == 0, "flat input must stay flat"

    b = bayer((16, 16), 1)
    assert 0 <= b.min() and b.max() < 1 and b.std() > 0, "dither field must vary in [0,1)"
    print("demo ok")


if __name__ == "__main__":
    sys.exit(demo() if "--demo" in sys.argv else main())
