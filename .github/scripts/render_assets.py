#!/usr/bin/env python3

import binascii, io, os, sys, random
import requests
from datetime import datetime
from zoneinfo import ZoneInfo
from PIL import Image, ImageSequence

_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, _root)
sys.path.insert(0, os.path.join(_root, "panels", "dashboard"))
sys.path.insert(0, os.path.join(_root, "panels", "now_playing"))

OUT   = os.path.join(_root, ".github", "assets")
SCALE = 4

os.makedirs(OUT, exist_ok=True)


def _hex_to_img(hex_str: str) -> Image.Image:
    return Image.open(io.BytesIO(binascii.unhexlify(hex_str))).convert("RGB")

def _upscale(img: Image.Image) -> Image.Image:
    return img.resize((img.width * SCALE, img.height * SCALE), Image.NEAREST)

def _save_png(hex_str: str, name: str) -> None:
    path = os.path.join(OUT, name)
    _upscale(_hex_to_img(hex_str)).rotate(180).save(path)
    print(f"  {name}")

def _frames_to_gif(frames: list[Image.Image], name: str, duration) -> None:
    scaled = [_upscale(f) for f in frames]
    palette_src = scaled[0].quantize(colors=256, method=2)
    quantized   = [f.quantize(palette=palette_src, dither=Image.Dither.NONE) for f in scaled]
    buf = io.BytesIO()
    quantized[0].save(buf, format="GIF", save_all=True, append_images=quantized[1:],
                      loop=0, duration=duration, optimize=False)
    path = os.path.join(OUT, name)
    with open(path, "wb") as f:
        f.write(buf.getvalue())
    print(f"  {name}  ({len(buf.getvalue()) // 1024} KB, {len(frames)} frames)")

def _scale_gif_bytes(gif_bytes: bytes, name: str) -> None:
    src    = Image.open(io.BytesIO(gif_bytes))
    frames = [f.convert("RGB").rotate(180) for f in ImageSequence.Iterator(src)]
    _frames_to_gif(frames, name, 100)


print("\nClock:")
from panels.clock.main import render_frame as clock_render

CLOCK_TIMES = [
    ("07", "30"), ("09", "11"), ("05", "09"),
    ("17", "49"), ("23", "18"), ("20", "15"), ("17", "38"),
]
clock_frames = [_hex_to_img(clock_render(hh, mm, True)).rotate(180) for hh, mm in CLOCK_TIMES]
_frames_to_gif(clock_frames, "clock.gif", 5000)


print("\nVerse of Day:")
from panels.verse_of_day.main import render_reference

W, H = 128, 32
for label, ref in [
    ("short",  "JOHN 5:4"),
    ("medium", "ROMANS 8:18"),
    ("long",   "REVELATION 22:21"),
]:
    _save_png(render_reference(ref, W, H), f"verse_{label}.png")


print("\nDashboard:")
import calendar_store
import assets.system.config as _cfg
from panels.dashboard.display import render_frame as dash_render, C_PURPLE, C_ORANGE

LOCAL_TZ = ZoneInfo("Europe/Vienna")

WEATHERS_METRIC = {
    "sunny":       {"temp_now": 22, "temp_high": 26, "temp_low": 14, "condition": "clear"},
    "rain":        {"temp_now": 12, "temp_high": 15, "temp_low":  9, "condition": "rain"},
    "snow":        {"temp_now":  2, "temp_high":  5, "temp_low":  0, "condition": "snow"},
    "storm":       {"temp_now": 10, "temp_high": 13, "temp_low":  8, "condition": "thunderstorm"},
    "fog":         {"temp_now":  8, "temp_high": 12, "temp_low":  6, "condition": "fog"},
    "cloudy":      {"temp_now": 17, "temp_high": 20, "temp_low": 11, "condition": "overcast"},
    "partly":      {"temp_now": 19, "temp_high": 23, "temp_low": 12, "condition": "partly cloudy"},
    "low_neg":     {"temp_now":  4, "temp_high":  7, "temp_low": -2, "condition": "partly cloudy"},
    "below_zero":  {"temp_now": -3, "temp_high":  2, "temp_low": -8, "condition": "snow"},
    "all_neg":     {"temp_now":-10, "temp_high": -2, "temp_low":-15, "condition": "snow"},
}

