#!/usr/bin/env python3

import os, sys, requests
_root = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, _root)
sys.path.insert(0, os.path.join(_root, "panels", "now_playing"))

import display
from genre_presets import get_preset

FONTS_DIR = os.path.join(_root, "assets", "fonts")
OUT_DIR   = os.path.dirname(__file__)

FONTS = [
    ("MinecraftStandard",     "MinecraftStandard.otf"),
    ("MinecraftStandardBold", "MinecraftStandardBold.otf"),
    ("Minecraft",             "Minecraft.ttf"),
    ("PressStart2P",          "PressStart2P.ttf"),
    ("PerfectDOS",            "PerfectDOS_VGA_437.ttf"),
    ("pcsenior",              "pcsenior.ttf"),
    ("Pixellari",             "Pixellari.ttf"),
    ("RetroGaming",           "Retro Gaming.ttf"),
    ("alagard",               "alagard.ttf"),
    ("cga-luke-6px",          "cga-luke-6px-bold.otf"),
    ("deltarune",             "deltarune.ttf"),
    ("HIAIRP22",              "HIAIRP22.ttf"),
]

cover_bytes = None
try:
    r = requests.get("https://itunes.apple.com/search",
                     params={"term": "Tate McRae go away", "media": "music", "limit": 1},
                     timeout=10)
    url = r.json()["results"][0]["artworkUrl100"].replace("100x100bb", "32x32bb")
    cover_bytes = requests.get(url, timeout=10).content
    print("Cover fetched.")
except Exception as e:
    print(f"Cover fetch failed: {e}")

state = {
    "title":        "go away (longer title here)",
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

for name, filename in FONTS:
    path = os.path.join(FONTS_DIR, filename)
    if not os.path.exists(path):
        print(f"  skip {name} (not found)")
        continue

    display._FONT_PATH = path
    display._font_cache.clear()

    try:
        gif = display.generate_gif(state)
        out = os.path.join(OUT_DIR, f"preview_{name}.gif")
        with open(out, "wb") as f:
            f.write(gif)
        print(f"  saved preview_{name}.gif  ({len(gif)//1024} KB)")
    except Exception as e:
        print(f"  ERROR {name}: {e}")
