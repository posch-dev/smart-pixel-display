#!/usr/bin/env python3

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import asyncio
import io
import binascii
import urllib.parse
import requests
from datetime import datetime
from PIL import Image, ImageDraw, ImageFont
from pypixelcolor import AsyncClient
import assets.system.config as config

MAC_ADDRESS      = config.get("device",       "mac_address")
BRIGHTNESS       = config.get("verse_of_day", "brightness")
REFRESH_INTERVAL = config.get("verse_of_day", "refresh_interval")
BACKGROUND       = (0, 0, 0)

FONT_PATH  = os.path.join(os.path.dirname(__file__), "..", "..", "assets", "fonts", "PerfectDOS_VGA_437.ttf")

CROSS_W    = 21
CROSS_BAR  = 5
CROSS_GAP  = 4

BOOK_FONT_SIZE = 14
NUM_FONT_SIZE  = 14
WORD_GAP       = 2

# bolls.life needs book numbers. All 66 books, normalized uppercase, with common variants.
_BOOK_NUMS = {
    "GENESIS": 1, "EXODUS": 2, "LEVITICUS": 3, "NUMBERS": 4, "DEUTERONOMY": 5,
    "JOSHUA": 6, "JUDGES": 7, "RUTH": 8, "1 SAMUEL": 9, "2 SAMUEL": 10,
    "1 KINGS": 11, "2 KINGS": 12, "1 CHRONICLES": 13, "2 CHRONICLES": 14,
    "EZRA": 15, "NEHEMIAH": 16, "ESTHER": 17, "JOB": 18, "PSALMS": 19,
    "PSALM": 19, "PROVERBS": 20, "ECCLESIASTES": 21, "SONG OF SOLOMON": 22,
    "SONG OF SONGS": 22, "ISAIAH": 23, "JEREMIAH": 24, "LAMENTATIONS": 25,
    "EZEKIEL": 26, "DANIEL": 27, "HOSEA": 28, "JOEL": 29, "AMOS": 30,
    "OBADIAH": 31, "JONAH": 32, "MICAH": 33, "NAHUM": 34, "HABAKKUK": 35,
    "ZEPHANIAH": 36, "HAGGAI": 37, "ZECHARIAH": 38, "MALACHI": 39,
    "MATTHEW": 40, "MARK": 41, "LUKE": 42, "JOHN": 43, "ACTS": 44,
    "ROMANS": 45, "1 CORINTHIANS": 46, "2 CORINTHIANS": 47, "GALATIANS": 48,
    "EPHESIANS": 49, "PHILIPPIANS": 50, "COLOSSIANS": 51,
    "1 THESSALONIANS": 52, "2 THESSALONIANS": 53, "1 TIMOTHY": 54,
    "2 TIMOTHY": 55, "TITUS": 56, "PHILEMON": 57, "HEBREWS": 58,
    "JAMES": 59, "1 PETER": 60, "2 PETER": 61, "1 JOHN": 62,
    "2 JOHN": 63, "3 JOHN": 64, "JUDE": 65, "REVELATION": 66,
}

_session = requests.Session()


def _parse_reference(ref: str):
    # "1 CORINTHIANS 13:2" -> ("1 CORINTHIANS", 13, 2, 2)
    # "ROMANS 15:1-2" -> ("ROMANS", 15, 1, 2)
    book, rest = ref.rsplit(" ", 1)
    chapter, verses = rest.split(":")
    if "-" in verses:
        v_from, v_to = verses.split("-", 1)
    else:
        v_from = v_to = verses
    return book, int(chapter), int(v_from), int(v_to)


def fetch_votd() -> dict:
    # OurManna — reference + text, no key. Reference uppercased for the panel.
    r = _session.get(
        "https://beta.ourmanna.com/api/v1/get/",
        params={"format": "json", "order": "daily"},
        timeout=10,
    )
    r.raise_for_status()
    details = r.json()["verse"]["details"]
    return {
        "reference": details["reference"].upper(),
        "text": details["text"],
    }


def fetch_passage(translation: str, reference: str) -> str:
    # translation is "backend:id" — "bibleapi:kjv", "bolls:ESV", etc.
    backend, tr_id = translation.split(":", 1)
    if backend == "bibleapi":
        return _fetch_bibleapi(tr_id, reference)
    if backend == "bolls":
        return _fetch_bolls(tr_id, reference)
    raise ValueError(f"unknown translation backend: {backend}")


def _fetch_bibleapi(tr_id: str, reference: str) -> str:
    url = f"https://bible-api.com/{urllib.parse.quote(reference)}"
    r = _session.get(url, params={"translation": tr_id}, timeout=10)
    r.raise_for_status()
    return r.json()["text"].strip()


def _fetch_bolls(tr_id: str, reference: str) -> str:
    book, chapter, v_from, v_to = _parse_reference(reference)
    num = _BOOK_NUMS.get(book)
    if num is None:
        raise ValueError(f"no book number for {book!r}")
    parts = []
    for v in range(v_from, v_to + 1):
        r = _session.get(
            f"https://bolls.life/get-verse/{tr_id}/{num}/{chapter}/{v}/",
            timeout=10,
        )
        r.raise_for_status()
        parts.append(r.json()["text"].strip())
    return " ".join(parts)