WEATHER_TIMES = {
    "sunny":      datetime(2026,  6, 14, 14, 32, tzinfo=LOCAL_TZ),
    "rain":       datetime(2026,  3,  3,  8, 15, tzinfo=LOCAL_TZ),
    "snow":       datetime(2026,  1,  5, 23, 45, tzinfo=LOCAL_TZ),
    "storm":      datetime(2026, 11, 10, 16, 50, tzinfo=LOCAL_TZ),
    "fog":        datetime(2026,  4,  7,  9, 15, tzinfo=LOCAL_TZ),
    "cloudy":     datetime(2026,  9, 17, 11, 20, tzinfo=LOCAL_TZ),
    "partly":     datetime(2026,  8, 22,  7, 30, tzinfo=LOCAL_TZ),
    "low_neg":    datetime(2026,  3, 15, 10,  0, tzinfo=LOCAL_TZ),
    "below_zero": datetime(2026,  1, 20,  8,  0, tzinfo=LOCAL_TZ),
    "all_neg":    datetime(2026,  1, 28,  7,  0, tzinfo=LOCAL_TZ),
}

STANDARD_CONDITIONS = ["sunny", "rain", "snow", "storm", "fog", "cloudy", "partly"]
print("  Mode 1 - metric:")
calendar_store.clear_events()
for label in STANDARD_CONDITIONS:
    _save_png(dash_render(WEATHER_TIMES[label], WEATHERS_METRIC[label], True), f"dashboard_weather_{label}.png")

print("  Mode 1 - metric, low below zero:")
_save_png(
    dash_render(datetime(2026, 3, 15, 10, 0, tzinfo=LOCAL_TZ), WEATHERS_METRIC["low_neg"], True),
    "dashboard_weather_low_neg.png",
)

print("  Mode 1 - metric, below zero now:")
_save_png(
    dash_render(datetime(2026, 1, 20, 8, 0, tzinfo=LOCAL_TZ), WEATHERS_METRIC["below_zero"], True),
    "dashboard_weather_below_zero.png",
)

print("  Mode 1 - metric, all negative:")
_save_png(
    dash_render(datetime(2026, 1, 28, 7, 0, tzinfo=LOCAL_TZ), WEATHERS_METRIC["all_neg"], True),
    "dashboard_weather_all_neg.png",
)

_orig_cfg_get = _cfg.get
def _imperial_get(section, key, default=None):
    result = _orig_cfg_get(section, key, default)
    if section == "dashboard" and key == "weather":
        return {**(result or {}), "units": "imperial"}
    return result

print("  Mode 1 - imperial:")
_cfg.get = _imperial_get
_save_png(
    dash_render(datetime(2026, 6, 14, 15, 30, tzinfo=LOCAL_TZ), WEATHERS_METRIC["sunny"], True),
    "dashboard_weather_sunny_f.png",
)
_save_png(
    dash_render(datetime(2026, 1, 5, 7, 45, tzinfo=LOCAL_TZ), WEATHERS_METRIC["below_zero"], True),
    "dashboard_weather_snow_f.png",
)
_cfg.get = _orig_cfg_get

print("  Mode 2:")
_save_png(
    dash_render(datetime(2026, 1, 15, 8, 0, tzinfo=LOCAL_TZ), WEATHERS_METRIC["cloudy"], True,
                cal_override=(None, None, "Gym", "09:00", "10:30")),
    "dashboard_mode2.png",
)

print("  Mode 3 - 45 min:")
_save_png(
    dash_render(datetime(2026, 9, 17, 18, 45, tzinfo=LOCAL_TZ), WEATHERS_METRIC["partly"], True,
                cal_override=(45, "19:30", "Casino")),
    "dashboard_mode3.png",
)

