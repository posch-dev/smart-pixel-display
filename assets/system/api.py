import os
import sys
import time
import asyncio
import logging
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, send_from_directory, make_response, Response
from werkzeug.exceptions import HTTPException

logging.getLogger("werkzeug").setLevel(logging.ERROR)

_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, _root)
sys.path.insert(0, os.path.join(_root, "panels", "dashboard"))

import assets.system.config as config
import assets.system.log as log
from assets.system.version import VERSION
import assets.system.scheduler as scheduler
import assets.system.webhooks as webhooks
import assets.system.updates as updates
import assets.system.visualize as visualize
import threading
import calendar_store
import weather as weather_mod

app = Flask(__name__)


@app.errorhandler(Exception)
def _json_error(exc):
    # the web ui reads every failure as json, an html error page lands in a toast
    if isinstance(exc, HTTPException):
        return jsonify({"error": exc.description}), exc.code
    log.error("api", f"{request.path}: {type(exc).__name__}: {exc}")
    return jsonify({"error": f"{type(exc).__name__}: {exc}"}), 500


def _mode_color_ctx(mode: str) -> dict | None:
    color = config.get(mode, "color")
    if isinstance(color, (list, tuple)) and len(color) == 3:
        return {"accent1": tuple(color)}
    return None


def _fire_webhook_from_thread(section: str, trigger: str) -> None:
    if config._loop is not None:
        ctx = _mode_color_ctx(section)
        config._loop.call_soon_threadsafe(
            lambda: config._loop.create_task(webhooks.fire(section, trigger, ctx)))

_web = os.path.join(_root, "assets", "web")

_ble_connected:   bool = False
_clearing:        bool = False
_connected_since: float | None = None
_reconnect_at:    float | None = None
_reconnecting:    bool = False


_runtime = None


def bind_runtime(module) -> None:
    global _runtime
    _runtime = module


def _rt():
    # startup runs as __main__, so importing it by name would execute a second
    # copy whose md_display is never fed by the weather fetcher
    global _runtime
    if _runtime is None:
        import startup
        _runtime = startup
    return _runtime


_seen_at = 0.0


def seen_recently(within_s: float = 3.0) -> bool:
    return bool(_seen_at) and time.time() - _seen_at < within_s


def set_connected(connected: bool) -> None:
    global _ble_connected, _connected_since
    if connected and not _ble_connected:
        _connected_since = time.time()
    elif not connected:
        _connected_since = None
    _ble_connected = connected


def set_reconnect(at: float | None = None, attempting: bool = False) -> None:
    global _reconnect_at, _reconnecting
    _reconnect_at = at
    _reconnecting = attempting


def set_clearing(clearing: bool) -> None:
    global _clearing
    _clearing = clearing


def is_ready() -> bool:
    return _ble_connected and not _clearing


def _in_active_hours() -> bool:
    ah = config.get("device", "active_hours")
    if not ah or len(ah) != 2:
        return True
    h = datetime.now().hour
    return int(ah[0]) <= h < int(ah[1])


@app.get("/")
def web_ui():
    return send_from_directory(_web, "index.html")


@app.get("/preview")
def web_preview():
    return send_from_directory(_web, "preview.html")


@app.get("/assets/fonts/<path:filename>")
def web_font(filename):
    return send_from_directory(os.path.join(_root, "assets", "fonts"), filename)


@app.get("/assets/weather/<path:filename>")
def web_weather_icon(filename):
    return send_from_directory(os.path.join(_root, "assets", "icons", "weather_conditions"), filename)


@app.get("/<path:filename>")
def web_static(filename):
    resp = make_response(send_from_directory(_web, filename))
    # the ui files change under the browser all the time, a stale script is a fake bug
    resp.headers["Cache-Control"] = "no-store"
    return resp


# a panel draws its picture the way the display hangs, so anything leaving for a file has to
# be turned back. only the pi can do that to a gif: a browser has no decoder for one
def _gif_upright(data: bytes, width: int = 0) -> bytes:
    import io
    from PIL import Image
    picture = Image.open(io.BytesIO(data))
    frames, base = [], None
    for number in range(getattr(picture, "n_frames", 1)):
        picture.seek(number)
        frame = config.apply_orientation(picture.convert("RGB"))
        if width:
            frame = frame.resize((width, round(width * frame.height / frame.width)), Image.NEAREST)
        base = base or frame.quantize(colors=256, method=2)
        frames.append(frame.quantize(palette=base, dither=Image.Dither.NONE))
    buffer = io.BytesIO()
    frames[0].save(buffer, format="GIF", save_all=True, append_images=frames[1:], loop=0,
                   duration=picture.info.get("duration", 100), optimize=False)
    return buffer.getvalue()


