import asyncio
import importlib.util
import io
import os
import sys
import json
import glob
import threading
import binascii
import time
from datetime import datetime
from PIL import Image, ImageDraw
from pypixelcolor import AsyncClient

import assets.system.config as config
import assets.system.scheduler as scheduler
import assets.system.api as api
from panels.clock.main import DISPLAY_W, DISPLAY_H, render_frame
from panels.verse_of_day.main import fetch_reference, render_reference, FONT_PATH as _VERSE_FONT_PATH

_MD_DIR = os.path.join(os.path.dirname(__file__), "panels", "dashboard")
_NP_DIR = os.path.join(os.path.dirname(__file__), "panels", "now_playing")

sys.path.insert(0, _NP_DIR)
sys.path.insert(0, _MD_DIR)

_md_spec = importlib.util.spec_from_file_location(
    "dashboard_display", os.path.join(_MD_DIR, "display.py")
)
md_display = importlib.util.module_from_spec(_md_spec)
_md_spec.loader.exec_module(md_display)

import poller  as np_poller
from panels.now_playing.main import run_loop as np_run_loop

MAC_ADDRESS     = config.get("device", "mac_address")
RECONNECT_DELAY = config.get("device", "reconnect_delay")
BLINK_INTERVAL  = config.get("clock",  "blink_interval")
MAX_SLOTS       = 256


def _ts() -> str:
    return datetime.now().strftime("%H:%M:%S.%f")[:-3]

def _active_hours():
    ah = config.get("device", "active_hours")
    return (int(ah[0]), int(ah[1])) if ah and len(ah) == 2 else None

def _is_active_hour() -> bool:
    ah = _active_hours()
    return True if ah is None else ah[0] <= datetime.now().hour < ah[1]

async def _wait_for_active_hour() -> None:
    while not _is_active_hour():
        ah = _active_hours()
        now = datetime.now()
        secs = ((ah[0] - now.hour) % 24) * 3600 - now.minute * 60 - now.second
        secs = max(secs, 60)
        print(f"{_ts()} [hours] Outside active hours ({ah[0]}–{ah[1]}). "
              f"Waiting {secs//3600}h {(secs%3600)//60}m ...")
        await asyncio.sleep(min(secs, 60))

_VERSE_CACHE_DIR  = os.path.join(os.path.dirname(__file__), "panels", "verse_of_day")
_VERSE_CACHE_GLOB = os.path.join(_VERSE_CACHE_DIR, ".verse_cache_*.json")
_verse_frame:     str | None = None
_verse_cache_key: str | None = None


def _verse_key() -> str:
    color      = str(config.get("verse_of_day", "color", [125, 40, 125]))
    brightness = str(max(1, config.get("verse_of_day", "brightness", 100)))
    flip_v     = str(config.get("device", "flip_vertical",   False))
    flip_h     = str(config.get("device", "flip_horizontal", False))
    font       = os.path.basename(_VERSE_FONT_PATH)
    return f"{datetime.now().strftime('%Y-%m-%d')}|{color}|{brightness}|{flip_v}|{flip_h}|{font}"

def _verse_cache_path(key: str) -> str:
    return os.path.join(_VERSE_CACHE_DIR, f".verse_cache_{key.split('|')[0]}.json")

def _purge_old_verse_caches() -> None:
    today = datetime.now().strftime("%Y-%m-%d")
    for f in glob.glob(_VERSE_CACHE_GLOB):
        if today not in f:
            try:
                os.remove(f)
                print(f"{_ts()} [verse] Removed old cache: {os.path.basename(f)}")
            except OSError:
                pass

def get_verse_frame() -> str | None:
    global _verse_frame, _verse_cache_key
    key = _verse_key()
    if _verse_frame and _verse_cache_key == key:
        return _verse_frame
    _purge_old_verse_caches()
    cache_path = _verse_cache_path(key)
    if os.path.exists(cache_path):
        try:
            with open(cache_path, encoding="utf-8") as f:
                saved = json.load(f)
            if saved.get("key") == key:
                _verse_frame = saved["frame"]
                _verse_cache_key = key
                print(f"{_ts()} [verse] Loaded from file cache.")
                return _verse_frame
        except Exception:
            pass
    try:
        print(f"{_ts()} [verse] Fetching + rendering ...")
        reference    = fetch_reference()
        _verse_frame = render_reference(reference, DISPLAY_W, DISPLAY_H)
        _verse_cache_key = key
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump({"key": key, "frame": _verse_frame}, f)
        print(f"{_ts()} [verse] Cached: {reference}")
    except Exception as e:
        print(f"{_ts()} [verse] Render failed: {e}")
        _verse_frame = _verse_cache_key = None
    return _verse_frame


