#!/usr/bin/env python3

import asyncio
import io
import binascii
import json
import math
import os
import random
import sys
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from PIL import Image, ImageDraw, ImageFont
from pypixelcolor import AsyncClient

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import weather as weather_mod
import calendar_store
import assets.system.config as config

MAC              = config.get("device", "mac_address")
BRIGHTNESS       = config.get("device", "brightness", 50)
BLINK_S          = config.get("clock", "blink_interval", 2.0)
RECONNECT_S      = config.get("device", "reconnect_delay", 3.0)
WEATHER_REFRESH  = 900   # seconds between background fetches (15 min)

_WEATHER_CACHE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".weather_cache.json")
_weather:      dict | None        = None
_weather_task: asyncio.Task | None = None


def _load_weather_cache() -> dict | None:
    try:
        with open(_WEATHER_CACHE_PATH, encoding="utf-8") as f:
            saved = json.load(f)
        if time.time() - saved["fetched_at"] < WEATHER_REFRESH:
            return saved["data"]
    except Exception:
        pass
    return None


def _save_weather_cache(data: dict) -> None:
    try:
        if os.path.exists(_WEATHER_CACHE_PATH):
            os.remove(_WEATHER_CACHE_PATH)
        with open(_WEATHER_CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump({"fetched_at": time.time(), "data": data}, f)
    except Exception as e:
        print(f"[weather] cache write failed: {e}")


async def _weather_fetcher() -> None:
    global _weather
    cached = _load_weather_cache()
    if cached:
        _weather = cached
        print(f"[weather] cache hit: {cached['temp_now']}° {cached['condition']}")
    while True:
        try:
            data = await asyncio.to_thread(weather_mod.fetch_weather)
            _weather = data
            _save_weather_cache(data)
            print(f"[weather] {data['temp_now']}° {data['condition']}")
        except Exception as e:
            print(f"[weather] fetch failed: {e}")
        await asyncio.sleep(WEATHER_REFRESH)


def stop_weather() -> None:
    global _weather_task
    if _weather_task and not _weather_task.done():
        _weather_task.cancel()
        _weather_task = None
        print("[weather] stopped")

W, H     = 128, 32
LOCAL_TZ = ZoneInfo("Europe/Vienna")
BG       = (0, 0, 0)

C_GREEN      = (0, 255, 0)
C_YELLOW     = (255, 200, 0)
C_RED        = (220, 50, 50)
C_WHITE      = (180, 180, 180)
C_LIGHTBLUE  = (100, 190, 255)   # current temp when negative
C_DEEPBLUE   = (40, 80, 220)     # high when negative
C_PURPLE     = (170, 60, 220)    # low when negative
C_ORANGE     = (255, 140, 0)     # NOW! alternating color
C_TURQUOISE  = (0, 200, 180)    # Mode 2 start/end time

_FONTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "fonts")
_DELTARUNE = os.path.join(_FONTS_DIR, "MinecraftStandard.otf")
_MINECRAFT = os.path.join(_FONTS_DIR, "MinecraftStandard.otf")
_IKKLE4    = os.path.join(_FONTS_DIR, "Ikkle4.ttf")
_HAIRPORT  = os.path.join(_FONTS_DIR, "HIAIRP22.ttf")

_cache: dict = {}


def _load(path: str, target_h: int) -> ImageFont.FreeTypeFont:
    key = (path, target_h)
    if key in _cache:
        return _cache[key]
    probe = ImageDraw.Draw(Image.new("RGB", (400, 100)))
    lo, hi = 1, target_h * 3
    while lo < hi:
        mid = (lo + hi + 1) // 2
        font = ImageFont.truetype(path, mid)
        bb = probe.textbbox((0, 0), "0", font=font)
        if bb[3] - bb[1] <= target_h:
            lo = mid
        else:
            hi = mid - 1
    f = ImageFont.truetype(path, lo)
    _cache[key] = f
    return f


def _tw(draw, text, font) -> int:
    bb = draw.textbbox((0, 0), text, font=font)
    return bb[2] - bb[0]

def _th(draw, text, font) -> int:
    bb = draw.textbbox((0, 0), text, font=font)
    return bb[3] - bb[1]

