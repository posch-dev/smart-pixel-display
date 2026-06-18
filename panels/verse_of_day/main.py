#!/usr/bin/env python3

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import asyncio
import io
import binascii
import requests
from datetime import datetime
from PIL import Image, ImageDraw, ImageFont
from dotenv import load_dotenv
from pypixelcolor import AsyncClient
import assets.system.config as config

MAC_ADDRESS      = config.get("device",       "mac_address")
BRIGHTNESS       = config.get("verse_of_day", "brightness")
REFRESH_INTERVAL = config.get("verse_of_day", "refresh_interval")
BACKGROUND       = (0, 0, 0)

PURPLE     = tuple(config.get("verse_of_day", "color", [125, 40, 125]))
FONT_PATH  = os.path.join(os.path.dirname(__file__), "..", "..", "assets", "fonts", "PerfectDOS_VGA_437.ttf")

CROSS_W    = 21         # odd so center pixel is exact
CROSS_BAR  = 5          # thickness of both bars
CROSS_GAP  = 4          # gap between cross area and text

BOOK_FONT_SIZE = 14     # book name rendered height in pixels
NUM_FONT_SIZE  = 14     # chapter:verse rendered height in pixels
WORD_GAP       = 2      # px between numeric prefix and book name (instead of full space)

BOOK_NAMES = {
    "GEN":"Genesis","EXO":"Exodus","LEV":"Leviticus","NUM":"Numbers","DEU":"Deuteronomy",
    "JOS":"Joshua","JDG":"Judges","RUT":"Ruth","1SA":"1 Samuel","2SA":"2 Samuel",
    "1KI":"1 Kings","2KI":"2 Kings","1CH":"1 Chronicles","2CH":"2 Chronicles",
    "EZR":"Ezra","NEH":"Nehemiah","EST":"Esther","JOB":"Job","PSA":"Psalms",
    "PRO":"Proverbs","ECC":"Ecclesiastes","SNG":"Song of Solomon","ISA":"Isaiah",
    "JER":"Jeremiah","LAM":"Lamentations","EZK":"Ezekiel","DAN":"Daniel",
    "HOS":"Hosea","JOL":"Joel","AMO":"Amos","OBA":"Obadiah","JON":"Jonah",
    "MIC":"Micah","NAM":"Nahum","HAB":"Habakkuk","ZEP":"Zephaniah","HAG":"Haggai",
    "ZEC":"Zechariah","MAL":"Malachi","MAT":"Matthew","MRK":"Mark","LUK":"Luke",
    "JHN":"John","ACT":"Acts","ROM":"Romans","1CO":"1 Corinthians","2CO":"2 Corinthians",
    "GAL":"Galatians","EPH":"Ephesians","PHP":"Philippians","COL":"Colossians",
    "1TH":"1 Thessalonians","2TH":"2 Thessalonians","1TI":"1 Timothy","2TI":"2 Timothy",
    "TIT":"Titus","PHM":"Philemon","HEB":"Hebrews","JAS":"James","1PE":"1 Peter",
    "2PE":"2 Peter","1JN":"1 John","2JN":"2 John","3JN":"3 John","JUD":"Jude",
    "REV":"Revelation",
}


def passage_id_to_reference(passage_id: str) -> str:
    # Convert 'JHN.3.16' → 'JOHN 3:16'.
    parts = passage_id.split(".")
    book = BOOK_NAMES.get(parts[0], parts[0])
    return f"{book} {parts[1]}:{parts[2]}".upper()


def fetch_reference() -> str:
    load_dotenv()
    app_key = os.getenv("YOUVERSION")
    if not app_key:
        raise RuntimeError("YOUVERSION key missing — add it to .env")

    day_of_year = datetime.now().timetuple().tm_yday
    response = requests.get(
        f"https://api.youversion.com/v1/verse_of_the_days/{day_of_year}",
        headers={"X-YVP-App-Key": app_key},
        timeout=10,
    )
    response.raise_for_status()
    passage_id = response.json()["passage_id"]
    return passage_id_to_reference(passage_id)


def _natural_font(size: int) -> tuple:
    # Return (font, scale) where font is the smallest pt that renders 'A' >= size px.
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
    # Render a plain string at natural pt, scaled to `size` px height with NEAREST.
    font, scale = _natural_font(size)
    probe = ImageDraw.Draw(Image.new("RGB", (500, 200)))
    bb = probe.textbbox((0, 0), text, font=font)
    w, h = bb[2] - bb[0], bb[3] - bb[1]
    tmp = Image.new("RGBA", (max(1, w), max(1, h)), (0, 0, 0, 0))
    ImageDraw.Draw(tmp).text((-bb[0], -bb[1]), text, font=font, fill=color + (255,))
    return tmp.resize((max(1, round(w * scale)), size), Image.NEAREST)


def _text_img(text: str, size: int, color: tuple) -> Image.Image:
    # Render with NEAREST scaling. Numeric prefixes like '1 KINGS' get WORD_GAP instead of a full space.
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
    # Trim until it fits within max_w px, accounting for WORD_GAP with numeric prefixes.
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


def _draw_cross(draw: ImageDraw.ImageDraw, x: int, display_h: int) -> None:
    v_x = x + CROSS_W // 2 - CROSS_BAR // 2
    h_y = display_h // 3 - CROSS_BAR // 2
    draw.rectangle([v_x, 0, v_x + CROSS_BAR - 1, display_h - 1], fill=PURPLE)
    draw.rectangle([x, h_y, x + CROSS_W - 1, h_y + CROSS_BAR - 1], fill=PURPLE)


def render_reference(text: str, display_w: int, display_h: int) -> str:
    # Render cross + book name + chapter:verse, centered on the display.
    text_gap = display_h - BOOK_FONT_SIZE - NUM_FONT_SIZE
    if text_gap < 0:
        print(
            f"ERROR: font sizes ({BOOK_FONT_SIZE}px + {NUM_FONT_SIZE}px = "
            f"{BOOK_FONT_SIZE + NUM_FONT_SIZE}px) exceed display height ({display_h}px) — "
            "showing error frame"
        )
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
    book_img = _text_img(book,    BOOK_FONT_SIZE, PURPLE)
    num_img  = _text_img(numbers, NUM_FONT_SIZE,  PURPLE)

    text_w  = max(book_img.width, num_img.width)
    total_w = CROSS_W + CROSS_GAP + text_w
    start_x = (display_w - total_w) // 2
    text_x  = start_x + CROSS_W + CROSS_GAP

    img  = Image.new("RGB", (display_w, display_h), BACKGROUND)
    draw = ImageDraw.Draw(img)
    _draw_cross(draw, x=start_x, display_h=display_h)

    # book snaps to top, numbers centered under book and snapped to bottom
    num_x = text_x + (book_img.width - num_img.width) // 2
    img.paste(book_img, (text_x, 0), book_img)
    img.paste(num_img,  (num_x, display_h - NUM_FONT_SIZE), num_img)

    img = config.apply_orientation(img)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return binascii.hexlify(buf.getvalue()).decode()


async def run() -> None:
    print("Fetching verse of the day ...")
    reference = fetch_reference()
    print(f"Reference: {reference}")

    print(f"Connecting to {MAC_ADDRESS} ...")
    async with AsyncClient(MAC_ADDRESS) as client:
        info = client.get_device_info()
        display_w, display_h = info.width, info.height
        print(f"Display: {display_w}x{display_h}")

        frame = render_reference(reference, display_w, display_h)

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
