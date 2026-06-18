# 128×32: 32px cover | 60px scrolling text | 32px animated visualizer. Rotation applied at send-time.

import colorsys
import io
import os
import random
import re
import requests
from math import exp

from PIL import Image, ImageDraw, ImageFont, ImageEnhance, ImageOps

W, H      = 128, 32
COVER_W   = 32
VIZ_W     = 32
GAP       = 2
TEXT_W    = W - COVER_W - VIZ_W - GAP * 2   # 60
TEXT_X    = COVER_W + GAP                    # 34
VIZ_X     = COVER_W + GAP + TEXT_W + GAP     # 96

FONT_H    = 8
ROW_GAP   = 2
TITLE_Y   = 0
ARTIST_Y  = FONT_H + ROW_GAP          # 10
ALBUM_Y   = ARTIST_Y + FONT_H + ROW_GAP  # 20
PROG_Y    = 30                         # progress bar: y=30-31

BG         = (0,   0,   0)
C_TITLE    = (210, 225, 255)
C_ARTIST   = (110, 130, 175)
C_ALBUM    = ( 70,  85, 120)
C_PROG_BG  = ( 25,  25,  25)

C_VIZ_LO  = (  0, 210,  75)
C_VIZ_MID = (255, 160,   0)
C_VIZ_HI  = (255,  30,  30)
VIZ_MID_PX = 10
VIZ_HI_PX  = 22

VIZ_BARS    = 8
VIZ_BAR_W   = 3
VIZ_GAP_W   = 1
VIZ_PADDING = 1
VIZ_MIN_H   = 5

FRAME_MS           = 100   # ms per GIF frame (10 fps)
SCROLL_STATIC_MS   = 5000  # hold still before scrolling
SCROLL_PAUSE_MS    = 1000  # pause at end before looping
SCROLL_STATIC_FRAMES = SCROLL_STATIC_MS  // FRAME_MS   # 62
SCROLL_PAUSE_FRAMES  = SCROLL_PAUSE_MS   // FRAME_MS   # 12
TOTAL_FRAMES         = int(20_000 // FRAME_MS)          # 250 = 20s always

_FONTS_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "assets", "fonts")

FONTS = {
    1: ("PressStart2P",    "PressStart2P.ttf"),
    2: ("HIAIRP22",        "HIAIRP22.ttf"),
    3: ("MinecraftStandard", "MinecraftStandard.otf"),
    4: ("pcsenior",        "pcsenior.ttf"),
}
_FONT_CHOICE = 3

_FONT_PATH  = os.path.join(_FONTS_DIR, FONTS[_FONT_CHOICE][1])
_font_cache: dict = {}


def set_font(n: int) -> None:
    global _FONT_PATH, _FONT_CHOICE
    if n not in FONTS:
        raise ValueError(f"Font must be 1–{len(FONTS)}. Options: {FONTS}")
    _FONT_CHOICE = n
    _FONT_PATH   = os.path.join(_FONTS_DIR, FONTS[n][1])
    _font_cache.clear()
    print(f"[font] {n} — {FONTS[n][0]}")


def _load(target_h: int) -> ImageFont.FreeTypeFont:
    if target_h in _font_cache:
        return _font_cache[target_h]
    probe = ImageDraw.Draw(Image.new("RGB", (400, 100)))
    lo, hi = 1, target_h * 3
    while lo < hi:
        mid = (lo + hi + 1) // 2
        font = ImageFont.truetype(_FONT_PATH, mid)
        bb = probe.textbbox((0, 0), "0", font=font)
        if bb[3] - bb[1] <= target_h:
            lo = mid
        else:
            hi = mid - 1
    _font_cache[target_h] = ImageFont.truetype(_FONT_PATH, lo)
    return _font_cache[target_h]


def _tw(draw: ImageDraw.ImageDraw, text: str, font) -> int:
    bb = draw.textbbox((0, 0), text, font=font)
    return bb[2] - bb[0]


def _put(draw: ImageDraw.ImageDraw, x: int, y: int, text: str, font, color) -> None:
    bb = draw.textbbox((0, 0), text, font=font)
    gw, gh = bb[2] - bb[0], bb[3] - bb[1]
    if gw <= 0 or gh <= 0:
        return
    mask = Image.new("L", (gw, gh), 0)
    ImageDraw.Draw(mask).text((-bb[0], -bb[1]), text, font=font, fill=255, embedded_color=False)
    mask = mask.point(lambda p: 255 if p > 0 else 0)
    colored = Image.new("RGB", (gw, gh), color)
    draw._image.paste(colored, (x, y), mask)