def _put(draw, x, y, text, font, color, sharp=False) -> None:
    bb = draw.textbbox((0, 0), text, font=font)
    gw, gh = bb[2] - bb[0], bb[3] - bb[1]
    if gw <= 0 or gh <= 0:
        return
    mask = Image.new("L", (gw, gh), 0)
    ImageDraw.Draw(mask).text((-bb[0], -bb[1]), text, font=font, fill=255, embedded_color=False)
    if sharp:
        mask = mask.point(lambda p: 255 if p > 0 else 0)
    colored = Image.new("RGB", (gw, gh), color)
    draw._image.paste(colored, (x, y), mask)

def _put_cx(draw, cx, y, text, font, color, sharp=False) -> None:
    _put(draw, cx - _tw(draw, text, font) // 2, y, text, font, color, sharp=sharp)


FONT_H_CLK = 8
COLON_DOT  = 1   # size of hand-drawn colon dots (same style as clock.py)


def _draw_clock(draw: ImageDraw.ImageDraw, now: datetime, colon_on: bool,
                y: int = 0, x_offset: int = 0) -> None:
    font = _load(_DELTARUNE, FONT_H_CLK)
    hh   = f"{now.hour:02d}"
    mm   = f"{now.minute:02d}"

    w_hh  = _tw(draw, hh, font)
    w_mm  = _tw(draw, mm, font)
    col_w = 4
    total = w_hh + col_w + w_mm

    x = x_offset

    _put(draw, x, y, hh, font, C_DEEPBLUE)
    x += w_hh

    if colon_on:
        dot_x   = x + (col_w - COLON_DOT) // 2
        gap     = 1
        total_h = 2 * COLON_DOT + gap
        sq_y    = y + (FONT_H_CLK - total_h) // 2
        s = COLON_DOT - 1
        draw.rectangle([dot_x, sq_y,                    dot_x + s, sq_y + s],                    fill=C_DEEPBLUE)
        draw.rectangle([dot_x, sq_y + COLON_DOT + gap,  dot_x + s, sq_y + COLON_DOT + gap + s],  fill=C_DEEPBLUE)
    x += col_w

    _put(draw, x, y, mm, font, C_DEEPBLUE)


FONT_H_TEMP = 16
FONT_H_HILO = 8
DEG_H       = 4   # height of degree symbol
GAP         = 3   # gap between temp elements


# 4×4 degree symbol, corners 1×1 empty, center 2×2 empty
_DEG_PX = [
    (1,0),(2,0),
    (0,1),(3,1),
    (0,2),(3,2),
    (1,3),(2,3),
]


def _draw_degree(draw: ImageDraw.ImageDraw, x: int, y: int, color) -> None:
    for px, py in _DEG_PX:
        draw.point((x + px, y + py), fill=color)


_ICONS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "icons", "weather_conditions")

_CONDITION_ICON = {
    "clear":         "sunny.png",
    "partly cloudy": "partially_cloudy.png",
    "overcast":      "cloudy.png",
    "rain":          "rainy.png",
    "drizzle":       "rainy.png",
    "thunderstorm":  "lightning.png",
    "fog":           "cloudy.png",
    "snow":          "snowy.png",
    "windy":         "windy.png",
}

_icon_cache: dict = {}


def _load_icon(condition: str) -> Image.Image | None:
    if condition in _icon_cache:
        return _icon_cache[condition]
    filename = _CONDITION_ICON.get(condition)
    icon = None
    if filename:
        path = os.path.join(_ICONS_DIR, filename)
        try:
            icon = Image.open(path).convert("RGBA")
        except Exception as e:
            print(f"[icon] failed to load {path}: {e}")
    _icon_cache[condition] = icon
    return icon


_icon_wiggle  = 0   # 0, 1 or 2 pixel offset from base x
_deg_wiggle_x = 0   # 0 or 1 horizontal pixel offset
_deg_wiggle_y = 0   # 0 or 1 vertical pixel offset (1 = one pixel down)

def _update_icon_wiggle() -> None:
    global _icon_wiggle
    if random.random() < 0.2:
        if _icon_wiggle == 0:
            _icon_wiggle = 1
        elif _icon_wiggle == 1:
            _icon_wiggle = random.choice([0, 2])
        else:
            _icon_wiggle = 1


def _update_deg_wiggle() -> None:
    global _deg_wiggle_x, _deg_wiggle_y
    if random.random() < 0.2:
        if random.random() < 0.5:
            _deg_wiggle_x = 1 - _deg_wiggle_x
        else:
            _deg_wiggle_y = 1 - _deg_wiggle_y