def _black_frame() -> str:
    img = Image.new("RGB", (DISPLAY_W, DISPLAY_H), (0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return binascii.hexlify(buf.getvalue()).decode()

_BLACK = _black_frame()

def _add_clearing_pixel(hex_frame: str) -> str:
    img = Image.open(io.BytesIO(binascii.unhexlify(hex_frame)))
    img.putpixel((0, DISPLAY_H - 1), (0, 0, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return binascii.hexlify(buf.getvalue()).decode()

def _get_active_brightness(mode: str) -> int:
    if config.get(mode, "use_global_brightness", False):
        return max(1, config.get("device", "brightness", 50))
    return max(1, config.get(mode, "brightness", 50))


async def _clock_task(client: AsyncClient, ble_lock: asyncio.Lock, clearing: list) -> None:
    colon_on = True
    hour, minute = "", ""
    while True:
        if colon_on:
            now    = datetime.now()
            hour   = f"{now.hour:02d}"
            minute = f"{now.minute:02d}"
        frame = render_frame(hour, minute, colon_on)
        if clearing[0]:
            frame = _add_clearing_pixel(frame)
        async with ble_lock:
            await client.send_image_hex(frame, ".png")
        colon_on = not colon_on
        await asyncio.sleep(BLINK_INTERVAL)


async def _verse_task(client: AsyncClient, ble_lock: asyncio.Lock, clearing: list) -> None:
    refresh = config.get("verse_of_day", "refresh_interval", 30)
    while True:
        frame = get_verse_frame()
        if frame:
            if clearing[0]:
                frame = _add_clearing_pixel(frame)
            async with ble_lock:
                await client.send_image_hex(frame, ".png")
        await asyncio.sleep(refresh)


async def _nowplaying_task(client: AsyncClient, ble_lock: asyncio.Lock, clearing: list) -> None:
    brightness = _get_active_brightness("nowplaying")
    await np_run_loop(client, initial_black=False, brightness=brightness)


async def _dashboard_task(client: AsyncClient, ble_lock: asyncio.Lock, clearing: list) -> None:
    await md_display.run_with_client(client, clearing, ble_lock)


async def _nowplaying_watcher() -> None:
    _not_playing_ticks = 0
    _STOP_DEBOUNCE     = 5  # consecutive not-playing polls before untriggering
    while True:
        state = np_poller.get_state()
        is_playing = bool(state.get("playing") and state.get("title"))
        if is_playing:
            _not_playing_ticks = 0
            if not scheduler.is_triggered("nowplaying") and not scheduler.has_user_trigger():
                scheduler.trigger("nowplaying", source="auto")
                print(f"{_ts()} [watcher] music detected → NowPlaying")
        elif scheduler.is_triggered("nowplaying") and not scheduler.has_user_trigger():
            _not_playing_ticks += 1
            if _not_playing_ticks >= _STOP_DEBOUNCE:
                scheduler.untrigger("nowplaying")
                print(f"{_ts()} [watcher] music stopped → clock")
                _not_playing_ticks = 0
        else:
            _not_playing_ticks = 0
        await asyncio.sleep(1)


async def _cancel(task: asyncio.Task | None) -> None:
    if task and not task.done():
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass

async def run() -> None:
    asyncio.get_event_loop().run_in_executor(None, get_verse_frame)
    np_poller.start()
    asyncio.create_task(_nowplaying_watcher())

    # Clear stale triggers, the web UI may re-send them on restart
    for _m in scheduler.MODES:
        if _m != "clock":
            scheduler.untrigger(_m)

    while True:
        await _wait_for_active_hour()

        try:
            print(f"{_ts()} Connecting to {MAC_ADDRESS} ...")
            async with AsyncClient(MAC_ADDRESS) as client:
                api.set_connected(True)

                ble_lock = asyncio.Lock()
                clearing = [True]   # mutable so tasks can observe it
                last_brightness_sent = -1

                async def clear_slots():
                    api.set_clearing(True)
                    print(f"{_ts()} Clearing slots ...")
                    deadline = asyncio.get_running_loop().time() + 60
                    for slot in range(MAX_SLOTS):
                        if asyncio.get_running_loop().time() > deadline:
                            print(f"{_ts()} Clearing timed out at slot {slot}, giving up.")
                            break
                        try:
                            async with ble_lock:
                                await asyncio.wait_for(client.delete(slot), timeout=2.0)
                        except asyncio.TimeoutError:
                            print(f"{_ts()} Slot {slot} delete timed out, skipping.")
                        except Exception as e:
                            print(f"{_ts()} Slot {slot} delete error: {e}, skipping.")
                    clearing[0] = False
                    api.set_clearing(False)
                    print(f"{_ts()} Slots cleared.")

                async def tick_loop():
                    while True:
                        scheduler.tick()
                        await asyncio.sleep(1)

                asyncio.create_task(clear_slots())
                asyncio.create_task(tick_loop())

                current_mode: str | None = None
                mode_task:    asyncio.Task | None = None
                _np_blocked_logged = False

                while True:
                    if not scheduler.get_display_on():
                        await _cancel(mode_task)
                        mode_task = current_mode = None
                        last_brightness_sent = -1
                        async with ble_lock:
                            await client.send_image_hex(_BLACK, ".png")
                        print(f"{_ts()} [power] Display off — black screen.")
                        _black_ts = time.time()
                        while not scheduler.get_display_on():
                            await asyncio.sleep(0.5)
                            if time.time() - _black_ts >= 15 * 60:
                                async with ble_lock:
                                    await client.send_image_hex(_BLACK, ".png")
                                _black_ts = time.time()
                        print(f"{_ts()} [power] Display on — resuming.")
                        continue

                    if not _is_active_hour():
                        await _cancel(mode_task)
                        mode_task = current_mode = None
                        last_brightness_sent = -1
                        async with ble_lock:
                            await client.send_image_hex(_BLACK, ".png")
                        print(f"{_ts()} [hours] Black screen.")
                        await asyncio.sleep(30)
                        async with ble_lock:
                            await client.send_image_hex(_BLACK, ".png")
                        while not _is_active_hour():
                            await asyncio.sleep(15 * 60)
                            async with ble_lock:
                                await client.send_image_hex(_BLACK, ".png")
                            await asyncio.sleep(30)
                            async with ble_lock:
                                await client.send_image_hex(_BLACK, ".png")
                        print(f"{_ts()} [hours] Active hours resumed.")
                        continue

                    mode = scheduler.get_active_mode()
                    if mode == "nowplaying" and clearing[0]:
                        if not _np_blocked_logged:
                            print(f"{_ts()} [mode] nowplaying waiting for slot clear ...")
                            _np_blocked_logged = True
                        await asyncio.sleep(0.5)
                        continue
                    if _np_blocked_logged and not clearing[0]:
                        _np_blocked_logged = False

                    if mode != current_mode or (mode_task and mode_task.done()):
                        await _cancel(mode_task)
                        current_mode = mode
                        last_brightness_sent = -1
                        print(f"{_ts()} [mode] → {mode}")

                        if mode == "clock":
                            mode_task = asyncio.create_task(
                                _clock_task(client, ble_lock, clearing))
                        elif mode == "verse_of_day":
                            mode_task = asyncio.create_task(
                                _verse_task(client, ble_lock, clearing))
                        elif mode == "nowplaying":
                            mode_task = asyncio.create_task(
                                _nowplaying_task(client, ble_lock, clearing))
                        elif mode == "dashboard":
                            mode_task = asyncio.create_task(
                                _dashboard_task(client, ble_lock, clearing))
                        else:
                            mode_task = asyncio.create_task(
                                _clock_task(client, ble_lock, clearing))

                    if current_mode != "nowplaying":
                        eff = _get_active_brightness(current_mode or "clock")
                        if eff != last_brightness_sent:
                            async with ble_lock:
                                await client.set_brightness(eff)
                            last_brightness_sent = eff

                    await asyncio.sleep(0.5)

        except KeyboardInterrupt:
            print("\nStopped.")
            return
        except Exception as e:
            api.set_connected(False)
            print(f"{_ts()} Connection lost: {e}")
            print(f"{_ts()} Retrying in {RECONNECT_DELAY}s ...")
            await asyncio.sleep(RECONNECT_DELAY)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", config.get("server", "port", 5000)))
    threading.Thread(target=api.run, kwargs={"port": port}, daemon=True).start()
    print(f"Web UI: http://0.0.0.0:{port}")
    asyncio.run(run())
