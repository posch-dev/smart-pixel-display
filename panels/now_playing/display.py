import colorsys
import io
import os
import random
import re
import sys
import requests
from math import exp

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import assets.system.log as log

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from genre_presets import get_preset

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

FRAME_MS = 100   # ms per GIF frame (10 fps)

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
last_accents: tuple[tuple, tuple, tuple] | None = None


def set_font(n: int) -> None:
    global _FONT_PATH, _FONT_CHOICE
    if n not in FONTS:
        raise ValueError(f"Font must be 1–{len(FONTS)}. Options: {FONTS}")
    _FONT_CHOICE = n
    _FONT_PATH   = os.path.join(_FONTS_DIR, FONTS[n][1])
    _font_cache.clear()
    log.info("font", f"{n}: {FONTS[n][0]}")


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
    from math import sin, cos, atan2, pi, sqrt
    BUCKET_RADIUS = 0.06   # ~22° hue bucket
    MIN_RGB_DIST  = 55     # minimum euclidean RGB distance after normalization

    def _hue_dist(h1, h2):
        return min(abs(h1 - h2), 1 - abs(h1 - h2))

    def _circular_mean_hue(hues):
        s = sum(sin(h * 2 * pi) for h in hues)
        c = sum(cos(h * 2 * pi) for h in hues)
        return (atan2(s, c) / (2 * pi)) % 1.0

    def _normalize(h, s):
        r, g, b = colorsys.hsv_to_rgb(h, max(s, 0.80), 0.85)
        return (int(r * 255), int(g * 255), int(b * 255))

    def _rgb_dist(c1, c2):
        return sqrt(sum((a - b) ** 2 for a, b in zip(c1, c2)))

    try:
        img = Image.open(io.BytesIO(cover_bytes)).convert("RGB")
        img = img.resize((16, 16), Image.LANCZOS)

        pixels = []
        for p in img.getdata():
            h, s, v = colorsys.rgb_to_hsv(p[0] / 255, p[1] / 255, p[2] / 255)
            if s >= 0.15 and 0.15 <= v <= 0.95:
                pixels.append((h, s, v))

        if len(pixels) < 3:
            for p in img.getdata():
                h, s, v = colorsys.rgb_to_hsv(p[0] / 255, p[1] / 255, p[2] / 255)
                if v >= 0.10:
                    pixels.append((h, s, v))

        if not pixels:
            return (80, 80, 255), (200, 80, 200), (255, 180, 50)

        buckets: list[list[tuple]] = []
        bucket_hues: list[float] = []

        for h, s, v in pixels:
            placed = False
            for i, bh in enumerate(bucket_hues):
                if _hue_dist(h, bh) < BUCKET_RADIUS:
                    buckets[i].append((h, s, v))
                    placed = True
                    break
            if not placed:
                buckets.append([(h, s, v)])
                bucket_hues.append(h)

        scored: list[tuple[int, float, float]] = []
        for bucket in buckets:
            count = len(bucket)
            avg_h = _circular_mean_hue([h for h, _, _ in bucket])
            avg_s = sum(s for _, s, _ in bucket) / count
            scored.append((count, avg_h, avg_s))

        scored.sort(key=lambda x: x[0], reverse=True)

        picked_rgb: list[tuple] = []
        picked_hs: list[tuple[float, float]] = []
        for count, h, s in scored:
            rgb = _normalize(h, s)
            if all(_rgb_dist(rgb, pr) >= MIN_RGB_DIST for pr in picked_rgb):
                picked_rgb.append(rgb)
                picked_hs.append((h, s))
                if len(picked_rgb) == 3:
                    break

        if len(picked_rgb) < 3:
            base_h = picked_hs[0][0] if picked_hs else 0.6
            variants = [
                (base_h, 0.95, 0.90),
                (base_h, 0.55, 0.85),
                (base_h, 0.35, 0.90),
                ((base_h + 0.05) % 1.0, 0.80, 0.85),
                ((base_h - 0.05) % 1.0, 0.80, 0.85),
            ]
            for vh, vs, vv in variants:
                r, g, b = colorsys.hsv_to_rgb(vh, vs, vv)
                rgb = (int(r * 255), int(g * 255), int(b * 255))
                if all(_rgb_dist(rgb, pr) >= MIN_RGB_DIST for pr in picked_rgb):
                    picked_rgb.append(rgb)
                    if len(picked_rgb) == 3:
                        break

        while len(picked_rgb) < 3:
            r, g, b = colorsys.hsv_to_rgb(base_h, 0.50, 0.70)
            picked_rgb.append((int(r * 255), int(g * 255), int(b * 255)))

        a, b, c = picked_rgb[0], picked_rgb[1], picked_rgb[2]
        if _rgb_dist(a, b) > _rgb_dist(a, c):
            b, c = c, b
        return a, b, c

    except Exception as e:
        log.debug("cover", f"palette failed, using the fallback: {e}")
        return (80, 80, 255), (200, 80, 200), (255, 180, 50)


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


