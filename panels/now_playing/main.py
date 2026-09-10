#!/usr/bin/env python3

import asyncio
import binascii
import io
import os
import sys
import time
import tempfile

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

import poller
import display
import assets.system.config as config
import assets.system.log as log
import assets.system.webhooks as webhooks
import assets.system.visualize as visualize
from pypixelcolor import AsyncClient
from PIL import Image

MAC      = config.get("device",     "mac_address")
SLOT_A   = config.get("expert", "slot_a", 1)
SLOT_B   = config.get("expert", "slot_b", 2)
CHUNK_S  = config.get("expert", "chunk_s", 20)
PREP_S   = 8      # start preparing next chunk this many seconds before switch
LAST_10  = 10     # if <= this many seconds remain, let current song finish
MAX_REPS   = 2      # same (title, artist) more than this many times -> ignored
COVER_WAIT = 7.0    # seconds to wait for cover before rendering with placeholder
IDLE_SLEEP = 1.0    # seconds to sleep when idle (nothing playing, waiting)
CANNED_CHUNK_S = 7.0    # chunk length while walking canned songs, so eleven of them do not take four minutes
CANNED_DWELL_S = 4.0    # and how long a song stays up once it is visible

on_song_shown = None    # set by use_canned_songs, called when a new song reaches the screen