print("  Mode 3 - leave now (GIF):")
frame_purple = _hex_to_img(
    dash_render(datetime(2026, 11, 28, 21, 30, tzinfo=LOCAL_TZ), WEATHERS_METRIC["cloudy"], True,
                cal_override=(-12, "", "Saufen"), now_color=C_PURPLE)
).rotate(180)
frame_orange = _hex_to_img(
    dash_render(datetime(2026, 11, 28, 21, 30, tzinfo=LOCAL_TZ), WEATHERS_METRIC["cloudy"], False,
                cal_override=(-12, "", "Saufen"), now_color=C_ORANGE)
).rotate(180)
_frames_to_gif([frame_purple, frame_orange], "dashboard_mode3_late.gif", 500)

print("  Mode 3 - far out:")
_save_png(
    dash_render(datetime(2026, 8, 22, 14, 32, tzinfo=LOCAL_TZ), WEATHERS_METRIC["sunny"], True,
                cal_override=(90, "16:02", "Night Shift")),
    "dashboard_mode3_far.png",
)


print("\nNow Playing:")
from panels.now_playing.display import generate_gif
from panels.now_playing.genre_presets import get_preset

def _fetch_cover(query: str) -> bytes | None:
    try:
        r   = requests.get("https://itunes.apple.com/search",
                           params={"term": query, "media": "music", "limit": 1}, timeout=10)
        url = r.json()["results"][0]["artworkUrl100"].replace("100x100bb", "32x32bb")
        return requests.get(url, timeout=10).content
    except Exception as e:
        print(f"    cover fetch failed ({query!r}): {e}")
        return None

SONGS = [
    {
        "file":  "nowplaying_go_away.gif",
        "query": "go away tate mcrae",
        "state": {
            "title":        "go away",
            "artist":       "Tate McRae",
            "album":        "So Close To What (Apple Music Edition)",
            "bpm":          140,
            "elapsed_s":    74.0,
            "duration_s":   213.0,
            "preset":       get_preset(["pop", "electropop"]),
        },
    },
    {
        "file":  "nowplaying_all_the_love.gif",
        "query": "all the love kanye west",
        "state": {
            "title":        "All The Love",
            "artist":       "Kanye West",
            "album":        "Bully",
            "bpm":          87,
            "elapsed_s":    81.0,
            "duration_s":   180.0,
            "preset":       get_preset(["hip hop", "rap"]),
        },
    },
    {
        "file":  "nowplaying_trying_on_shoes.gif",
        "query": "trying on shoes tate mcrae",
        "state": {
            "title":        "trying on shoes",
            "artist":       "Tate McRae",
            "album":        "So Close To What (Deluxe)",
            "bpm":          108,
            "elapsed_s":    102.0,
            "duration_s":   170.0,
            "preset":       get_preset(["pop", "synth pop"]),
        },
    },
    {
        "file":  "nowplaying_babybell.gif",
        "query": "babybell breitner",
        "state": {
            "title":        "babybell",
            "artist":       "breitner",
            "album":        "babybell",
            "bpm":          100,
            "elapsed_s":    45.0,
            "duration_s":   180.0,
            "preset":       get_preset(["hip hop", "german hip hop"]),
        },
    },
    {
        "file":  "nowplaying_big_city_life.gif",
        "query": "big city life mattafix",
        "state": {
            "title":        "Big City Life",
            "artist":       "Mattafix",
            "album":        "Signs of a Struggle",
            "bpm":          87,
            "elapsed_s":    60.0,
            "duration_s":   228.0,
            "preset":       get_preset(["reggae", "hip hop", "dancehall"]),
        },
    },
    {
        "file":  "nowplaying_sword_from_the_stone.gif",
        "query": "sword from the stone passenger",
        "state": {
            "title":        "Sword from the Stone",
            "artist":       "Passenger",
            "album":        "Sword from the Stone",
            "bpm":          130,
            "elapsed_s":    90.0,
            "duration_s":   240.0,
            "preset":       get_preset(["folk", "singer-songwriter", "acoustic"]),
        },
    },
    {
        "file":  "nowplaying_media_vita.gif",
        "query": "media vita hardknock music",
        "state": {
            "title":        "Media Vita",
            "artist":       "Hardknock Music",
            "album":        "Media Vita",
            "bpm":          92,
            "elapsed_s":    55.0,
            "duration_s":   195.0,
            "preset":       get_preset(["hip hop", "beats"]),
        },
    },
    {
        "file":  "nowplaying_mice_on_venus.gif",
        "query": "mice on venus c418",
        "state": {
            "title":        "Mice on Venus",
            "artist":       "C418",
            "album":        "Minecraft - Volume Alpha",
            "bpm":          60,
            "elapsed_s":    120.0,
            "duration_s":   281.0,
            "preset":       get_preset(["ambient", "electronic", "soundtrack"]),
        },
    },
]