def _draw_weather_icon(img: Image.Image, condition: str, x: int, y: int) -> None:
    icon = _load_icon(condition)
    if icon is None:
        return
    img.paste(icon, (x, y), icon)


_LOGO_DIR   = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "icons")
_logo_cache: dict = {}


def _load_logo(filename: str) -> Image.Image | None:
    if filename in _logo_cache:
        return _logo_cache[filename]
    path = os.path.join(_LOGO_DIR, filename)
    try:
        img = Image.open(path).convert("RGBA")
    except Exception as e:
        print(f"[logo] failed to load {path}: {e}")
        img = None
    _logo_cache[filename] = img
    return img


def _draw_calendar_overlay(img: Image.Image, now: datetime, ix: int, iy: int) -> None:
    draw    = ImageDraw.Draw(img)
    month_s = now.strftime("%b").upper()
    day_s   = str(now.day)

    # Red band: icon px (1,1)..(15,4)  → 15 wide, 4 tall
    f_month = _load(_IKKLE4, 4)
    mbb     = draw.textbbox((0, 0), month_s, font=f_month)
    mw, mh  = mbb[2] - mbb[0], mbb[3] - mbb[1]
    mx = ix + 1 + (15 - mw) // 2
    my = iy + 1 + (4  - mh) // 2
    _put(draw, mx, my, month_s, f_month, C_WHITE)

    # White band: icon px (1,6)..(15,15)  → 15 wide, 10 tall
    f_day  = _load(_HAIRPORT, 5)
    dbb    = draw.textbbox((0, 0), day_s, font=f_day)
    dw, dh = dbb[2] - dbb[0], dbb[3] - dbb[1]
    dx = ix + 1 + (15 - dw) // 2
    dy = iy + 6 + (10 - dh) // 2
    _put(draw, dx, dy, day_s, f_day, C_RED)


def _today_event_info(now: datetime):
    # Returns (has_events, leave_in, leave_time_str, title, start_s, end_s). Mode 3 with travel, mode 2 without.
    GRACE       = timedelta(minutes=20)
    WORTH_IT    = 28   # minutes remaining at arrival to be worth going

    def _end_dt(ev):
        try:
            return datetime.fromisoformat(ev["end_time"]).astimezone(LOCAL_TZ)
        except (ValueError, KeyError):
            return None

    try:
        events = calendar_store.get_events()
        timed = []
        for ev in events:
            if ev.get("is_all_day") or ev.get("isAllDay", False):
                continue
            try:
                ev["_start_dt"] = datetime.fromisoformat(ev["start_time"]).astimezone(LOCAL_TZ)
                timed.append(ev)
            except (ValueError, KeyError):
                pass
        if not timed:
            return False, None, None, None, None, None
        timed.sort(key=lambda e: e["_start_dt"])

        for ev in timed:
            end = _end_dt(ev)

            if end is not None and end < now:
                continue

            leave = calendar_store._leave_dt(ev, LOCAL_TZ)

            if leave is not None:
                # Has travel time → Mode 3 candidate
                if leave + GRACE <= now:
                    continue  # grace expired, skip to next event

                if leave <= now:
                    # Late, only show if arriving is still worth the trip
                    travel_min = ev.get("_travel_minutes") or 0
                    arrival = now + timedelta(minutes=travel_min)
                    if end is not None and (end - arrival) < timedelta(minutes=WORTH_IT):
                        continue  # not worth going, skip to next

                title   = ev.get("title", "")
                leave_in = math.ceil((leave - now).total_seconds() / 60)
                return True, leave_in, leave.strftime("%H:%M"), title, None, None

            else:
                # No travel time → Mode 2
                title   = ev.get("title", "")
                start_s = ev["_start_dt"].strftime("%H:%M")
                end_s   = end.strftime("%H:%M") if end is not None else None
                return True, None, None, title, start_s, end_s

        return False, None, None, None, None, None

    except Exception as e:
        print(f"[calendar] _today_event_info error: {e!r}")
        return False, None, None, None, None, None