def _perceived_luminance(rgb: tuple) -> float:
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]


def _accent_colors(cover_bytes: bytes) -> tuple[tuple, tuple, tuple]:
    # Extract 3 accent colors from cover, sorted darkest first. Hues are nudged apart if too close.
    MIN_HUE_DIST = 0.13   # ~47° minimum between any two colors

    def _normalize(h, s):
        r, g, b = colorsys.hsv_to_rgb(h, max(s, 0.80), 0.85)
        return (int(r * 255), int(g * 255), int(b * 255))

    def _hue_dist(h1, h2):
        return min(abs(h1 - h2), 1 - abs(h1 - h2))

    def _nudge_apart(hues: list[float]) -> list[float]:
        # Push hues apart until all pairs exceed MIN_HUE_DIST, each moving as little as possible.
        hues = list(hues)
        for _ in range(200):
            changed = False
            for i in range(len(hues)):
                for j in range(len(hues)):
                    if i == j:
                        continue
                    d = _hue_dist(hues[i], hues[j])
                    if d < MIN_HUE_DIST:
                        gap    = (MIN_HUE_DIST - d) / 2 + 0.005
                        diff   = (hues[j] - hues[i]) % 1.0
                        sign   = 1 if diff < 0.5 else -1
                        hues[i] = (hues[i] - sign * gap) % 1.0
                        hues[j] = (hues[j] + sign * gap) % 1.0
                        changed = True
            if not changed:
                break
        return hues

    try:
        img = Image.open(io.BytesIO(cover_bytes)).convert("RGB")
        img = img.resize((16, 16), Image.LANCZOS)

        candidates = []
        for p in img.getdata():
            h, s, v = colorsys.rgb_to_hsv(p[0]/255, p[1]/255, p[2]/255)
            if s >= 0.30 and 0.25 <= v <= 0.95:
                candidates.append((s * v, h, s))

        candidates.sort(reverse=True)

        raw_hues: list[float] = []
        raw_sats: list[float] = []

        for _, h, s in candidates:
            if all(_hue_dist(h, rh) > 0.05 for rh in raw_hues):  # loose first pass
                raw_hues.append(h)
                raw_sats.append(s)
                if len(raw_hues) == 3:
                    break

        while len(raw_hues) < 3:
            base = raw_hues[-1] if raw_hues else 0.0
            raw_hues.append((base + 0.33) % 1.0)
            raw_sats.append(0.85)

        final_hues = _nudge_apart(raw_hues)

        accents = [_normalize(h, s) for h, s in zip(final_hues, raw_sats)]

        # Sort by perceived luminance: darkest first (→ bottom of viz), brightest last (→ top)
        accents.sort(key=_perceived_luminance)

        return accents[0], accents[1], accents[2]

    except Exception:
        return (50, 80, 255), (255, 50, 150), (255, 220, 0)


_FALLBACK_DURATION = 200.0   # 3:20, used when duration is unknown

def _draw_progress_bar(draw: ImageDraw.ImageDraw,
                       elapsed_s: float, duration_s: float | None,
                       accent1: tuple, accent2: tuple) -> None:
    dur   = duration_s if (duration_s and duration_s > 0) else _FALLBACK_DURATION
    ratio = min(1.0, max(0.0, elapsed_s / dur))
    fill_px  = round(ratio * TEXT_W)
    cursor_x = min(TEXT_X + fill_px, TEXT_X + TEXT_W - 1)

    draw.rectangle([TEXT_X, PROG_Y - 1, TEXT_X + TEXT_W - 1, PROG_Y], fill=C_PROG_BG)
    if fill_px > 0:
        draw.rectangle([TEXT_X, PROG_Y - 1, TEXT_X + fill_px - 1, PROG_Y], fill=accent1)
    # cursor is 1px taller than the bar (extends 1px above)
    draw.rectangle([cursor_x, PROG_Y - 2, cursor_x, PROG_Y], fill=accent2)


def _freq_curve(col: int, total: int, bass: float, mids: float, highs: float) -> float:
    x  = col / (total - 1)
    b  = 1.00 * bass  * exp(-((x - 0.08) / 0.35) ** 2)
    m  = 0.82 * mids  * exp(-((x - 0.50) / 0.35) ** 2)
    h  = 0.78 * highs * exp(-((x - 0.92) / 0.30) ** 2)
    return max(0.35, b + m + h)


