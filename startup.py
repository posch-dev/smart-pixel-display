import asyncio
import importlib.util
import signal
import io
import os
import sys
import json
import glob
import threading
import binascii
import time
from datetime import datetime, timedelta
from PIL import Image, ImageDraw
from pypixelcolor import AsyncClient

import assets.system.config as config
import assets.system.log as log
from assets.system.version import VERSION
import assets.system.scheduler as scheduler
import assets.system.api as api
import assets.system.webhooks as webhooks
import assets.system.visualize as visualize
from panels.clock.main import DISPLAY_W, DISPLAY_H, render_frame, STATES as _CLOCK_STATES
from panels.verse_of_day.main import (fetch_votd, render_reference,
                                      FONT_PATH as _VERSE_FONT_PATH, STATES as _VERSE_STATES)

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
import calendar_store
from panels.now_playing.main import (run_loop as np_run_loop, use_canned_songs,
                                     advance_canned_songs, CANNED_CHUNK_S, CANNED_DWELL_S)

MAC_ADDRESS     = config.get("device", "mac_address")
DIRECT_CONNECT  = config.get("device", "direct_connect", False)
RECONNECT_DELAY = config.get("expert", "reconnect_delay", 5)
MAX_SLOTS       = 256
BLE_SEND_TIMEOUT = 5
_CLOCK_TICK     = 0.5

_all_states     = False
_offline        = False
_states_started = 0.0


def _ble_target():
    # A plain address makes bleak scan first, which fails while the display holds a
    # stale link and stops advertising. The device object skips straight to bluez.
    if not DIRECT_CONNECT:
        return MAC_ADDRESS
    from bleak.backends.device import BLEDevice
    addr = MAC_ADDRESS.upper()
    details = {"path": "/org/bluez/hci0/dev_" + addr.replace(":", "_"), "props": {}}
    try:
        return BLEDevice(addr, None, details)
    except TypeError:
        return BLEDevice(addr, None, details, -127)


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
        log.info("hours", f"outside active hours ({ah[0]}-{ah[1]}), "
                          f"waiting {secs//3600}h {(secs%3600)//60}m ...")
        await config.wait_for_change(timeout=min(secs, 60))

_VERSE_CACHE_DIR  = os.path.join(os.path.dirname(__file__), "panels", "verse_of_day")
_VERSE_CACHE_GLOB = os.path.join(_VERSE_CACHE_DIR, ".verse_cache_*.json")
_VERSE_CACHE_SCHEMA = 3
_verse_frame:     str | None = None
_verse_cache_key: str | None = None
_verse_reference: str | None = None
_verse_text:      str | None = None


def _verse_key() -> str:
    color       = str(config.get("verse_of_day", "color", [125, 40, 125]))
    brightness  = str(max(1, config.get("verse_of_day", "brightness", 100)))
    flip_v      = str(config.get("device", "flip_vertical",   False))
    flip_h      = str(config.get("device", "flip_horizontal", False))
    font        = os.path.basename(_VERSE_FONT_PATH)
    translation = str(config.get("verse_of_day", "translation", "bibleapi:kjv"))
    return f"{datetime.now().strftime('%Y-%m-%d')}|{translation}|{color}|{brightness}|{flip_v}|{flip_h}|{font}"

def _verse_cache_path() -> str:
    return os.path.join(_VERSE_CACHE_DIR, f".verse_cache_{datetime.now().strftime('%Y-%m-%d')}.json")

def _purge_old_verse_caches() -> None:
    today = datetime.now().strftime("%Y-%m-%d")
    for f in glob.glob(_VERSE_CACHE_GLOB):
        if today not in f:
            try:
                os.remove(f)
                log.debug("verse", f"removed old cache: {os.path.basename(f)}")
            except OSError:
                pass