def _build_line_strip(text: str, color: tuple, font) -> Image.Image:
    text = _clean_text(text)
    probe = ImageDraw.Draw(Image.new("RGB", (4000, FONT_H)))
    while text and _tw(probe, text, font) > TEXT_W:
        text = text[:-1]
    strip = Image.new("RGB", (TEXT_W, FONT_H), BG)
    if text:
        _put(ImageDraw.Draw(strip), 0, 0, text, font, color)
    return strip


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
    global last_accents
    accent1, accent2, accent3 = _accent_colors(cover_bytes) if cover_bytes else ((0, 255, 0), (255, 100, 0), (0, 210, 210))
    last_accents = (accent1, accent2, accent3)

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
        except Exception as e:
            log.warn("cover", f"cover processing failed: {e}")
    else:
        ph_draw = ImageDraw.Draw(cover_base)
        note_font = _load(16)
        bb = ph_draw.textbbox((0, 0), "♪", font=note_font)
        nw, nh = bb[2] - bb[0], bb[3] - bb[1]
        note_x = (COVER_W - nw) // 2 - bb[0]
        note_y = (H - nh) // 2 - bb[1]
        ph_draw.text((note_x, note_y), "♪", font=note_font, fill=(255, 255, 255))

    font = _load(FONT_H)
    lines = [
        (_build_line_strip(state.get("title")  or "", C_TITLE,  font), TITLE_Y),
        (_build_line_strip(state.get("artist") or "", accent1,  font), ARTIST_Y),
        (_build_line_strip(state.get("album")  or "", accent2,  font), ALBUM_Y),
    ]
    total_frames = frames_per_beat * (1 if quick else 2)

    frames = []
    for fi in range(total_frames):
        beat_phase = fi % frames_per_beat
        decay      = 1.0 - (beat_phase / frames_per_beat) * 0.8
        jitter     = 1.0 + random.uniform(-0.04, 0.04)
        heights    = [max(v * idle_scale, v * punch_scale * decay * jitter) for v in curve]

        frame = cover_base.copy()

        for strip, y_pos in lines:
            frame.paste(strip, (TEXT_X, y_pos))

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


def fetch_cover(query: str) -> bytes | None:
    # itunes search, 32px art. the only cover source for the canned states and the readme assets
    try:
        r   = requests.get("https://itunes.apple.com/search",
                           params={"term": query, "media": "music", "limit": 1}, timeout=10)
        url = r.json()["results"][0]["artworkUrl100"].replace("100x100bb", "32x32bb")
        return requests.get(url, timeout=10).content
    except Exception as error:
        log.warn("nowplaying", f"cover fetch failed for {query!r}: {error}")
        return None


def _song(title, artist, album, bpm, dance, acoustic, elapsed, duration, genres):
    return {
        "title": title, "artist": artist, "album": album,
        "bpm": bpm, "danceability": dance, "acousticness": acoustic,
        "elapsed_s": elapsed, "duration_s": duration,
        "preset": get_preset(genres),
    }