def _black_hex() -> str:
    img = Image.new("RGB", (128, 32), (0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return binascii.hexlify(buf.getvalue()).decode()

_BLACK_HEX = _black_hex()


def _other(slot: int) -> int:
    return SLOT_B if slot == SLOT_A else SLOT_A


def _beat_chunk_s(bpm: int | None, target_s: float | None = None) -> float:
    target_s = CHUNK_S if target_s is None else target_s
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
    log.info("nowplaying", f"rendering gif{label}  elapsed={state['elapsed_s']:.0f}s ...")
    loop = asyncio.get_running_loop()
    gif = await loop.run_in_executor(None, display.generate_gif, state, quick)
    t1 = time.monotonic()
    log.info("nowplaying", f"render done ({t1-t0:.1f}s, {len(gif)//1024}KB), uploading to slot {slot} ...")
    path = os.path.join(tempfile.gettempdir(), f"nowplaying_{slot}.gif")
    with open(path, "wb") as f:
        f.write(gif)
    if ble_lock:
        async with ble_lock:
            await client.send_image(path, save_slot=slot)
    else:
        await client.send_image(path, save_slot=slot)
    log.info("nowplaying", f"slot {slot} ready ({time.monotonic()-t1:.1f}s upload)")


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
        except asyncio.CancelledError:
            pass
        except Exception as e:
            log.error("nowplaying", f"task raised while cancelling: {e!r}")


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
        log.info("nowplaying", "black screen active")

    _brightness_applied = False
    active_slot:      int | None          = None
    standby_slot:     int | None          = None
    standby_task:     asyncio.Task | None = None
    standby_elapsed:  float               = 0.0
    standby_song:     tuple | None        = None

    current_song:     tuple | None = None
    next_song:        tuple | None = None
    next_song_state:  dict | None  = None
    next_cover_wait_since: float | None = None

    chunk_start_mono: float = 0.0
    chunk_elapsed_s:  float = 0.0
    displayed_song:   tuple | None = None
    current_chunk_s:  float = CHUNK_S
    switch_on_ready:  bool  = False
    active_bpm:        int | None = None
    active_cover:      bool       = False
    cover_wait_since:  float | None = None
    cover_arrived_late: bool      = False

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
                if len(play_counts) > 25:
                    play_counts.clear()
                cnt = play_counts.get(raw_key, 0) + 1
                play_counts[raw_key] = cnt
                last_counted = raw_key
                if cnt > MAX_REPS:
                    log.info("nowplaying", f"'{raw_key[0]}' played {cnt} times, ignoring")

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
                    await asyncio.sleep(IDLE_SLEEP)
                    continue
                if next_song is not None and not state["playing"] and (
                        standby_task is not None and standby_task.done()):
                    log.info("nowplaying", f"current expired, promoting: {next_song[1]} - {next_song[0]}")
                    current_song          = next_song
                    chunk_elapsed_s       = 0.0
                    next_song             = None
                    next_song_state       = None
                    next_cover_wait_since = None
                    switch_on_ready       = True
                    # Fall through to execute the switch

                elif next_song is not None and not state["playing"]:
                    # Upcoming song's render isn't ready yet, keep showing the current slot until the resolution check below finishes it.
                    pass

                elif current_song is not None:
                    log.info("nowplaying", "nothing playing")
                    await _cancel_task(standby_task)
                    standby_task = None
                    await _safe_delete(client, ble_lock=ble_lock, slot=SLOT_A)
                    await _safe_delete(client, ble_lock=ble_lock, slot=SLOT_B)
                    active_slot     = None
                    standby_slot    = None
                    current_song     = None
                    next_song        = None
                    next_song_state  = None
                    switch_on_ready  = False
                    cover_wait_since = None
                    if black_task is None or black_task.done():
                        black_task = asyncio.create_task(_black_keepalive(client, ble_lock))
                    await asyncio.sleep(IDLE_SLEEP)
                    continue

                else:
                    if black_task is None or black_task.done():
                        black_task = asyncio.create_task(_black_keepalive(client, ble_lock))
                    await asyncio.sleep(IDLE_SLEEP)
                    continue

            if black_task and not black_task.done():
                black_task.cancel()
                black_task = None

            if song_key is not None and song_key != current_song and song_key != next_song:

                if in_last and current_song is not None:
                    log.info("nowplaying", f"last {LAST_10}s, upcoming: {state['artist']} - {state['title']}, waiting for cover ...")
                    ns = dict(state)
                    ns["elapsed_s"] = 0.0
                    next_song             = song_key
                    next_song_state       = ns
                    next_cover_wait_since = now

                else:
                    log.info("nowplaying", f"new song: {state['artist']} - {state['title']}, waiting for cover ...")
                    if standby_task and not standby_task.done():
                        standby_task.cancel()
                    standby_task          = None
                    current_song          = song_key
                    next_song             = None
                    next_song_state       = None
                    next_cover_wait_since = None
                    chunk_elapsed_s       = 0.0
                    cover_wait_since      = now
                    cover_arrived_late    = False

            # Keep the queued song's known state fresh, in particular its cover, for as long as Last.fm still reports it as playing.
            if next_song is not None and song_key == next_song:
                ns = dict(state)
                ns["elapsed_s"] = 0.0
                next_song_state = ns

            if (next_cover_wait_since is not None and next_song is not None
                    and (standby_task is None or standby_task.done())):
                ns_has_cover = bool(next_song_state and next_song_state.get("cover") is not None)
                waited       = now - next_cover_wait_since
                if ns_has_cover or waited >= COVER_WAIT:
                    if ns_has_cover:
                        log.info("nowplaying", f"upcoming cover arrived after {waited:.1f}s, queuing render")
                    else:
                        log.info("nowplaying", f"no cover after {COVER_WAIT}s for upcoming song, queuing placeholder render")
                    if standby_task and not standby_task.cancelled():
                        standby_task.cancel()
                    tgt = _other(active_slot) if active_slot else SLOT_A
                    standby_slot          = tgt
                    standby_task          = asyncio.create_task(_upload(client, next_song_state, tgt, ble_lock=ble_lock))
                    standby_elapsed       = 0.0
                    standby_song          = next_song
                    switch_on_ready       = False
                    next_cover_wait_since = None

            if cover_wait_since is not None and current_song == song_key:
                has_cover = state.get("cover") is not None
                waited    = now - cover_wait_since
                if has_cover or waited >= COVER_WAIT:
                    if has_cover:
                        log.info("nowplaying", f"cover arrived after {waited:.1f}s, rendering")
                    else:
                        log.info("nowplaying", f"no cover after {COVER_WAIT}s, rendering placeholder")
                    state = poller.get_state()
                    bpm = state.get("bpm")
                    current_chunk_s = _beat_chunk_s(bpm)
                    quick = bpm is None
                    ns = dict(state)
                    ns["elapsed_s"] = 0.0
                    tgt = _other(active_slot) if active_slot else SLOT_A
                    standby_slot    = tgt
                    standby_task    = asyncio.create_task(_upload(client, ns, tgt, quick=quick, ble_lock=ble_lock))
                    standby_elapsed = 0.0
                    standby_song    = current_song
                    switch_on_ready = True
                    active_bpm      = bpm
                    active_cover    = has_cover
                    cover_wait_since = None

            if switch_on_ready and standby_task is not None and standby_task.done():
                if standby_task.cancelled() or standby_task.exception() is not None:
                    exc = standby_task.exception() if not standby_task.cancelled() else None
                    if exc is not None:
                        log.error("nowplaying", f"upload failed: {exc}")
                        raise exc
                    standby_task    = None
                    switch_on_ready = False
                elif standby_song == current_song:
                    log.info("nowplaying", f"switching to slot {standby_slot}")
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
                    active_cover     = state.get("cover") is not None
                    if old is not None:
                        await _safe_delete(client, ble_lock=ble_lock, slot=old)
                    if song_changed and on_song_shown:
                        on_song_shown()
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
                    if cover_arrived_late:
                        cover_arrived_late = False
                        accents = display.last_accents or ((0,0,0),(0,0,0),(0,0,0))
                        asyncio.create_task(webhooks.fire("nowplaying", "on_song_change", {
                            "title": state.get("title", ""),
                            "artist": state.get("artist", ""),
                            "album": state.get("album", ""),
                            "accent1": accents[0],
                            "accent2": accents[1],
                            "accent3": accents[2],
                        }))

            metadata_arrived = False
            if (active_slot is not None
                    and current_song == song_key
                    and not active_cover
                    and state.get("cover") is not None
                    and standby_task is None
                    and not in_last):
                active_cover       = True
                metadata_arrived   = True
                cover_arrived_late = True
                bpm = state.get("bpm")
                if bpm:
                    active_bpm = bpm
                    current_chunk_s = _beat_chunk_s(bpm)
                log.info("nowplaying", "cover arrived, re-rendering")

            if (active_slot is not None
                    and current_song == song_key
                    and active_bpm is None
                    and state.get("bpm") is not None
                    and standby_task is None
                    and not in_last):
                bpm = state["bpm"]
                active_bpm = bpm
                current_chunk_s = _beat_chunk_s(bpm)
                metadata_arrived = True
                log.info("nowplaying", f"bpm arrived ({bpm}), re-rendering")

            if metadata_arrived and standby_task is None:
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
                    log.debug("nowplaying", f"preparing chunk elapsed={next_chunk_elapsed:.0f}s for slot {tgt}")
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
                    log.debug("nowplaying", f"chunk boundary, slot {standby_slot}")
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

            await asyncio.sleep(IDLE_SLEEP)

    finally:
        await _cancel_task(black_task)
        await _cancel_task(standby_task)


_walk = {"index": 0, "shown": 0, "since": 0.0}


def use_canned_songs(offline: bool = False) -> None:
    # the state machine keeps running as it is, only the scrobbler behind it is replaced
    global COVER_WAIT, CHUNK_S, on_song_shown
    if offline:
        COVER_WAIT = 0.0          # no cover is coming, so do not sit and wait for one
    CHUNK_S = CANNED_CHUNK_S
    covers  = {}
    _walk.update(index=0, shown=0, since=time.monotonic())

    def get_state() -> dict:
        index = _walk["index"]
        song  = display.STATES[index]
        if index not in covers:
            covers[index] = None if offline else display.fetch_cover(song["query"])
        state = song["state"]
        if visualize.showing("nowplaying"):
            visualize.label(
                f"{index + 1}/{len(display.STATES)}  {state['artist']} - {state['title']}  {song['note']}")
        return {**state, "playing": True, "genres": [], "cover": covers[index], "cover_url": None}

    def shown() -> None:
        # the panel decides the pace, a timer here would outrun the render and skip songs
        _walk["shown"] += 1
        _walk["since"]  = time.monotonic()

    poller.start     = lambda: None
    poller.get_state = get_state
    on_song_shown    = shown


def walk_songs_done() -> bool:
    return _walk["shown"] >= len(display.STATES)


async def advance_canned_songs(loop: bool = False) -> None:
    # holds each song on screen for its dwell, then hands the next one to the panel
    while True:
        if walk_songs_done():
            if not loop:
                return
            _walk.update(index=0, shown=0, since=time.monotonic())
        await asyncio.sleep(0.25)
        if _walk["since"] and time.monotonic() - _walk["since"] >= CANNED_DWELL_S:
            _walk["since"] = 0.0
            _walk["index"] = min(_walk["index"] + 1, len(display.STATES) - 1)


async def main(args=None) -> None:
    args = args or visualize.parse()

    if visualize.canned(args):
        use_canned_songs(args.offline)
        asyncio.create_task(advance_canned_songs(loop=True))
    poller.start()
    log.info("nowplaying", f"starting, connecting to {MAC}")

    while True:
        try:
            async with visualize.client(MAC, args, "nowplaying") as client:
                log.info("nowplaying", f"{visualize.tag()} connected")
                await client.set_brightness(80)
                await run_loop(client)
        except KeyboardInterrupt:
            print("\n[main] stopped")
            return
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.error("nowplaying", f"{visualize.tag()} error: {e}, reconnecting in 5s")
            await asyncio.sleep(5)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(parents=[visualize.flags()])
    parser.add_argument("--poll-debug", action="store_true",
                        help="dump what the scrobbler reports, console only, no display")
    parsed = parser.parse_args()
    if parsed.poll_debug:
        import assets.system.tools as tools
        tools.poll_debug()
    else:
        try:
            asyncio.run(main(parsed))
        except KeyboardInterrupt:
            print("\nStopped.")