def get_verse_frame() -> str | None:
    global _verse_frame, _verse_cache_key, _verse_reference, _verse_text
    key = _verse_key()
    if _verse_frame and _verse_cache_key == key:
        return _verse_frame
    _purge_old_verse_caches()
    cache_path = _verse_cache_path()
    cached: dict = {}
    if os.path.exists(cache_path):
        try:
            with open(cache_path, encoding="utf-8") as f:
                cached = json.load(f)
        except Exception as e:
            log.warn("verse", f"cache read failed: {e}")
            cached = {}
    if cached.get("schema") != _VERSE_CACHE_SCHEMA:
        cached = {}
    try:
        reference = cached.get("reference")
        ourmanna_text = cached.get("text")
        if reference is None:
            log.info("verse", "fetching ...")
            votd = fetch_votd()
            reference = votd["reference"]
            ourmanna_text = votd["text"]
        color = tuple(config.get("verse_of_day", "color", [125, 40, 125]))
        _verse_frame = render_reference(reference, DISPLAY_W, DISPLAY_H, color=color)
        _verse_cache_key = key
        _verse_reference = reference
        _verse_text = ourmanna_text
        cached.update({
            "schema": _VERSE_CACHE_SCHEMA,
            "reference": reference,
            "text": ourmanna_text,
            "key": key,
            "frame": _verse_frame,
        })
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(cached, f, ensure_ascii=False)
        log.info("verse", f"rendered: {reference}")
    except Exception as e:
        log.error("verse", f"render failed: {e}")
        _verse_frame = _verse_cache_key = None
    return _verse_frame


def get_verse_data() -> dict | None:
    # Reference and translation only, the browser fetches the passage it wants to show.
    if _verse_reference is None:
        get_verse_frame()
    if _verse_reference is None:
        return None
    return {
        "reference": _verse_reference,
        "translation": config.get("verse_of_day", "translation", "bibleapi:kjv"),
    }