def _draw_leave_text(draw, leave_in, leave_time_s, x_center, y,
                     leave_blink_on: bool = True,
                     now_color=C_PURPLE) -> None:
    font = _load(_MINECRAFT, FONT_H_HILO)
    late = leave_in is not None and leave_in <= 0

    if late:
        now_w   = _tw(draw, "NOW", font)
        bang_w  = _tw(draw, "!",   font)
        right_s = f" {abs(leave_in)}"
        right_w = _tw(draw, right_s, font)
        total   = now_w + 1 + bang_w + right_w
        x = x_center - total // 2
        _put(draw, x, y, "NOW", font, now_color);  x += now_w + 1
        _put(draw, x, y, "!",   font, now_color);  x += bang_w
        _put(draw, x, y, right_s, font, C_RED)
    else:
        sp = " "
        hh, mm = leave_time_s.split(":")
        cw    = _tw(draw, ":", font)
        mins  = f"{leave_in / 60:.1f}" if leave_in > 60 else str(leave_in)
        total = (_tw(draw, mins, font) + _tw(draw, sp, font)
                 + _tw(draw, hh, font) + cw + _tw(draw, mm, font))
        x = x_center - total // 2
        if leave_blink_on:
            _put(draw, x, y, mins, font, C_PURPLE)
        x += _tw(draw, mins, font)
        _put(draw, x, y, sp, font, C_RED);  x += _tw(draw, sp, font)
        _put(draw, x, y, hh, font, C_RED);  x += _tw(draw, hh, font)
        dot_x = x + cw // 2 - 1
        draw.point((dot_x, y + 1), fill=C_RED)
        draw.point((dot_x, y + 5), fill=C_RED)
        x += cw
        _put(draw, x, y, mm, font, C_RED)


def _draw_event_title(draw, title, x_left, x_right, y) -> None:
    font = _load(_MINECRAFT, FONT_H_HILO)
    avail = x_right - x_left
    while title and _tw(draw, title, font) > avail:
        title = title[:-1]
    if title:
        _put(draw, x_right - _tw(draw, title, font), y, title, font, C_WHITE)


def _to_display_weather(w: dict) -> dict:
    units = (config.get("dashboard", "weather") or {}).get("units", "metric")
    if units != "imperial":
        return w
    def _c2f(c): return round(c * 9 / 5 + 32)
    return {**w, "temp_now": _c2f(w["temp_now"]),
                 "temp_high": _c2f(w["temp_high"]),
                 "temp_low":  _c2f(w["temp_low"])}