def _viz_color(from_bottom: int) -> tuple:
    if from_bottom > VIZ_HI_PX:
        return C_VIZ_HI
    if from_bottom > VIZ_MID_PX:
        return C_VIZ_MID
    return C_VIZ_LO


def _draw_viz_bars(img: Image.Image, heights: list[float],
                   c_lo: tuple, c_mid: tuple, c_hi: tuple) -> None:
    # Draw visualizer bars with three colour zones (lo=bottom, mid=middle, hi=top).
    draw     = ImageDraw.Draw(img)
    zone_mid = H // 3        # below this → c_lo
    zone_hi  = 2 * H // 3   # above this → c_hi, between → c_mid

    for col, h in enumerate(heights):
        bar_h = max(VIZ_MIN_H, round(h))
        x0    = VIZ_X + VIZ_PADDING + col * (VIZ_BAR_W + VIZ_GAP_W)
        x1    = x0 + VIZ_BAR_W - 1
        for row in range(H):
            from_bottom = H - 1 - row
            if from_bottom < bar_h:
                if from_bottom < zone_mid:
                    color = c_lo
                elif from_bottom < zone_hi:
                    color = c_mid
                else:
                    color = c_hi
                draw.rectangle([x0, row, x1, row], fill=color)


def _clean_text(text: str) -> str:
    return re.sub(r'\s*[\(\[].*?[\)\]]', '', text).strip()


def _build_line_strip(text: str, color: tuple, font) -> tuple[Image.Image, int]:
    text = _clean_text(text)
    probe = ImageDraw.Draw(Image.new("RGB", (4000, FONT_H)))
    while text and _tw(probe, text, font) > TEXT_W:
        text = text[:-1]
    strip = Image.new("RGB", (TEXT_W, FONT_H), BG)
    if text:
        _put(ImageDraw.Draw(strip), 0, 0, text, font, color)
    return strip, 0


def _line_scroll_x(fi: int, overflow: int) -> int:
    if overflow == 0:
        return 0
    if fi < SCROLL_STATIC_FRAMES:
        return 0
    if fi < SCROLL_STATIC_FRAMES + overflow:
        return fi - SCROLL_STATIC_FRAMES
    return overflow   # paused at end until full cycle resets