def _black_frame() -> str:
    img = Image.new("RGB", (DISPLAY_W, DISPLAY_H), (0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return binascii.hexlify(buf.getvalue()).decode()

_BLACK = _black_frame()


def _mode_color_ctx(mode: str) -> dict | None:
    color = config.get(mode, "color")
    if isinstance(color, (list, tuple)) and len(color) == 3:
        return {"accent1": tuple(color)}
    return None

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
    last_sent = None
    while True:
        blink_interval = config.get("clock", "blink_interval", 1.0)
        if _all_states:
            index, (hour, minute, note) = visualize.state_at(_CLOCK_STATES, _states_started)
            visualize.label(f"{index + 1}/{len(_CLOCK_STATES)}  {hour}:{minute}  {note}", "clock")
        else:
            now = datetime.now()
            hour = f"{now.hour:02d}"
            minute = f"{now.minute:02d}"
        if blink_interval == 0:
            colon_on = True
        else:
            colon_on = int(time.time() / blink_interval) % 2 == 0
        triple = (hour, minute, colon_on)
        if triple != last_sent:
            frame = render_frame(hour, minute, colon_on)
            if clearing[0]:
                frame = _add_clearing_pixel(frame)
            async with ble_lock:
                await asyncio.wait_for(client.send_image_hex(frame, ".png"), timeout=BLE_SEND_TIMEOUT)
            last_sent = triple
        await asyncio.sleep(_CLOCK_TICK)


async def _verse_task(client: AsyncClient, ble_lock: asyncio.Lock, clearing: list) -> None:
    last_fired_reference = None
    while True:
        refresh = config.get("expert", "refresh_interval", 30)
        if _all_states:
            index, (reference, note) = visualize.state_at(_VERSE_STATES, _states_started)
            visualize.label(f"{index + 1}/{len(_VERSE_STATES)}  {reference}  {note}", "verse_of_day")
            frame   = render_reference(reference, DISPLAY_W, DISPLAY_H)
            refresh = visualize.STATE_S
        elif _offline:
            frame = render_reference(_VERSE_STATES[0][0], DISPLAY_W, DISPLAY_H)
        else:
            frame = await asyncio.to_thread(get_verse_frame)
        if frame:
            if _verse_reference and _verse_reference != last_fired_reference:
                last_fired_reference = _verse_reference
                color = tuple(config.get("verse_of_day", "color", [125, 40, 125]))
                asyncio.create_task(webhooks.fire(
                    "verse_of_day", "on_verse_change",
                    {"reference": _verse_reference, "text": _verse_text or "", "accent1": color},
                ))
            if clearing[0]:
                frame = _add_clearing_pixel(frame)
            brightness = _get_active_brightness("verse_of_day")
            async with ble_lock:
                await asyncio.wait_for(client.send_image_hex(frame, ".png"), timeout=BLE_SEND_TIMEOUT)
                await asyncio.wait_for(client.set_brightness(brightness), timeout=BLE_SEND_TIMEOUT)
        await config.wait_for_change(timeout=refresh)


async def _nowplaying_task(client: AsyncClient, ble_lock: asyncio.Lock, clearing: list) -> None:
    visualize.label("", "nowplaying")
    brightness = _get_active_brightness("nowplaying")
    await np_run_loop(client, initial_black=False, brightness=brightness, ble_lock=ble_lock)


async def _dashboard_task(client: AsyncClient, ble_lock: asyncio.Lock, clearing: list) -> None:
    await md_display.run_with_client(client, clearing, ble_lock, all_states=_all_states)


async def _nowplaying_watcher() -> None:
    _not_playing_ticks = 0
    _STOP_DEBOUNCE     = 5  # consecutive not-playing polls before untriggering
    while True:
        if not scheduler.get_display_on() or not _is_active_hour() or not api.is_ready():
            await asyncio.sleep(1)
            continue
        state = np_poller.get_state()
        is_playing = bool(state.get("playing") and state.get("title"))
        if is_playing:
            _not_playing_ticks = 0
            if not scheduler.is_triggered("nowplaying") and not scheduler.has_user_trigger():
                scheduler.trigger("nowplaying", source="auto")
                log.info("watcher", "music detected, switching to nowplaying")
        elif scheduler.is_triggered("nowplaying") and not scheduler.has_user_trigger():
            _not_playing_ticks += 1
            if _not_playing_ticks >= _STOP_DEBOUNCE:
                scheduler.untrigger("nowplaying")
                log.info("watcher", "music stopped, switching to clock")
                _not_playing_ticks = 0
        else:
            _not_playing_ticks = 0
        await asyncio.sleep(1)


async def _dashboard_event_watcher() -> None:
    triggered_keys: set = set()
    while True:
        if not scheduler.get_display_on() or not _is_active_hour():
            await asyncio.sleep(60)
            continue

        if not config.get("dashboard", "auto_trigger_before_event", False):
            triggered_keys.clear()
            await asyncio.sleep(60)
            continue

        hours_before = config.get("dashboard", "hours_before_event", 2.0)
        grace_min = config.get("dashboard", "grace_minutes", 10)
        now = datetime.now().astimezone()

        any_active = False
        events = calendar_store.get_events()
        for ev in events:
            if ev.get("is_all_day") or ev.get("isAllDay", False):
                continue
            try:
                start_dt = datetime.fromisoformat(ev["start_time"]).astimezone()
            except (ValueError, KeyError):
                continue

            travel = ev.get("_travel_minutes")
            departure = start_dt - timedelta(minutes=travel) if travel else start_dt
            trigger_at = departure - timedelta(hours=hours_before)
            grace_end = departure + timedelta(minutes=grace_min)

            ev_key = (ev.get("title", ""), ev.get("start_time", ""))

            if trigger_at <= now < grace_end:
                any_active = True
                triggered_keys.add(ev_key)
                if not scheduler.has_user_trigger():
                    scheduler.trigger("dashboard", source="auto")
                    log.info("events", f"dashboard triggered: {ev.get('title', '?')} "
                                       f"(departs {departure.strftime('%H:%M')})")
                break

        if not any_active and triggered_keys:
            scheduler.untrigger("dashboard")
            triggered_keys.clear()
            log.info("events", "grace expired, dashboard untriggered")

        await asyncio.sleep(60)


async def _cancel(task: asyncio.Task | None, lock: asyncio.Lock | None = None) -> None:
    if not task or task.done():
        return
    # cancelling into a send in flight leaves the device halfway through a frame,
    # and it eats whatever command is written next
    if lock:
        async with lock:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            except Exception as e:
                log.error("mode", f"panel task raised while cancelling: {e!r}")
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    except Exception as e:
        log.error("mode", f"panel task raised while cancelling: {e!r}")

async def _all_states_walk() -> None:
    # triggers each panel in turn through the real scheduler, so the switch is tested too
    global _states_started
    import panels.now_playing.display as _np_display   # read only, the panel keeps its own copy
    spans = {
        "clock":        len(_CLOCK_STATES)     * visualize.STATE_S,
        "verse_of_day": len(_VERSE_STATES)     * visualize.STATE_S,
        "dashboard":    len(md_display.STATES) * md_display.STATE_S,
    }
    # nowplaying renders and uploads per song, so it says itself when it is through
    np_backstop = len(_np_display.STATES) * (CANNED_CHUNK_S + CANNED_DWELL_S) * 3
    for mode in scheduler.MODES:
        config.override(mode, "enabled", True)
    while True:
        for mode in scheduler.MODES:
            _states_started = time.monotonic()
            scheduler.trigger(mode)
            if mode == "nowplaying":
                log.info("states", f"{mode}, {len(_np_display.STATES)} songs at the panel's own pace")
                try:
                    await asyncio.wait_for(advance_canned_songs(), timeout=np_backstop)
                except asyncio.TimeoutError:
                    log.warn("states", "nowplaying did not get through its songs, moving on")
            else:
                log.info("states", f"{mode}, {spans[mode]:.0f}s")
                await asyncio.sleep(spans[mode])
            scheduler.untrigger(mode)


async def run(args=None) -> None:
    global _all_states, _offline, _states_started
    args     = args or visualize.parse()
    _offline = args.offline
    config.init_event(asyncio.get_running_loop())
    if visualize.canned(args):
        _all_states     = True
        _states_started = time.monotonic()
        use_canned_songs(args.offline)
        asyncio.create_task(_all_states_walk())
    elif _offline:
        # canned everywhere, so the service still behaves without keys or a network
        use_canned_songs(True)
        md_display._weather = md_display._MILD
    else:
        asyncio.get_event_loop().run_in_executor(None, get_verse_frame)
    if not _offline:
        np_poller.start()
    asyncio.create_task(_nowplaying_watcher())
    asyncio.create_task(_dashboard_event_watcher())

    # Clear stale triggers, the web UI may re-send them on restart
    for _m in scheduler.MODES:
        scheduler.untrigger(_m)

    _ever_connected = False
    _disconnect_at: float | None = None
    _tick_task: asyncio.Task | None = None
    _clear_task: asyncio.Task | None = None
    _last_mode: str | None = None
    FRESH_CONNECT_THRESHOLD = 120

    # With active_hours set the schedule already decides, so this only applies to always-on setups.
    _boot_powered_off = config.get("device", "start_powered_off", False) and _active_hours() is None
    if _boot_powered_off:
        scheduler.set_display_on(False)
        log.info("power", "starting powered off, waiting for manual power on")

    while True:
        await _wait_for_active_hour()

        try:
            log.info(visualize.tag(), f"connecting to {MAC_ADDRESS} ...")
            api.set_reconnect(attempting=True)
            async with visualize.client(_ble_target(), args, "startup") as client:
                api.set_connected(True)
                api.set_reconnect()

                ble_lock = asyncio.Lock()
                clearing = [True]
                last_brightness_sent = -1
                brightness_asserts = 0

                need_clear = (not _ever_connected
                              or _disconnect_at is None
                              or time.time() - _disconnect_at >= FRESH_CONNECT_THRESHOLD)

                await _cancel(_tick_task)
                await _cancel(_clear_task)

                if need_clear:
                    async def clear_slots():
                        api.set_clearing(True)
                        log.info(visualize.tag(), "clearing slots ...")
                        deadline = asyncio.get_running_loop().time() + 60
                        for slot in range(MAX_SLOTS):
                            if asyncio.get_running_loop().time() > deadline:
                                log.warn("ble", f"clearing timed out at slot {slot}, giving up")
                                break
                            try:
                                async with ble_lock:
                                    await asyncio.wait_for(client.delete(slot), timeout=2.0)
                            except asyncio.TimeoutError:
                                log.warn("ble", f"slot {slot} delete timed out, skipping")
                            except Exception as e:
                                log.warn("ble", f"slot {slot} delete error: {e}, skipping")
                        clearing[0] = False
                        api.set_clearing(False)
                        log.info(visualize.tag(), "slots cleared")
                    _clear_task = asyncio.create_task(clear_slots())
                else:
                    clearing[0] = False
                    log.info(visualize.tag(), "quick reconnect, skipping slot clear")

                _ever_connected = True
                _disconnect_at = None

                async def tick_loop():
                    while True:
                        scheduler.tick()
                        await asyncio.sleep(1)

                _tick_task = asyncio.create_task(tick_loop())

                current_mode: str | None = None
                _last_mode = None
                mode_task:    asyncio.Task | None = None
                _np_blocked_logged = False

                def _out_of_hours() -> bool:
                    return not _is_active_hour() and not scheduler.get_active_hours_override()

                while True:
                    if scheduler.get_active_hours_override() and _is_active_hour():
                        # Active hours arrived naturally while a manual after-hours override was in effect, drop it so a future active-hours end auto-blacks normally again.
                        scheduler.set_active_hours_override(False)
                        scheduler.cancel_sleep_timer()

                    if not scheduler.get_display_on():
                        if current_mode:
                            asyncio.create_task(webhooks.fire(current_mode, "on_exit", _mode_color_ctx(current_mode)))
                        await _cancel(mode_task, ble_lock)
                        mode_task = current_mode = None
                        last_brightness_sent = -1
                        brightness_asserts = 0
                        np_poller.pause()
                        md_display.stop_weather()
                        async with ble_lock:
                            await asyncio.wait_for(client.send_image_hex(_BLACK, ".png"), timeout=BLE_SEND_TIMEOUT)
                        if _boot_powered_off:
                            _boot_powered_off = False   # boot black never turned anything off
                        else:
                            # Outside active hours this off/on toggle is an override session ending/starting,
                            # so it gets the active_* triggers instead of the normal power_* ones.
                            asyncio.create_task(webhooks.fire_device("on_power_off" if _is_active_hour() else "on_active_end"))
                        log.info("power", "display off, black screen")
                        _black_ts = time.time()
                        while not scheduler.get_display_on():
                            await asyncio.sleep(0.5)
                            if time.time() - _black_ts >= 15 * 60:
                                async with ble_lock:
                                    await asyncio.wait_for(client.send_image_hex(_BLACK, ".png"), timeout=BLE_SEND_TIMEOUT)
                                _black_ts = time.time()
                        np_poller.resume()
                        asyncio.create_task(webhooks.fire_device("on_power_on" if _is_active_hour() else "on_active_start"))
                        log.info("power", "display on, resuming")
                        continue

                    if _out_of_hours():
                        if current_mode:
                            asyncio.create_task(webhooks.fire(current_mode, "on_exit", _mode_color_ctx(current_mode)))
                        await _cancel(mode_task, ble_lock)
                        mode_task = current_mode = None
                        last_brightness_sent = -1
                        brightness_asserts = 0
                        np_poller.pause()
                        md_display.stop_weather()
                        async with ble_lock:
                            await asyncio.wait_for(client.send_image_hex(_BLACK, ".png"), timeout=BLE_SEND_TIMEOUT)
                        # Silent, mirrors the manual power switch state for the UI without firing on_power_off (on_active_end already covers this transition).
                        scheduler.set_display_on(False)
                        asyncio.create_task(webhooks.fire_device("on_active_end"))
                        log.info("hours", "black screen, grace period (2min)")
                        _grace_start = time.time()
                        while _out_of_hours() and time.time() - _grace_start < 120:
                            await asyncio.sleep(10)
                            if _out_of_hours():
                                async with ble_lock:
                                    await asyncio.wait_for(client.send_image_hex(_BLACK, ".png"), timeout=BLE_SEND_TIMEOUT)
                        if _out_of_hours():
                            log.info("hours", "grace period done, sleeping")
                            _black_ah_ts = time.time()
                            while _out_of_hours():
                                await config.wait_for_change(timeout=3)
                                if _out_of_hours() and time.time() - _black_ah_ts >= 15 * 60:
                                    async with ble_lock:
                                        await asyncio.wait_for(client.send_image_hex(_BLACK, ".png"), timeout=BLE_SEND_TIMEOUT)
                                    _black_ah_ts = time.time()
                        np_poller.resume()
                        if _is_active_hour():
                            scheduler.set_display_on(True)
                            scheduler.set_active_hours_override(False)
                            scheduler.cancel_sleep_timer()
                            asyncio.create_task(webhooks.fire_device("on_active_start"))
                            log.info("hours", "active hours resumed")
                        else:
                            asyncio.create_task(webhooks.fire_device("on_active_start"))
                            log.info("hours", "manually turned on outside active hours, resuming display")
                        continue

                    mode = scheduler.get_active_mode()
                    if mode == "nowplaying" and clearing[0]:
                        if not _np_blocked_logged:
                            log.debug("mode", "nowplaying waiting for slot clear ...")
                            _np_blocked_logged = True
                        await asyncio.sleep(0.5)
                        continue
                    if _np_blocked_logged and not clearing[0]:
                        _np_blocked_logged = False

                    if mode_task and mode_task.done() and not mode_task.cancelled():
                        exc = mode_task.exception()
                        if exc is not None:
                            if current_mode:
                                asyncio.create_task(webhooks.fire(current_mode, "on_exit", _mode_color_ctx(current_mode)))
                                _last_mode = None
                            raise exc

                    if mode != current_mode or (mode_task and mode_task.done()):
                        if current_mode and current_mode != mode:
                            await webhooks.fire(current_mode, "on_exit", _mode_color_ctx(current_mode))
                        await _cancel(mode_task, ble_lock)
                        prev_mode = current_mode
                        current_mode = mode
                        _last_mode = mode
                        last_brightness_sent = -1
                        brightness_asserts = 2
                        log.info("mode", f"switching to {mode} ({scheduler.source_of(mode)})")
                        if not _all_states:
                            visualize.label(f"live, triggered by {scheduler.source_of(mode)}", mode)
                        if mode != prev_mode:
                            async def _delayed_enter(m, ctx):
                                await asyncio.sleep(0.5)
                                await webhooks.fire(m, "on_enter", ctx)
                            asyncio.create_task(_delayed_enter(mode, _mode_color_ctx(mode)))

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
                        # once before the panel draws and once after, the first frame of a
                        # new mode lands between them and clock and dashboard never re-assert
                        if eff != last_brightness_sent or brightness_asserts:
                            async with ble_lock:
                                await client.set_brightness(eff)
                            last_brightness_sent = eff
                            brightness_asserts = max(0, brightness_asserts - 1)

                    await asyncio.sleep(0.5)

        except KeyboardInterrupt:
            log.info("service", "stopped by keyboard interrupt")
            return
        except Exception as e:
            api.set_connected(False)
            if _last_mode:
                asyncio.create_task(webhooks.fire(_last_mode, "on_exit", _mode_color_ctx(_last_mode)))
                _last_mode = None
            if _disconnect_at is None:
                _disconnect_at = time.time()
            log.error(visualize.tag(), f"connection lost: {e}")
            log.info(visualize.tag(), f"retrying in {RECONNECT_DELAY}s ...")
            api.set_reconnect(at=time.time() + RECONNECT_DELAY)
            await asyncio.sleep(RECONNECT_DELAY)


def _on_sigterm(signum, frame) -> None:
    log.info("service", "sigterm received, shutting down")
    sys.exit(0)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(parents=[visualize.flags()])
    parser.add_argument("--debug",        action="store_true", help="verbose log")
    args = parser.parse_args()

    if args.debug or config.get("expert", "debug_log", False):
        log.set_debug(True)
    signal.signal(signal.SIGTERM, _on_sigterm)
    port   = int(os.environ.get("PORT", config.get("expert", "port", 12832)))
    panels = ", ".join(m for m in scheduler.MODES if config.get(m, "enabled", False)) or "none"
    api.bind_runtime(sys.modules[__name__])
    threading.Thread(target=api.run, kwargs={"port": port}, daemon=True).start()
    log.info("service", f"smart pixel display {VERSION} starting, panels: {panels}")
    log.info("web", f"web ui on http://0.0.0.0:{port}")
    try:
        asyncio.run(run(args))
    except KeyboardInterrupt:
        log.info("service", "stopped by keyboard interrupt")