def _draw_temp(draw: ImageDraw.ImageDraw, w: dict, x_offset: int = 0) -> tuple[int, int]:
    f_num = _load(_MINECRAFT, FONT_H_TEMP)
    f8    = _load(_MINECRAFT, FONT_H_HILO)

    temp_s = str(round(w["temp_now"]))
    high_s = str(round(w["temp_high"]))
    low_s  = str(round(w["temp_low"]))

    tw = _tw(draw, temp_s, f_num)
    hw = _tw(draw, high_s, f8)
    lw = _tw(draw, low_s,  f8)

    bb    = draw.textbbox((0, 0), temp_s, f_num)
    bb8   = draw.textbbox((0, 0), high_s, f8)
    h_num = bb[3]  - bb[1]
    h_8   = bb8[3] - bb8[1]

    y_temp = H - h_num          # temp bottom-aligned
    y_low  = H - h_8            # low bottom-aligned
    y_high = y_low  - h_8 - 2   # high directly above low, 2px up total

    x_temp = x_offset
    x_deg  = x_temp + tw - 1   # degree sits at top-right of number
    x_hilo = x_deg  + 4 + GAP

    temp_val = w["temp_now"]
    high_val = w["temp_high"]
    low_val  = w["temp_low"]

    freeze = 32 if (config.get("dashboard", "weather") or {}).get("units", "metric") == "imperial" else 0
    c_temp = C_LIGHTBLUE if temp_val < freeze else C_YELLOW
    c_high = C_DEEPBLUE  if high_val < freeze else C_GREEN
    c_low  = C_PURPLE    if low_val  < freeze else C_RED

    # icon at x_hilo-3 .. x_hilo+10, y_high-15 .. y_high-2 (14×14 px), plus wiggle
    _draw_weather_icon(draw._image, w.get("condition", ""), x_hilo - 3 + _icon_wiggle, y_high - 15)

    _put(draw, x_temp, y_temp, temp_s, f_num, c_temp, sharp=True)
    _draw_degree(draw, x_deg + _deg_wiggle_x, y_temp - 1 + _deg_wiggle_y, c_temp)
    col_cx = x_hilo + max(hw, lw) // 2
    _put(draw, col_cx - hw // 2, y_high, high_s, f8, c_high)
    _put(draw, col_cx - lw // 2, y_low,  low_s,  f8, c_low)
    return x_hilo, x_hilo + max(hw, lw)


def render_frame(now: datetime, w: dict | None, colon_on: bool,
                 leave_blink_on: bool = True, cal_override=None,
                 now_color=C_PURPLE) -> str:
    img  = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    f8  = _load(_MINECRAFT, FONT_H_HILO)
    h_8 = _th(draw, "0", f8)
    y_low  = H - h_8
    y_high = y_low - h_8 - 2
    h_clk  = _th(draw, "0", _load(_DELTARUNE, FONT_H_CLK))
    clk_y  = (y_high - h_clk) // 2

    if cal_override is not None:
        has_events = True
        if len(cal_override) == 5:
            leave_in, leave_time_s, title, ev_start_s, ev_end_s = cal_override
        else:
            leave_in, leave_time_s, title = cal_override
            ev_start_s = ev_end_s = None
    else:
        has_events, leave_in, leave_time_s, title, ev_start_s, ev_end_s = _today_event_info(now)
    has_leave = leave_in is not None

    w_disp   = _to_display_weather(w) if w else None
    x_offset = 0
    x_clock  = 0
    if not has_events and w_disp:
        f_num    = _load(_MINECRAFT, FONT_H_TEMP)
        f_clk    = _load(_DELTARUNE, FONT_H_CLK)
        tw_num   = _tw(draw, str(round(w_disp["temp_now"])), f_num)
        clk_w    = _tw(draw, f"{now.hour:02d}", f_clk) + 4 + _tw(draw, f"{now.minute:02d}", f_clk)
        x_hilo_e = tw_num - 1 + 4 + GAP
        x_offset = max(0, (W - (x_hilo_e + 12)) // 2)
        # shift clock left so it ends before the weather icon (which starts at x_offset + tw_num + 3)
        x_clock  = max(0, x_offset + tw_num + 3 - clk_w)

    _update_icon_wiggle()
    _update_deg_wiggle()

    car = _load_logo("car.png")
    cal = _load_logo("calendar_icon.png")
    half = H // 2

    if has_events:
        if has_leave and car is not None:
            cw, ch = car.size
            img.paste(car, (W - cw + 1, 1), car)
        if cal is not None:
            cw, ch = cal.size
            cal_y = half + (half - ch) // 2 if has_leave else (H - ch) // 2
            img.paste(cal, (W - cw, cal_y), cal)
            _draw_calendar_overlay(img, now, W - cw, cal_y)

    _draw_clock(draw, now, colon_on, y=clk_y, x_offset=x_clock)

    x_hilo = x_hilo_right = None
    if w_disp:
        x_hilo, x_hilo_right = _draw_temp(draw, w_disp, x_offset=x_offset)

    if has_leave and x_hilo is not None and car is not None:
        # Mode 3, leave text at top, title at calendar-icon row
        icon_right = x_hilo + 12
        car_left   = W - car.size[0] + 1
        _draw_leave_text(draw, leave_in, leave_time_s,
                         x_center=(icon_right + car_left) // 2,
                         y=5, leave_blink_on=leave_blink_on, now_color=now_color)
        if title and x_hilo_right is not None and cal is not None:
            cw, ch = cal.size
            cal_y = half + (half - ch) // 2
            _draw_event_title(draw, title,
                              x_left=x_hilo_right + 2,
                              x_right=W - cw - 3,
                              y=cal_y + (ch - h_8) // 2)
    elif has_events and not has_leave and x_hilo is not None and cal is not None:
        # Mode 2, title at top, start to end time at calendar-icon row
        cw_cal, ch_cal = cal.size
        cal_y      = (H - ch_cal) // 2
        icon_right = x_hilo + 12
        cal_left   = W - cw_cal
        x_center   = (icon_right + cal_left) // 2
        font       = _load(_MINECRAFT, FONT_H_HILO)
        if title and x_hilo_right is not None:
            _draw_event_title(draw, title,
                              x_left=x_hilo_right + 2,
                              x_right=W - cw_cal - 3,
                              y=8)
        if ev_start_s:
            time_s = f"{ev_start_s} - {ev_end_s}" if ev_end_s else ev_start_s
            _put_cx(draw, x_center, cal_y + (ch_cal - h_8) // 2 + 5, time_s, font, C_TURQUOISE)

    img = config.apply_orientation(img)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return binascii.hexlify(buf.getvalue()).decode()


_TEST_CONDITIONS = list(_CONDITION_ICON)
_TEST_CAL_CASES = [
    (23,   "15:05", "Gym"),
    (45,   "19:30", "Casino"),
    (-12,  "",      "Call Ex"),
    (90,   "16:02", "Gym"),
    (None, None,    "Gym", "09:00", "10:30"),
]


def _add_clearing_pixel(hex_frame: str) -> str:
    import io as _io, binascii as _bin
    img = Image.open(_io.BytesIO(_bin.unhexlify(hex_frame)))
    img.putpixel((0, H - 1), (0, 0, 255))
    buf = _io.BytesIO()
    img.save(buf, "PNG")
    return _bin.hexlify(buf.getvalue()).decode()


async def run_with_client(client: AsyncClient, clearing=None, ble_lock=None) -> None:
    global _weather_task
    if _weather_task is None or _weather_task.done():
        _weather_task = asyncio.create_task(_weather_fetcher())
    frame_count = 0
    while True:
        t_frame_start  = time.monotonic()
        now            = datetime.now(LOCAL_TZ)
        colon_on       = frame_count % 2 == 0
        leave_blink_on = not colon_on
        now_color      = C_PURPLE if frame_count % 2 == 0 else C_ORANGE
        frame = render_frame(now, _weather, colon_on, leave_blink_on, None, now_color)
        if clearing and clearing[0]:
            frame = _add_clearing_pixel(frame)
        if ble_lock:
            async with ble_lock:
                await asyncio.wait_for(client.send_image_hex(frame, ".png"), timeout=10)
        else:
            await asyncio.wait_for(client.send_image_hex(frame, ".png"), timeout=10)
        frame_count += 1
        elapsed = time.monotonic() - t_frame_start
        await asyncio.sleep(max(0.0, BLINK_S - elapsed))


async def run() -> None:
    global _weather_task
    test_mode = "--test" in sys.argv
    test_idx  = 0
    frame_count = 0

    if test_mode:
        print(f"[display] test mode — cycling weather + {len(_TEST_CAL_CASES)} cal cases")

    if _weather_task is None or _weather_task.done():
        _weather_task = asyncio.create_task(_weather_fetcher())

    while True:
        try:
            print(f"[display] Connecting to {MAC} ...")
            async with AsyncClient(MAC) as client:
                await client.set_brightness(BRIGHTNESS)
                print("[display] Connected.")
                while True:
                    t_frame_start  = time.monotonic()
                    now            = datetime.now(LOCAL_TZ)
                    colon_on       = frame_count % 2 == 0
                    leave_blink_on = not colon_on
                    now_color      = C_PURPLE if frame_count % 2 == 0 else C_ORANGE
                    cal_override   = None

                    if test_mode:
                        condition    = _TEST_CONDITIONS[test_idx % len(_TEST_CONDITIONS)]
                        cal_override = _TEST_CAL_CASES[(test_idx // 10) % len(_TEST_CAL_CASES)]
                        test_idx    += 1
                        w_frame = {
                            "temp_now": 12, "temp_high": 18, "temp_low": 5,
                            "condition": condition,
                        }
                        print(f"[test] {condition} | cal={cal_override}")
                    else:
                        w_frame = _weather

                    await asyncio.wait_for(client.send_image_hex(
                        render_frame(now, w_frame, colon_on, leave_blink_on, cal_override, now_color), ".png"), timeout=10)
                    frame_count += 1
                    elapsed = time.monotonic() - t_frame_start
                    await asyncio.sleep(max(0.0, BLINK_S - elapsed))
        except KeyboardInterrupt:
            print("\n[display] Stopped.")
            return
        except Exception as e:
            print(f"[display] Connection lost: {e!r} — retrying in {RECONNECT_S}s")
            await asyncio.sleep(RECONNECT_S)


if __name__ == "__main__":
    import argparse
    import weather as _w_mod
    p = argparse.ArgumentParser()
    p.add_argument("--lat", type=float, default=None)
    p.add_argument("--lon", type=float, default=None)
    _a = p.parse_args()
    if _a.lat is not None and _a.lon is not None:
        _w_mod.set_location(_a.lat, _a.lon)
        print(f"[config] location set to {_a.lat}, {_a.lon}")
    asyncio.run(run())