# the whole song is the only export the pi has to draw for, so it happens when one asks and
# never before. the chunks the display was already given are used as they are
_song_job = {"running": False, "done": 0, "total": 0, "gif": b"", "error": "", "key": ""}


def _song_progress() -> dict:
    return {k: _song_job[k] for k in ("running", "done", "total", "error", "key")} | {
        "ready": bool(_song_job["gif"]) and not _song_job["running"]}


def _render_song(found: dict, key: str = "") -> None:
    import io
    from PIL import Image
    display = getattr(sys.modules.get("panels.now_playing.main"), "display", None)
    if display is None:
        _song_job.update(running=False, error="the nowplaying panel is not loaded")
        return
    state   = dict(found["state"] or {})
    every   = found.get("chunk_s") or 20.0
    total   = max(1, int((state.get("duration_s") or 200) / every + 0.999))
    _song_job.update(running=True, done=0, total=total, gif=b"", error="", key=key)
    try:
        frames, base = [], None
        for index in range(total):
            at    = round(index * every, 1)
            chunk = found["chunks"].get(at)
            if chunk is None:
                chunk = display.generate_gif(dict(state, elapsed_s=index * every))
            picture = Image.open(io.BytesIO(chunk))
            loop = []
            for number in range(getattr(picture, "n_frames", 1)):
                picture.seek(number)
                frame = config.apply_orientation(picture.convert("RGB"))
                base  = base or frame.quantize(colors=256, method=2)
                loop.append(frame.quantize(palette=base, dither=Image.Dither.NONE))
            # the display loops a chunk until the next one is due, so the file has to as
            # well, or the track runs by in seconds and the playhead jumps
            repeats = max(1, round(every / (len(loop) * display.FRAME_MS / 1000)))
            frames += loop * repeats
            _song_job["done"] = index + 1
        if not frames:
            raise ValueError("nothing to write")
        buffer = io.BytesIO()
        frames[0].save(buffer, format="GIF", save_all=True, append_images=frames[1:],
                       loop=0, duration=display.FRAME_MS, optimize=False)
        _song_job["gif"] = buffer.getvalue()
    except Exception as error:
        log.error("web", f"song render failed: {error}")
        _song_job["error"] = str(error)
    finally:
        _song_job["running"] = False


@app.get("/status")
def get_status():
    global _seen_at
    _seen_at = time.time()
    return jsonify({
        **scheduler.get_status(),
        "connected":        _ble_connected,
        "connected_for_s":  round(time.time() - _connected_since) if _connected_since else 0,
        "reconnect_in_s":   max(0, round(_reconnect_at - time.time())) if _reconnect_at else None,
        "reconnecting":     _reconnecting,
        "clearing":         _clearing,
        "in_active_hours":  _in_active_hours(),
        **visualize.live_state(),
    }), 200


@app.get("/live/state")
def live_state():
    global _seen_at
    _seen_at = time.time()
    # one tab is one viewer, and this poll is its heartbeat: a paused one holds its song
    visualize.seen_viewer(request.args.get("viewer", ""), request.args.get("paused") == "1",
                          request.args.get("song", ""))
    return jsonify(visualize.live_state()), 200


@app.get("/live/frame")
def live_frame():
    # variant colon_on or colon_off hands out the clock pair, the export needs both
    data, mime = visualize.frame(request.args.get("variant", ""))
    if not data:
        return jsonify({"error": "nothing on the display yet"}), 404
    return Response(data, mimetype=mime, headers={"Cache-Control": "no-store"})


@app.post("/live/song")
def live_song_start():
    want = request.args.get("key", "") or visualize.live_state()["song"]
    if _song_job["running"]:
        # one render at a time, and never hand somebody the file another track is writing
        if _song_job["key"] == want:
            return jsonify({"ok": True, **_song_progress()}), 200
        return jsonify({"ok": False, "error": "another song is being rendered"}), 409
    found = visualize.song(want)
    if not found:
        return jsonify({"ok": False, "error": "that song is no longer on the pi"}), 404
    threading.Thread(target=_render_song, args=(found, want), daemon=True).start()
    return jsonify({"ok": True}), 200


@app.get("/live/song/status")
def live_song_status():
    return jsonify(_song_progress()), 200