def _natural_font(size: int) -> tuple:
    probe = ImageDraw.Draw(Image.new("RGB", (500, 200)))
    pt = size
    while True:
        font = ImageFont.truetype(FONT_PATH, pt)
        bb = probe.textbbox((0, 0), "A", font=font)
        h = bb[3] - bb[1]
        if h >= size:
            return font, size / h
        pt += 1


def _render_str(text: str, size: int, color: tuple) -> Image.Image:
    font, scale = _natural_font(size)
    probe = ImageDraw.Draw(Image.new("RGB", (500, 200)))
    bb = probe.textbbox((0, 0), text, font=font)
    w, h = bb[2] - bb[0], bb[3] - bb[1]
    tmp = Image.new("RGBA", (max(1, w), max(1, h)), (0, 0, 0, 0))
    ImageDraw.Draw(tmp).text((-bb[0], -bb[1]), text, font=font, fill=color + (255,))
    return tmp.resize((max(1, round(w * scale)), size), Image.NEAREST)


def _text_img(text: str, size: int, color: tuple) -> Image.Image:
    parts = text.split(" ", 1)
    if len(parts) == 2 and parts[0].isdigit():
        a = _render_str(parts[0], size, color)
        b = _render_str(parts[1], size, color)
        out = Image.new("RGBA", (a.width + WORD_GAP + b.width, size), (0, 0, 0, 0))
        out.paste(a, (0, 0), a)
        out.paste(b, (a.width + WORD_GAP, 0), b)
        return out
    return _render_str(text, size, color)


def _truncate(text: str, size: int, max_w: int) -> str:
    font, scale = _natural_font(size)
    probe = ImageDraw.Draw(Image.new("RGB", (500, 200)))

    parts = text.split(" ", 1)
    if len(parts) == 2 and parts[0].isdigit():
        prefix, name = parts
        prefix_w = round((probe.textbbox((0, 0), prefix, font=font)[2] -
                          probe.textbbox((0, 0), prefix, font=font)[0]) * scale) + WORD_GAP
        max_name_w = max_w - prefix_w
        while name:
            bb = probe.textbbox((0, 0), name, font=font)
            if round((bb[2] - bb[0]) * scale) <= max_name_w:
                return f"{prefix} {name}"
            name = name[:-1]
        return prefix

    while text:
        bb = probe.textbbox((0, 0), text, font=font)
        if round((bb[2] - bb[0]) * scale) <= max_w:
            return text
        text = text[:-1]
    return ""


def _draw_cross(draw: ImageDraw.ImageDraw, x: int, display_h: int, color: tuple) -> None:
    v_x = x + CROSS_W // 2 - CROSS_BAR // 2
    h_y = display_h // 3 - CROSS_BAR // 2
    draw.rectangle([v_x, 0, v_x + CROSS_BAR - 1, display_h - 1], fill=color)
    draw.rectangle([x, h_y, x + CROSS_W - 1, h_y + CROSS_BAR - 1], fill=color)


def render_reference(text: str, display_w: int, display_h: int, color: tuple | None = None) -> str:
    color = tuple(color) if color is not None else tuple(config.get("verse_of_day", "color", [125, 40, 125]))
    text_gap = display_h - BOOK_FONT_SIZE - NUM_FONT_SIZE
    if text_gap < 0:
        img  = Image.new("RGB", (display_w, display_h), BACKGROUND)
        sq   = max(2, display_h // 4)
        cx, cy = display_w // 2, display_h // 2
        ImageDraw.Draw(img).rectangle(
            [cx - sq // 2, cy - sq // 2, cx + sq // 2 - 1, cy + sq // 2 - 1],
            fill=(255, 0, 0),
        )
        img = config.apply_orientation(img)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return binascii.hexlify(buf.getvalue()).decode()

    book, numbers = text.rsplit(" ", 1)
    max_text_w = display_w - CROSS_W - CROSS_GAP

    book     = _truncate(book, BOOK_FONT_SIZE, max_text_w)
    book_img = _text_img(book,    BOOK_FONT_SIZE, color)
    num_img  = _text_img(numbers, NUM_FONT_SIZE,  color)

    text_w  = max(book_img.width, num_img.width)
    total_w = CROSS_W + CROSS_GAP + text_w
    start_x = (display_w - total_w) // 2
    text_x  = start_x + CROSS_W + CROSS_GAP

    img  = Image.new("RGB", (display_w, display_h), BACKGROUND)
    draw = ImageDraw.Draw(img)
    _draw_cross(draw, x=start_x, display_h=display_h, color=color)

    num_x = text_x + (book_img.width - num_img.width) // 2
    img.paste(book_img, (text_x, 0), book_img)
    img.paste(num_img,  (num_x, display_h - NUM_FONT_SIZE), num_img)

    img = config.apply_orientation(img)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return binascii.hexlify(buf.getvalue()).decode()


async def run() -> None:
    print("Fetching verse of the day ...")
    votd = fetch_votd()
    print(f"Reference: {votd['reference']}")

    print(f"Connecting to {MAC_ADDRESS} ...")
    async with AsyncClient(MAC_ADDRESS) as client:
        info = client.get_device_info()
        display_w, display_h = info.width, info.height
        print(f"Display: {display_w}x{display_h}")

        frame = render_reference(votd["reference"], display_w, display_h)

        await client.set_brightness(BRIGHTNESS)
        print("Displaying — press Ctrl+C to stop.")
        while True:
            await client.send_image_hex(frame, ".png")
            await asyncio.sleep(REFRESH_INTERVAL)


if __name__ == "__main__":
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        print("\nStopped.")