# The eight with a file are the readme assets. The last three cover what the others do not:
# an unknown duration, a dense trap beat, and a title and artist that both have to be cut.
# elapsed_s is only read for the duration fallback, the panel restarts every track at zero.
STATES = [
    {"file": "nowplaying_go_away.gif", "query": "go away tate mcrae", "note": "high bpm pop",
     "state": _song("go away", "Tate McRae", "So Close To What (Apple Music Edition)",
                    140, 85, 5, 74.0, 213.0, ["pop", "electropop"])},
    {"file": "nowplaying_all_the_love.gif", "query": "all the love kanye west", "note": "hip hop, mid bpm",
     "state": _song("All The Love", "Kanye West", "Bully",
                    87, 65, 20, 81.0, 180.0, ["hip hop", "rap"])},
    {"file": "nowplaying_trying_on_shoes.gif", "query": "trying on shoes tate mcrae", "note": "synth pop",
     "state": _song("trying on shoes", "Tate McRae", "So Close To What (Deluxe)",
                    108, 75, 15, 102.0, 170.0, ["pop", "synth pop"])},
    {"file": "nowplaying_babybell.gif", "query": "babybell breitner", "note": "german hip hop, short strings",
     "state": _song("babybell", "breitner", "babybell",
                    100, 70, 25, 45.0, 180.0, ["hip hop", "german hip hop"])},
    {"file": "nowplaying_big_city_life.gif", "query": "big city life mattafix", "note": "reggae, long album name",
     "state": _song("Big City Life", "Mattafix", "Signs of a Struggle",
                    87, 72, 30, 60.0, 228.0, ["reggae", "hip hop", "dancehall"])},
    {"file": "nowplaying_sword_from_the_stone.gif", "query": "sword from the stone passenger", "note": "acoustic, flat bars",
     "state": _song("Sword from the Stone", "Passenger", "Sword from the Stone",
                    130, 35, 90, 90.0, 240.0, ["folk", "singer-songwriter", "acoustic"])},
    {"file": "nowplaying_media_vita.gif", "query": "media vita hardknock music", "note": "beats, default energy",
     "state": _song("Media Vita", "Hardknock Music", "Media Vita",
                    92, 60, 35, 55.0, 195.0, ["hip hop", "beats"])},
    {"file": "nowplaying_mice_on_venus.gif", "query": "mice on venus c418", "note": "lowest bpm, most acoustic",
     "state": _song("Mice on Venus", "C418", "Minecraft - Volume Alpha",
                    60, 20, 85, 120.0, 281.0, ["ambient", "electronic", "soundtrack"])},
    {"query": "make it hot ally", "note": "unknown duration, bar assumes 200s",
     "state": _song("Make It Hot", "Ally", "Make It Hot",
                    118, 80, 10, 52.0, None, ["pop", "dance"])},
    {"query": "sirens travis scott", "note": "trap, dense bars",
     "state": _song("Sirens", "Travis Scott", "JACKBOYS 2",
                    128, 78, 8, 236.0, 240.0, ["hip hop", "trap"])},
    {"query": "by the end of the night ellie goulding southstar", "note": "title and artist both past the text column",
     "state": _song("By the End of the Night", "Ellie Goulding & southstar", "By the End of the Night",
                    122, 68, 22, 95.0, 260.0, ["pop", "electropop", "dance"])},
]


if __name__ == "__main__":
    import argparse, sys
    sys.path.insert(0, os.path.dirname(__file__))

    p = argparse.ArgumentParser()
    p.add_argument("-font", type=int, default=_FONT_CHOICE,
                   help=f"Font: {', '.join(f'{k}={v[0]}' for k,v in FONTS.items())}")
    args = p.parse_args()
    set_font(args.font)

    song  = STATES[0]
    state = dict(song["state"], cover=fetch_cover(song["query"]))

    print("Rendering GIF...")
    gif_bytes = generate_gif(state)
    out = os.path.join(os.path.dirname(__file__), "preview.gif")
    with open(out, "wb") as f:
        f.write(gif_bytes)
    from PIL import ImageSequence
    n = sum(1 for _ in ImageSequence.Iterator(Image.open(out)))
    print(f"Saved {len(gif_bytes):,} bytes to {out}  ({len(gif_bytes)//1024} KB, {n} frames, {n * FRAME_MS / 1000:.1f}s)")
