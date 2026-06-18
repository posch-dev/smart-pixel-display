#!/usr/bin/env python3

import asyncio
import io
import os
import sys
import binascii
from datetime import datetime
from PIL import Image, ImageDraw, ImageFont
from pypixelcolor import AsyncClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
import assets.system.config as config

DISPLAY_W = 128
DISPLAY_H = 32

MAC_ADDRESS     = config.get("device", "mac_address")
BRIGHTNESS      = config.get("clock",  "brightness")
BLINK_INTERVAL  = config.get("clock",  "blink_interval")
RECONNECT_DELAY = config.get("device", "reconnect_delay")

FONT_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "assets", "fonts", "SevenSegment.ttf")
FONT_SIZE = 32  # rendered digit height in pixels (auto-scaled to match)

DIGIT_AREA_W = 21  # pixel width reserved per digit
COLON_AREA_W = 10  # pixel width reserved for the colon

COLON_DOT_SIZE = 3  # side length of each dot square in pixels

TEXT_COLOR  = tuple(config.get("clock", "color", [0, 255, 0]))
BACKGROUND  = (0, 0, 0)


_font_cache: ImageFont.FreeTypeFont | None = None

def _load_font() -> ImageFont.FreeTypeFont:
    # Binary-search for the point size that renders digits at exactly FONT_SIZE pixels tall.
    global _font_cache
    if _font_cache is not None:
        return _font_cache
    probe = ImageDraw.Draw(Image.new("RGB", (500, 200)))
    lo, hi = 1, FONT_SIZE * 2
    while lo < hi:
        mid = (lo + hi + 1) // 2
        font = ImageFont.truetype(FONT_PATH, mid)
        bbox = probe.textbbox((0, 0), "0", font=font)
        if bbox[3] - bbox[1] <= FONT_SIZE:
            lo = mid
        else:
            hi = mid - 1
    _font_cache = ImageFont.truetype(FONT_PATH, lo)
    return _font_cache


def _draw_digit(draw: ImageDraw.ImageDraw, font: ImageFont.FreeTypeFont,
                digit: str, area_x: int) -> None:
    # Draw a single digit centered within its DIGIT_AREA_W × DISPLAY_H slot.
    bbox   = draw.textbbox((0, 0), digit, font=font)
    char_w = bbox[2] - bbox[0]
    char_h = bbox[3] - bbox[1]
    x = area_x + (DIGIT_AREA_W - char_w) // 2 - bbox[0]
    y = (DISPLAY_H - char_h) // 2 - bbox[1]
    draw.text((x, y), digit, font=font, fill=TEXT_COLOR)


def _draw_colon(draw: ImageDraw.ImageDraw, area_x: int, visible: bool) -> None:
    # Draw two fixed 3×3 dots at 1/3 and 2/3 of display height, centered in the colon area.
    if not visible:
        return
    dot_x = area_x + (COLON_AREA_W - COLON_DOT_SIZE) // 2
    top_y  = DISPLAY_H // 3 - COLON_DOT_SIZE // 2
    bot_y  = 2 * DISPLAY_H // 3 - COLON_DOT_SIZE // 2
    s = COLON_DOT_SIZE - 1  # inclusive end offset
    draw.rectangle([dot_x, top_y, dot_x+s, top_y+s], fill=TEXT_COLOR)
    draw.rectangle([dot_x, bot_y, dot_x+s, bot_y+s], fill=TEXT_COLOR)


def render_frame(hour: str, minute: str, show_colon: bool) -> str:
    font = _load_font()
    img  = Image.new("RGB", (DISPLAY_W, DISPLAY_H), BACKGROUND)
    draw = ImageDraw.Draw(img)

    total_w  = 4 * DIGIT_AREA_W + COLON_AREA_W
    h1_x     = (DISPLAY_W - total_w) // 2
    h2_x     = h1_x + DIGIT_AREA_W
    colon_x  = h2_x + DIGIT_AREA_W
    m1_x     = colon_x + COLON_AREA_W
    m2_x     = m1_x + DIGIT_AREA_W

    _draw_digit(draw, font, hour[0],   h1_x)
    _draw_digit(draw, font, hour[1],   h2_x)
    _draw_colon(draw, colon_x, show_colon)
    _draw_digit(draw, font, minute[0], m1_x)
    _draw_digit(draw, font, minute[1], m2_x)

    img = config.apply_orientation(img)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return binascii.hexlify(buf.getvalue()).decode()


async def run() -> None:
    colon_on = True
    hour, minute = "", ""

    while True:
        try:
            print(f"Connecting to {MAC_ADDRESS} ...")
            async with AsyncClient(MAC_ADDRESS) as client:
                print("Connected.")
                await client.set_brightness(BRIGHTNESS)

                while True:
                    if colon_on:
                        now    = datetime.now()
                        hour   = f"{now.hour:02d}"
                        minute = f"{now.minute:02d}"

                    await client.send_image_hex(render_frame(hour, minute, colon_on), ".png")
                    colon_on = not colon_on
                    await asyncio.sleep(BLINK_INTERVAL)

        except KeyboardInterrupt:
            print("\nStopped.")
            return
        except Exception as error:
            print(f"Connection lost: {error}")
            print(f"Retrying in {RECONNECT_DELAY}s ...")
            await asyncio.sleep(RECONNECT_DELAY)


if __name__ == "__main__":
    asyncio.run(run())