@app.get("/live/chunk")
def live_chunk():
    # the chunk a paused tab is holding, which is not the one the display has moved on to.
    # no key and no at means the one on screen
    at   = request.args.get("at")
    data = visualize.song_chunk(request.args.get("key", ""),
                                float(at) if at is not None else visualize.chunk_now())
    if not data:
        return jsonify({"error": "that chunk is gone"}), 404
    if request.args.get("upright") == "1" or request.args.get("w"):
        data = _gif_upright(data, int(request.args.get("w") or 0))
    return Response(data, mimetype="image/gif", headers={"Cache-Control": "no-store"})


@app.get("/live/song.gif")
def live_song_gif():
    if not _song_job["gif"]:
        return jsonify({"error": "nothing rendered"}), 404
    return Response(_song_job["gif"], mimetype="image/gif",
                    headers={"Cache-Control": "no-store"})


@app.get("/config")
def get_config():
    return jsonify(config.all()), 200


@app.post("/config/<section>/<key>")
def set_config(section, key):
    body = request.get_json(silent=True)
    if body is None or "value" not in body:
        return jsonify({"error": 'expected {"value": ...}'}), 400
    try:
        config.set(section, key, body["value"])
    except Exception as exc:
        log.error("api", f"{section}.{key} rejected: {exc}")
        return jsonify({"error": f"{section}.{key} not writable: {exc}"}), 400
    return jsonify({"ok": True, "section": section, "key": key, "value": body["value"]}), 200


def _schedule_after_hours_sleep_timer(minutes: float) -> None:
    if config._loop is None:
        return

    async def _timer():
        await asyncio.sleep(minutes * 60)
        if scheduler.get_active_hours_override() and not _in_active_hours():
            scheduler.set_display_on(False)
            scheduler.set_active_hours_override(False)
            # main loop in startup.py detects the display_on flip and fires
            # on_active_end (we're outside active hours here) on its own.

    def _start():
        scheduler.set_sleep_timer_task(config._loop.create_task(_timer()))

    config._loop.call_soon_threadsafe(_start)


@app.post("/display/power")
def set_display_power():
    body = request.get_json(silent=True)
    if body is None or "on" not in body:
        return jsonify({"error": 'expected {"on": bool}'}), 400
    on = bool(body["on"])
    scheduler.set_display_on(on)
    # Turning it on manually outside active hours keeps it on indefinitely (like an indefinite panel trigger) until manually turned off again, which always drops back to normal after-active-hours behavior.
    override = on and not _in_active_hours()
    scheduler.set_active_hours_override(override)
    scheduler.cancel_sleep_timer()
    if override and config.get("device", "after_hours_sleep_timer_enabled", False):
        minutes = config.get("device", "after_hours_sleep_timer_minutes", 30)
        _schedule_after_hours_sleep_timer(minutes)
        log.info("api", f"sleep timer armed for {minutes} min")
    log.info("api", f"display {'on' if on else 'off'}"
                    f"{', after hours override' if override else ''}")
    return jsonify({"ok": True, "display_on": scheduler.get_display_on()}), 200


@app.get("/mode")
def get_mode():
    return jsonify(scheduler.get_status()), 200


@app.post("/mode/trigger/<mode>")
def trigger_mode(mode):
    if mode not in scheduler.MODES:
        return jsonify({"error": f"unknown mode: {mode}"}), 400
    scheduler.trigger(mode)
    log.info("api", f"{mode} triggered by hand")
    return jsonify({"ok": True, "active_mode": scheduler.get_active_mode()}), 200


@app.delete("/mode/<mode>")
def untrigger_mode(mode):
    if mode not in scheduler.MODES:
        return jsonify({"error": f"unknown mode: {mode}"}), 400
    scheduler.untrigger(mode)
    log.info("api", f"{mode} released")
    return jsonify({"ok": True, "active_mode": scheduler.get_active_mode()}), 200


@app.post("/mode/reset")
def reset_scheduler():
    for m in scheduler.MODES:
        scheduler.untrigger(m)
    log.info("api", "all triggers reset, scheduler takes over")
    return jsonify({"ok": True, "active_mode": scheduler.get_active_mode()}), 200


@app.post("/calendar")
def receive_calendar():
    data = request.get_json(silent=True)
    if isinstance(data, dict) and data:
        calendar_store.append_event(data)
        log.info("calendar", f"+1 event: {data.get('title', '?')!r}")
        log.debug("calendar", f"payload: {data}")
    else:
        log.warn("calendar", "push received without event data")
    if config.get("dashboard", "auto_trigger_on_calendar", True):
        scheduler.trigger("dashboard", source="auto")
        log.info("calendar", "dashboard triggered")
    return jsonify({"ok": True}), 200


@app.get("/calendar")
def dump_calendar():
    return jsonify(calendar_store.get_events()), 200