for song in SONGS:
    cover = _fetch_cover(song["query"])
    state = {**song["state"], "cover": cover}
    gif_bytes = generate_gif(state)
    _scale_gif_bytes(gif_bytes, song["file"])


def _asset_frames(name: str, target_ms: int = 5000):
    src = Image.open(os.path.join(OUT, name))
    if not hasattr(src, "n_frames") or src.n_frames == 1:
        return [src.convert("RGB")], [target_ms]
    raw_f, raw_d = [], []
    for frame in ImageSequence.Iterator(src):
        raw_f.append(frame.convert("RGB"))
        raw_d.append(frame.info.get("duration", 100))
    out_f, out_d, elapsed = [], [], 0
    while elapsed < target_ms:
        for f, d in zip(raw_f, raw_d):
            out_f.append(f); out_d.append(d); elapsed += d
            if elapsed >= target_ms:
                break
    return out_f, out_d


def _merge_assets(sources: list[str], name: str, hold_ms: int = 5000):
    all_f, all_d = [], []
    for src_name in sources:
        f, d = _asset_frames(src_name, hold_ms)
        all_f.extend(f); all_d.extend(d)
    W, H = all_f[0].size
    sample_idx = list(range(0, len(all_f), max(1, len(all_f) // 16)))[:16]
    composite = Image.new("RGB", (W, H * len(sample_idx)))
    for i, idx in enumerate(sample_idx):
        composite.paste(all_f[idx], (0, i * H))
    palette_src = composite.quantize(colors=256, method=0)
    quantized = [f.quantize(palette=palette_src, dither=Image.Dither.NONE) for f in all_f]
    buf = io.BytesIO()
    quantized[0].save(buf, format="GIF", save_all=True, append_images=quantized[1:],
                      loop=0, duration=all_d, optimize=False)
    path = os.path.join(OUT, name)
    with open(path, "wb") as fh:
        fh.write(buf.getvalue())
    print(f"  {name}  ({len(buf.getvalue()) // 1024} KB, {len(all_f)} frames)")


print("\nVerse Preview GIF:")
_merge_assets(["verse_short.png", "verse_medium.png", "verse_long.png"], "verse_preview.gif")

print("\nDashboard Preview GIF:")
_merge_assets([
    "dashboard_weather_partly.png",
    "dashboard_weather_below_zero.png",
    "dashboard_mode2.png",
    "dashboard_mode3.png",
    "dashboard_mode3_late.gif",
], "dashboard_preview.gif")

print("\nNow Playing Preview GIF:")
_merge_assets([s["file"] for s in SONGS], "nowplaying_preview.gif")

print("\nPreview GIF:")
_merge_assets([
    "clock.gif",
    "verse_preview.gif",
    "nowplaying_preview.gif",
    "dashboard_preview.gif",
], "preview.gif")


print("\nDone.")
