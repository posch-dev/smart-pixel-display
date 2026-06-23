#!/usr/bin/env python3

import asyncio
import binascii
import datetime
import io
import os
import sys
import time
import tempfile

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

import dns_patch          # patch DNS before any HTTP calls  # noqa: F401
import poller
import display
import assets.system.config as config
import assets.system.webhooks as webhooks
from pypixelcolor import AsyncClient
from PIL import Image

MAC      = config.get("device",     "mac_address")
SLOT_A   = config.get("nowplaying", "slot_a")
SLOT_B   = config.get("nowplaying", "slot_b")
CHUNK_S  = config.get("nowplaying", "chunk_s")
PREP_S   = 8      # start preparing next chunk this many seconds before switch
LAST_10  = 10     # if ≤ this many seconds remain, let current song finish
MAX_REPS = 2      # same (title, artist) more than this many times → ignored
POLL_S   = config.get("nowplaying", "poll_s")

def _black_hex() -> str:
    img = Image.new("RGB", (128, 32), (0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return binascii.hexlify(buf.getvalue()).decode()

_BLACK_HEX = _black_hex()


def _ts() -> str:
    return datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]


def _other(slot: int) -> int:
    return SLOT_B if slot == SLOT_A else SLOT_A


def _beat_chunk_s(bpm: int | None, target_s: float = CHUNK_S) -> float:
    if not bpm:
        return target_s
    gif_s = (60.0 / bpm) * 2          # GIF = frames_per_beat * 2 at FRAME_MS
    loops = max(1, round(target_s / gif_s))
    return gif_s * loops


async def _send_black(client: AsyncClient) -> None:
    await client.send_image_hex(_BLACK_HEX, ".png")


async def _upload(client: AsyncClient, state: dict, slot: int, quick: bool = False,
                  ble_lock: asyncio.Lock | None = None) -> None:
    t0 = time.monotonic()
    label = " [quick]" if quick else ""
    print(f"{_ts()} [main] rendering GIF{label}  elapsed={state['elapsed_s']:.0f}s ...")
    loop = asyncio.get_running_loop()
    gif = await loop.run_in_executor(None, display.generate_gif, state, quick)
    t1 = time.monotonic()
    print(f"{_ts()} [main] render done ({t1-t0:.1f}s, {len(gif)//1024}KB) — uploading to slot {slot} ...")
    path = os.path.join(tempfile.gettempdir(), f"nowplaying_{slot}.gif")
    with open(path, "wb") as f:
        f.write(gif)
    if ble_lock:
        async with ble_lock:
            await client.send_image(path, save_slot=slot)
    else:
        await client.send_image(path, save_slot=slot)
    print(f"{_ts()} [main] slot {slot} ready ({time.monotonic()-t1:.1f}s upload)")


async def _safe_delete(client: AsyncClient, slot: int, ble_lock: asyncio.Lock | None = None) -> None:
    try:
        if ble_lock:
            async with ble_lock:
                await client.delete(slot)
        else:
            await client.delete(slot)
    except (asyncio.TimeoutError, OSError):
        pass


async def _black_keepalive(client: AsyncClient, ble_lock: asyncio.Lock | None = None) -> None:
    while True:
        if ble_lock:
            async with ble_lock:
                await _send_black(client)
        else:
            await _send_black(client)
        await asyncio.sleep(1.0)


async def _cancel_task(t: asyncio.Task | None) -> None:
    if t and not t.done():
        t.cancel()
        try:
            await t
        except (asyncio.CancelledError, Exception):
            pass


async def run_loop(client: AsyncClient, initial_black: bool = True, brightness: int | None = None,
                   ble_lock: asyncio.Lock | None = None) -> None:
    font_n = config.get("nowplaying", "font", 3)
    display.set_font(font_n)

    if initial_black:
        if ble_lock:
            async with ble_lock:
                await _send_black(client)
        else:
            await _send_black(client)
        print(f"{_ts()} [main] black screen active")

    _brightness_applied = False
    active_slot:      int | None          = None
    standby_slot:     int | None          = None
    standby_task:     asyncio.Task | None = None
    standby_elapsed:  float               = 0.0
    standby_song:     tuple | None        = None

    current_song:     tuple | None = None
    next_song:        tuple | None = None
    next_song_state:  dict | None  = None

    chunk_start_mono: float = 0.0
    chunk_elapsed_s:  float = 0.0
    displayed_song:   tuple | None = None
    current_chunk_s:  float = CHUNK_S
    switch_on_ready:  bool  = False
    active_bpm:       int | None = None

    play_counts:      dict  = {}
    last_counted:     tuple | None = None
    nothing_since:    float | None = None

    black_task:       asyncio.Task | None = None

    NOTHING_DEBOUNCE = 5.0

    try:
        while True:
            now   = time.monotonic()
            state = poller.get_state()

            if state["playing"] and state["title"] and state["artist"]:
                raw_key: tuple | None = (state["title"], state["artist"])
            else:
                raw_key = None

            if raw_key and raw_key != last_counted:
                cnt = play_counts.get(raw_key, 0) + 1
                play_counts[raw_key] = cnt
                last_counted = raw_key
                if cnt > MAX_REPS:
                    print(f"{_ts()} [main] '{raw_key[0]}' played {cnt}× — ignoring")

            song_key: tuple | None = (
                raw_key if raw_key and play_counts.get(raw_key, 0) <= MAX_REPS else None
            )

            if song_key is not None:
                nothing_since = None

            elapsed  = state.get("elapsed_s") or 0.0
            duration = state.get("duration_s") or 9999.0
            in_last  = elapsed >= duration - LAST_10

            if song_key is None:
                if nothing_since is None:
                    nothing_since = now
                if now - nothing_since < NOTHING_DEBOUNCE:
                    await asyncio.sleep(POLL_S)
                    continue
                if next_song is not None and not state["playing"]:
                    print(f"{_ts()} [main] current expired — promoting: {next_song[1]} — {next_song[0]}")
                    current_song    = next_song
                    chunk_elapsed_s = 0.0
                    next_song       = None
                    next_song_state = None
                    switch_on_ready = True
                    # Fall through to execute the switch

                elif current_song is not None:
                    print(f"{_ts()} [main] nothing playing")
                    await _cancel_task(standby_task)
                    standby_task = None
                    await _safe_delete(client, ble_lock=ble_lock, slot=SLOT_A)
                    await _safe_delete(client, ble_lock=ble_lock, slot=SLOT_B)
                    active_slot     = None
                    standby_slot    = None
                    current_song    = None
                    next_song       = None
                    next_song_state = None
                    switch_on_ready = False
                    if black_task is None or black_task.done():
                        black_task = asyncio.create_task(_black_keepalive(client, ble_lock))
                    await asyncio.sleep(POLL_S)
                    continue

                else:
                    if black_task is None or black_task.done():
                        black_task = asyncio.create_task(_black_keepalive(client, ble_lock))
                    await asyncio.sleep(POLL_S)
                    continue

            if black_task and not black_task.done():
                black_task.cancel()
                black_task = None

            if song_key is not None and song_key != current_song and song_key != next_song:

                if in_last and current_song is not None:
                    print(f"{_ts()} [main] last {LAST_10}s, queuing: {state['artist']} — {state['title']}")
                    ns = dict(state)
                    ns["elapsed_s"] = 0.0
                    next_song       = song_key
                    next_song_state = ns
                    if standby_task is None or standby_task.done():
                        if standby_task and not standby_task.cancelled():
                            standby_task.cancel()
                        tgt = _other(active_slot) if active_slot else SLOT_A
                        standby_slot    = tgt
                        standby_task    = asyncio.create_task(_upload(client, ns, tgt, ble_lock=ble_lock))
                        standby_elapsed = 0.0
                        standby_song    = song_key
                        switch_on_ready = False

                else:
                    # Immediate switch (let old slot keep playing until new is ready)
                    bpm = state.get("bpm")
                    current_chunk_s = _beat_chunk_s(bpm)
                    quick = bpm is None
                    print(f"{_ts()} [main] new song: {state['artist']} — {state['title']}  bpm={bpm}  chunk={current_chunk_s:.1f}s")
                    if standby_task and not standby_task.done():
                        standby_task.cancel()
                    ns = dict(state)
                    ns["elapsed_s"] = 0.0
                    tgt = _other(active_slot) if active_slot else SLOT_A
                    standby_slot    = tgt
                    standby_task    = asyncio.create_task(_upload(client, ns, tgt, quick=quick, ble_lock=ble_lock))
                    standby_elapsed = 0.0
                    standby_song    = song_key
                    switch_on_ready = True
                    current_song    = song_key
                    next_song       = None
                    next_song_state = None
                    chunk_elapsed_s = 0.0
                    active_bpm      = bpm

            if switch_on_ready and standby_task is not None and standby_task.done():
                if standby_task.cancelled() or standby_task.exception() is not None:
                    exc = standby_task.exception() if not standby_task.cancelled() else None
                    if exc is not None:
                        print(f"{_ts()} [main] upload failed: {exc}")
                        raise exc
                    standby_task    = None
                    switch_on_ready = False
                elif standby_song == current_song:
                    print(f"{_ts()} [main] switching to slot {standby_slot}")
                    if ble_lock:
                        async with ble_lock:
                            await client.show_slot(standby_slot)
                            if brightness is not None and not _brightness_applied:
                                await client.set_brightness(brightness)
                                _brightness_applied = True
                    else:
                        await client.show_slot(standby_slot)
                        if brightness is not None and not _brightness_applied:
                            await client.set_brightness(brightness)
                            _brightness_applied = True
                    song_changed     = displayed_song != current_song
                    displayed_song   = current_song
                    old              = active_slot
                    active_slot      = standby_slot
                    standby_slot     = _other(active_slot)
                    chunk_start_mono = now
                    chunk_elapsed_s  = standby_elapsed
                    switch_on_ready  = False
                    standby_task     = None
                    standby_song     = None
                    active_bpm       = state.get("bpm")
                    if old is not None:
                        await _safe_delete(client, ble_lock=ble_lock, slot=old)
                    if song_changed:
                        accents = display.last_accents or ((0,0,0),(0,0,0),(0,0,0))
                        asyncio.create_task(webhooks.fire("nowplaying", "on_song_change", {
                            "title": state.get("title", ""),
                            "artist": state.get("artist", ""),
                            "album": state.get("album", ""),
                            "accent1": accents[0],
                            "accent2": accents[1],
                            "accent3": accents[2],
                        }))

            if (active_slot is not None
                    and current_song == song_key
                    and active_bpm is None
                    and state.get("bpm") is not None
                    and standby_task is None
                    and not in_last):
                bpm = state["bpm"]
                current_chunk_s = _beat_chunk_s(bpm)
                print(f"{_ts()} [main] BPM arrived ({bpm}) — re-rendering")
                ns = dict(state)
                ns["elapsed_s"] = chunk_elapsed_s
                tgt = _other(active_slot)
                standby_slot    = tgt
                standby_task    = asyncio.create_task(_upload(client, ns, tgt, ble_lock=ble_lock))
                standby_elapsed = chunk_elapsed_s
                standby_song    = song_key
                switch_on_ready = True

            if active_slot is not None and current_song == song_key and not in_last:
                time_in_chunk      = now - chunk_start_mono
                next_chunk_elapsed = chunk_elapsed_s + current_chunk_s

                if (time_in_chunk >= current_chunk_s - PREP_S
                        and standby_task is None
                        and next_chunk_elapsed < duration - LAST_10):
                    ns = dict(state)
                    ns["elapsed_s"] = next_chunk_elapsed
                    tgt = _other(active_slot)
                    print(f"{_ts()} [main] preparing chunk elapsed={next_chunk_elapsed:.0f}s → slot {tgt}")
                    standby_slot    = tgt
                    standby_task    = asyncio.create_task(_upload(client, ns, tgt, ble_lock=ble_lock))
                    standby_elapsed = next_chunk_elapsed
                    standby_song    = song_key

                if (time_in_chunk >= current_chunk_s
                        and standby_task is not None
                        and standby_task.done()
                        and not standby_task.cancelled()
                        and standby_task.exception() is None
                        and standby_song == current_song):
                    print(f"{_ts()} [main] chunk boundary → slot {standby_slot}")
                    if ble_lock:
                        async with ble_lock:
                            await client.show_slot(standby_slot)
                            if brightness is not None and not _brightness_applied:
                                await client.set_brightness(brightness)
                                _brightness_applied = True
                    else:
                        await client.show_slot(standby_slot)
                        if brightness is not None and not _brightness_applied:
                            await client.set_brightness(brightness)
                            _brightness_applied = True
                    old              = active_slot
                    active_slot      = standby_slot
                    standby_slot     = _other(active_slot)
                    chunk_start_mono = now
                    chunk_elapsed_s  = standby_elapsed
                    standby_task     = None
                    standby_song     = None
                    if old is not None:
                        await _safe_delete(client, ble_lock=ble_lock, slot=old)

            new_font = config.get("nowplaying", "font", 3)
            if new_font != font_n:
                font_n = new_font
                display.set_font(font_n)

            await asyncio.sleep(POLL_S)

    finally:
        await _cancel_task(black_task)
        await _cancel_task(standby_task)


async def main() -> None:
    poller.start()
    print(f"{_ts()} [main] NowPlaying starting — connecting to {MAC}")

    while True:
        try:
            async with AsyncClient(MAC) as client:
                print(f"{_ts()} [main] BLE connected")
                await client.set_brightness(80)
                await run_loop(client)
        except KeyboardInterrupt:
            print("\n[main] stopped")
            return
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"{_ts()} [main] BLE error: {e} — reconnecting in 5s")
            await asyncio.sleep(5)


if __name__ == "__main__":
    asyncio.run(main())