@app.delete("/calendar")
def clear_calendar():
    calendar_store.clear_events()
    scheduler.untrigger("dashboard")
    log.info("calendar", "cleared, dashboard untriggered")
    return jsonify({"ok": True}), 200


@app.get("/dashboard/status")
def dashboard_status():
    w = _rt().md_display._weather
    weather_text = weather_mod.format_weather(w) if w else "(no weather data cached)"
    import calendar_store as cs
    return jsonify({
        "calendar": cs.get_events(),
        "weather": weather_text,
    }), 200


@app.get("/dashboard/layout")
def dashboard_layout():
    md = _rt().md_display
    at = request.args.get("at")
    now = _at_time(md, at) if at else None
    ev = request.args.get("event")
    pick = None if ev in (None, "") else ("none" if ev == "none" else int(ev))
    return jsonify(md.layout_state(now, pick)), 200


def _at_time(md, hhmm):
    hh, mm = hhmm.split(":")
    return datetime.now(md.LOCAL_TZ).replace(hour=int(hh), minute=int(mm),
                                             second=0, microsecond=0)


@app.get("/dashboard/window")
def dashboard_window():
    md = _rt().md_display
    ev = request.args.get("event")
    index = int(ev) if ev not in (None, "", "none") else md.layout_state().get("index")
    return jsonify(md.event_window(index) or {}), 200


@app.get("/dashboard/layouts")
def dashboard_layouts():
    md = _rt().md_display
    ev = request.args.get("event")
    # no event named means the calendar as it stands, the panel may move to another one
    pick = int(ev) if ev not in (None, "", "none") else None
    cur = _at_time(md, request.args.get("from", "00:00"))
    stop = _at_time(md, request.args.get("to", "23:59"))
    out = []
    while cur <= stop and len(out) < 24 * 60:
        out.append(md.layout_state(cur, pick))
        cur += timedelta(minutes=1)
    return jsonify(out), 200


@app.post("/dashboard/trigger")
def trigger_dashboard():
    scheduler.trigger("dashboard")
    log.info("api", "dashboard triggered by hand")
    return jsonify({"ok": True, "active_mode": scheduler.get_active_mode()}), 200


@app.get("/version")
def version():
    return jsonify({"version": VERSION}), 200


@app.get("/update/status")
def update_status():
    return jsonify(updates.status()), 200


@app.post("/update")
def update_start():
    if not updates.start_update():
        return jsonify({"ok": False, "error": "not supported on this platform"}), 400
    log.info("update", "update started from the web ui")
    return jsonify({"ok": True}), 200


@app.get("/home")
def home():
    rt = _rt()
    status = scheduler.get_status()

    verse_data = rt.get_verse_data()
    verse = None
    if verse_data:
        verse = {
            "reference": verse_data["reference"],
            "translation": verse_data["translation"],
        }

    np_state = rt.np_poller.get_state()
    # the three colours the panel derives from the cover, so the web ui can match it
    np_main = sys.modules.get("panels.now_playing.main")
    accents = getattr(getattr(np_main, "display", None), "last_accents", None)

    nowplaying = {
        "playing": bool(np_state.get("playing") and np_state.get("title")),
        "accents": [list(a) for a in accents] if accents else None,
        "title": np_state.get("title"),
        "artist": np_state.get("artist"),
        "album": np_state.get("album"),
        "duration_s": np_state.get("duration_s"),
        "elapsed_s": round(np_state.get("elapsed_s", 0)),
        "cover_url": np_state.get("cover_url"),
    }

    md = rt.md_display
    dashboard = {
        "weather": md.display_weather(),
        "units": (config.get("dashboard", "weather") or {}).get("units", "metric"),
        "layout": md.layout_state(),
        "events": calendar_store.get_events(),
    }

    return jsonify({
        "active_mode": status.get("active_mode", "clock"),
        "active_for_s": status.get("active_for_s", 0),
        "connected": _ble_connected,
        "display_on": status.get("display_on", True),
        "in_active_hours": _in_active_hours(),
        "colors": {
            "clock": config.get("clock", "color", [0, 255, 0]),
            "verse_of_day": config.get("verse_of_day", "color", [125, 40, 125]),
            "dashboard": config.get("dashboard", "color", None),
        },
        "verse": verse,
        "nowplaying": nowplaying,
        "dashboard": dashboard,
    }), 200


def run(host: str = "0.0.0.0", port: int = 12832) -> None:
    try:
        app.run(host=host, port=port, debug=False)
    except OSError as e:
        log.error("web", f"cannot listen on {host}:{port}: {e}. set expert.port in config.toml")


if __name__ == "__main__":
    run()
