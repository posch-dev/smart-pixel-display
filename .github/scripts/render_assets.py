#!/usr/bin/env python3

import binascii, io, os, sys, random
import requests
from datetime import datetime
from PIL import Image, ImageSequence

_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, _root)
sys.path.insert(0, os.path.join(_root, "panels", "dashboard"))
sys.path.insert(0, os.path.join(_root, "panels", "now_playing"))

OUT   = os.path.join(_root, ".github", "assets")
SCALE = 4

CLOCK_DIR  = "panels/clock"
VERSE_DIR  = "panels/verse"
NP_DIR     = "panels/nowplaying"
DASH_DIR   = "panels/dashboard"
PANELS_DIR = "panels"
UNUSED_DIR = "unused"

DASH_WEATHER_SHOWN = {"partly", "below_zero", "snow_f"}


def _out_path(name: str) -> str:
    path = os.path.join(OUT, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return path

# the weather renders nobody links to are kept out of the panel folder
def _weather_name(label: str) -> str:
    folder = DASH_DIR if label in DASH_WEATHER_SHOWN else UNUSED_DIR
    return f"{folder}/dashboard_weather_{label}.png"


def _hex_to_img(hex_str: str) -> Image.Image:
    return Image.open(io.BytesIO(binascii.unhexlify(hex_str))).convert("RGB")

def _upscale(img: Image.Image) -> Image.Image:
    return img.resize((img.width * SCALE, img.height * SCALE), Image.NEAREST)

def _save_png(hex_str: str, name: str) -> None:
    path = _out_path(name)
    _upscale(_hex_to_img(hex_str)).rotate(180).save(path)
    print(f"  {name}")

def _frames_to_gif(frames: list[Image.Image], name: str, duration) -> None:
    scaled = [_upscale(f) for f in frames]
    palette_src = scaled[0].quantize(colors=256, method=2)
    quantized   = [f.quantize(palette=palette_src, dither=Image.Dither.NONE) for f in scaled]
    buf = io.BytesIO()
    quantized[0].save(buf, format="GIF", save_all=True, append_images=quantized[1:],
                      loop=0, duration=duration, optimize=False)
    path = _out_path(name)
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
_frames_to_gif(clock_frames, f"{CLOCK_DIR}/clock.gif", 5000)


print("\nVerse of Day:")
from panels.verse_of_day.main import render_reference

W, H = 128, 32
for label, ref in [
    ("short",  "JOHN 5:4"),
    ("medium", "ROMANS 8:18"),
    ("long",   "REVELATION 22:21"),
]:
    _save_png(render_reference(ref, W, H), f"{VERSE_DIR}/verse_{label}.png")


print("\nDashboard:")
import calendar_store
import assets.system.config as _cfg
from panels.dashboard.display import render_frame as dash_render, C_PURPLE, C_ORANGE

LOCAL_TZ = datetime.now().astimezone().tzinfo

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
    _save_png(dash_render(WEATHER_TIMES[label], WEATHERS_METRIC[label], True), _weather_name(label))

print("  Mode 1 - metric, low below zero:")
_save_png(
    dash_render(datetime(2026, 3, 15, 10, 0, tzinfo=LOCAL_TZ), WEATHERS_METRIC["low_neg"], True),
    _weather_name("low_neg"),
)

print("  Mode 1 - metric, below zero now:")
_save_png(
    dash_render(datetime(2026, 1, 20, 8, 0, tzinfo=LOCAL_TZ), WEATHERS_METRIC["below_zero"], True),
    _weather_name("below_zero"),
)

print("  Mode 1 - metric, all negative:")
_save_png(
    dash_render(datetime(2026, 1, 28, 7, 0, tzinfo=LOCAL_TZ), WEATHERS_METRIC["all_neg"], True),
    _weather_name("all_neg"),
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
    _weather_name("sunny_f"),
)
_save_png(
    dash_render(datetime(2026, 1, 5, 7, 45, tzinfo=LOCAL_TZ), WEATHERS_METRIC["below_zero"], True),
    _weather_name("snow_f"),
)
_cfg.get = _orig_cfg_get

print("  Mode 2:")
_save_png(
    dash_render(datetime(2026, 1, 15, 8, 0, tzinfo=LOCAL_TZ), WEATHERS_METRIC["cloudy"], True,
                cal_override=(None, None, "Gym", "09:00", "10:30")),
    f"{DASH_DIR}/dashboard_mode2.png",
)

print("  Mode 3 - 45 min:")
_save_png(
    dash_render(datetime(2026, 9, 17, 18, 45, tzinfo=LOCAL_TZ), WEATHERS_METRIC["partly"], True,
                cal_override=(45, "19:30", "Casino")),
    f"{DASH_DIR}/dashboard_mode3.png",
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
_frames_to_gif([frame_purple, frame_orange], f"{DASH_DIR}/dashboard_mode3_late.gif", 500)

print("  Mode 3 - far out:")
_save_png(
    dash_render(datetime(2026, 8, 22, 14, 32, tzinfo=LOCAL_TZ), WEATHERS_METRIC["sunny"], True,
                cal_override=(90, "16:02", "Night Shift")),
    f"{DASH_DIR}/dashboard_mode3_far.png",
)


print("\nNow Playing:")
from panels.now_playing.display import generate_gif, fetch_cover, STATES as np_states

SONGS = [s for s in np_states if s.get("file")]   # only the eight that back the readme assets

for song in SONGS:
    cover = fetch_cover(song["query"])
    state = {**song["state"], "cover": cover}
    gif_bytes = generate_gif(state)
    _scale_gif_bytes(gif_bytes, f"{NP_DIR}/{song['file']}")


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
    path = _out_path(name)
    with open(path, "wb") as fh:
        fh.write(buf.getvalue())
    print(f"  {name}  ({len(buf.getvalue()) // 1024} KB, {len(all_f)} frames)")


print("\nVerse Preview GIF:")
_merge_assets([f"{VERSE_DIR}/verse_short.png", f"{VERSE_DIR}/verse_medium.png",
               f"{VERSE_DIR}/verse_long.png"], f"{VERSE_DIR}/verse_preview.gif")

print("\nDashboard Preview GIF:")
_merge_assets([
    _weather_name("partly"),
    _weather_name("below_zero"),
    f"{DASH_DIR}/dashboard_mode2.png",
    f"{DASH_DIR}/dashboard_mode3.png",
    f"{DASH_DIR}/dashboard_mode3_late.gif",
], f"{DASH_DIR}/dashboard_preview.gif")

print("\nNow Playing Preview GIF:")
_merge_assets([f"{NP_DIR}/{s['file']}" for s in SONGS], f"{NP_DIR}/nowplaying_preview.gif")

print("\nPreview GIF:")
_merge_assets([
    f"{CLOCK_DIR}/clock.gif",
    f"{VERSE_DIR}/verse_preview.gif",
    f"{NP_DIR}/nowplaying_preview.gif",
    f"{DASH_DIR}/dashboard_preview.gif",
], f"{PANELS_DIR}/preview.gif")


print("\nDone.")
