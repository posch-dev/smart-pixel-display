#!/usr/bin/env python3

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import asyncio
import io
import time
import binascii
import requests
from datetime import datetime
from PIL import Image, ImageDraw, ImageFont
import assets.system.config as config
import assets.system.visualize as visualize

MAC_ADDRESS      = config.get("device",       "mac_address")
BRIGHTNESS       = config.get("verse_of_day", "brightness")
REFRESH_INTERVAL = config.get("expert",       "refresh_interval", 30)
BACKGROUND       = (0, 0, 0)

FONT_PATH  = os.path.join(os.path.dirname(__file__), "..", "..", "assets", "fonts", "PerfectDOS_VGA_437.ttf")

CROSS_W    = 21
CROSS_BAR  = 5
CROSS_GAP  = 4

BOOK_FONT_SIZE = 14
NUM_FONT_SIZE  = 14
WORD_GAP       = 2

STATES = [
    ("JOB 3:3",              "short book name"),
    ("PSALMS 23:1",          "medium book name"),
    ("1 THESSALONIANS 5:18", "longest book name, numeric prefix"),
    ("1 CORINTHIANS 13:4",   "numeric prefix, wide chapter"),
    ("ECCLESIASTES 3:1",     "long book, single digits"),
]

_session = requests.Session()


def fetch_votd() -> dict:
    # OurManna: reference + text, no key. Reference uppercased for the panel.
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


async def run(args=None) -> None:
    args = args or visualize.parse()

    if visualize.canned(args) or args.offline:
        reference = STATES[0][0]
        print(f"Reference: {reference} (canned)")
    else:
        print("Fetching verse of the day ...")
        reference = fetch_votd()["reference"]
        print(f"Reference: {reference}")

    print(f"[{visualize.tag()}] connecting to {MAC_ADDRESS} ...")
    async with visualize.client(MAC_ADDRESS, args, "verse_of_day") as client:
        info = client.get_device_info()
        display_w, display_h = info.width, info.height
        print(f"Display: {display_w}x{display_h}")

        await client.set_brightness(BRIGHTNESS)
        print("Displaying, press Ctrl+C to stop.")
        started = time.monotonic()
        while True:
            if visualize.canned(args):
                index, (reference, note) = visualize.state_at(STATES, started)
                visualize.label(f"{index + 1}/{len(STATES)}  {reference}  {note}", "verse_of_day")
            frame = render_reference(reference, display_w, display_h)
            await client.send_image_hex(frame, ".png")
            await asyncio.sleep(visualize.STATE_S if visualize.canned(args) else REFRESH_INTERVAL)


if __name__ == "__main__":
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        print("\nStopped.")