def generate_gif(state: dict, quick: bool = False) -> bytes:
    preset       = state.get("preset") or {"bass_mult": 1.0, "mids_mult": 1.0, "highs_mult": 1.0}
    bpm          = state.get("bpm") or 100
    danceability = (state.get("danceability") or 60) / 100
    acousticness = (state.get("acousticness") or 30) / 100
    elapsed_s    = state.get("elapsed_s") or 0.0
    duration_s   = state.get("duration_s")

    bass  = preset["bass_mult"]
    mids  = preset["mids_mult"]
    highs = preset["highs_mult"]

    curve = [_freq_curve(c, VIZ_BARS, bass, mids, highs) for c in range(VIZ_BARS)]
    max_c = max(curve) or 1.0
    curve = [v / max_c for v in curve]

    energy      = 0.5 + danceability * 0.5 - acousticness * 0.15
    punch_scale = (H - 2) * energy
    idle_scale  = float(VIZ_MIN_H + 2)

    frames_per_beat = max(1, round(60_000 / bpm / FRAME_MS))

    cover_bytes = state.get("cover")
    accent1, accent2, accent3 = _accent_colors(cover_bytes) if cover_bytes else ((255, 50, 100), (50, 200, 255), (255, 200, 0))

    cover_base = Image.new("RGB", (W, H), BG)
    if cover_bytes:
        try:
            cover_img = Image.open(io.BytesIO(cover_bytes)).convert("RGB")
            cover_img = cover_img.resize((COVER_W, H), Image.LANCZOS)
            pixels    = list(cover_img.convert("L").getdata())
            dark_ratio = sum(1 for p in pixels if p < 40) / len(pixels)
            if dark_ratio > 0.5:
                cover_img = cover_img.point(lambda p: 20 + int(p * 235 / 255))
                cover_img = ImageEnhance.Color(cover_img).enhance(2.8)
                cover_img = ImageEnhance.Contrast(cover_img).enhance(2.0)
            else:
                cover_img = cover_img.point(lambda p: 45 + int(p * 210 / 255))
                cover_img = ImageEnhance.Color(cover_img).enhance(2.0)
                cover_img = ImageEnhance.Contrast(cover_img).enhance(1.5)
            cover_base.paste(cover_img, (0, 0))
        except Exception:
            pass
    else:
        ph_draw = ImageDraw.Draw(cover_base)
        r1, g1, b1 = accent1
        r2, g2, b2 = accent2
        for y in range(H):
            t = y / (H - 1)
            ph_draw.rectangle(
                [0, y, COVER_W - 1, y],
                fill=(round(r1 * (1 - t) + r2 * t),
                      round(g1 * (1 - t) + g2 * t),
                      round(b1 * (1 - t) + b2 * t)),
            )
        note_font = _load(16)
        note_x, note_y = 8, 7
        ph_draw.text((note_x + 1, note_y + 1), "♪", font=note_font, fill=(0, 0, 0))
        ph_draw.text((note_x, note_y), "♪", font=note_font, fill=(255, 255, 255))

    font = _load(FONT_H)
    lines = [
        (_build_line_strip(state.get("title")  or "", C_TITLE,  font), TITLE_Y),
        (_build_line_strip(state.get("artist") or "", accent1,  font), ARTIST_Y),
        (_build_line_strip(state.get("album")  or "", accent2,  font), ALBUM_Y),
    ]
    max_overflow  = max(ov for (_, ov), _ in lines)
    cycle_frames  = SCROLL_STATIC_FRAMES + max_overflow + SCROLL_PAUSE_FRAMES
    total_frames  = frames_per_beat * (1 if quick else 2)

    frames = []
    for fi in range(total_frames):
        beat_phase = fi % frames_per_beat
        decay      = 1.0 - (beat_phase / frames_per_beat) * 0.8
        jitter     = 1.0 + random.uniform(-0.04, 0.04)
        heights    = [max(v * idle_scale, v * punch_scale * decay * jitter) for v in curve]

        frame = cover_base.copy()

        fi_scroll = fi % max(cycle_frames, 1)
        for (strip, overflow), y_pos in lines:
            sx         = _line_scroll_x(fi_scroll, overflow)
            crop_right = min(sx + TEXT_W, strip.width)
            if crop_right > sx:
                region = strip.crop((sx, 0, crop_right, FONT_H))
                frame.paste(region, (TEXT_X, y_pos))

        draw = ImageDraw.Draw(frame)
        _draw_progress_bar(draw, elapsed_s, duration_s, accent1, accent2)
        _draw_viz_bars(frame, heights, accent1, accent2, accent3)
        frames.append(frame)

    import assets.system.config as config
    frames = [config.apply_orientation(f) for f in frames]

    palette_src = frames[0].quantize(colors=256, method=2)
    quantized   = [f.quantize(palette=palette_src, dither=Image.Dither.NONE) for f in frames]

    buf = io.BytesIO()
    quantized[0].save(
        buf,
        format="GIF",
        save_all=True,
        append_images=quantized[1:],
        loop=0,
        duration=FRAME_MS,
        optimize=False,
    )
    return buf.getvalue()


if __name__ == "__main__":
    import argparse, sys
    sys.path.insert(0, os.path.dirname(__file__))
    from genre_presets import get_preset

    p = argparse.ArgumentParser()
    p.add_argument("-font", type=int, default=_FONT_CHOICE,
                   help=f"Font: {', '.join(f'{k}={v[0]}' for k,v in FONTS.items())}")
    args = p.parse_args()
    set_font(args.font)

    cover_bytes = None
    try:
        r   = requests.get("https://itunes.apple.com/search",
                           params={"term": "Tate McRae go away", "media": "music", "limit": 1},
                           timeout=10)
        url = r.json()["results"][0]["artworkUrl100"].replace("100x100bb", "32x32bb")
        cover_bytes = requests.get(url, timeout=10).content
        print("Cover fetched.")
    except Exception as e:
        print(f"Cover fetch failed: {e}")

    state = {
        "title":        "go away (this is a longer title)",
        "artist":       "Tate McRae",
        "album":        "So Close To What",
        "cover":        cover_bytes,
        "bpm":          140,
        "danceability": 80,
        "acousticness": 10,
        "elapsed_s":    67.0,
        "duration_s":   213.0,
        "preset":       get_preset(["pop", "electropop"]),
    }

    print("Rendering GIF...")
    gif_bytes = generate_gif(state)
    out = os.path.join(os.path.dirname(__file__), "preview.gif")
    with open(out, "wb") as f:
        f.write(gif_bytes)
    from PIL import ImageSequence
    n = sum(1 for _ in ImageSequence.Iterator(Image.open(out)))
    print(f"Saved {len(gif_bytes):,} bytes → {out}  ({len(gif_bytes)//1024} KB, {n} frames, {n * FRAME_MS / 1000:.1f}s)")
