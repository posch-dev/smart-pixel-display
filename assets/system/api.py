import os
import sys
import logging
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory

logging.getLogger("werkzeug").setLevel(logging.ERROR)

_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, _root)
sys.path.insert(0, os.path.join(_root, "panels", "dashboard"))

import assets.system.config as config
import assets.system.scheduler as scheduler
import assets.system.webhooks as webhooks
import calendar_store
import weather as weather_mod

app = Flask(__name__)


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

_ble_connected: bool = False
_clearing:      bool = False


def set_connected(connected: bool) -> None:
    global _ble_connected
    _ble_connected = connected


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


@app.get("/<path:filename>")
def web_static(filename):
    return send_from_directory(_web, filename)


@app.get("/status")
def get_status():
    return jsonify({
        **scheduler.get_status(),
        "connected":       _ble_connected,
        "clearing":        _clearing,
        "in_active_hours": _in_active_hours(),
    }), 200


@app.get("/config")
def get_config():
    return jsonify(config.all()), 200


@app.post("/config/<section>/<key>")
def set_config(section, key):
    body = request.get_json(silent=True)
    if body is None or "value" not in body:
        return jsonify({"error": 'expected {"value": ...}'}), 400
    config.set(section, key, body["value"])
    return jsonify({"ok": True, "section": section, "key": key, "value": body["value"]}), 200


@app.post("/display/power")
def set_display_power():
    body = request.get_json(silent=True)
    if body is None or "on" not in body:
        return jsonify({"error": 'expected {"on": bool}'}), 400
    scheduler.set_display_on(bool(body["on"]))
    return jsonify({"ok": True, "display_on": scheduler.get_display_on()}), 200


@app.get("/mode")
def get_mode():
    return jsonify(scheduler.get_status()), 200


@app.post("/mode/trigger/<mode>")
def trigger_mode(mode):
    if mode not in scheduler.MODES:
        return jsonify({"error": f"unknown mode: {mode}"}), 400
    scheduler.trigger(mode)
    return jsonify({"ok": True, "active_mode": scheduler.get_active_mode()}), 200


@app.delete("/mode/<mode>")
def untrigger_mode(mode):
    if mode not in scheduler.MODES:
        return jsonify({"error": f"unknown mode: {mode}"}), 400
    scheduler.untrigger(mode)
    return jsonify({"ok": True, "active_mode": scheduler.get_active_mode()}), 200


@app.post("/mode/reset")
def reset_scheduler():
    for m in scheduler.MODES:
        scheduler.untrigger(m)
    return jsonify({"ok": True, "active_mode": scheduler.get_active_mode()}), 200


@app.post("/calendar")
def receive_calendar():
    data = request.get_json(silent=True)
    if isinstance(data, dict) and data:
        calendar_store.append_event(data)
        print(f"[calendar] +1 event: {data.get('title', '?')!r}")
    else:
        print(f"[calendar] push received (no event data)")
    if config.get("dashboard", "auto_trigger_on_calendar", True):
        scheduler.trigger("dashboard", source="auto")
        print(f"[calendar] dashboard triggered")
    return jsonify({"ok": True}), 200


@app.get("/calendar")
def dump_calendar():
    return jsonify(calendar_store.get_events()), 200


@app.delete("/calendar")
def clear_calendar():
    calendar_store.clear_events()
    scheduler.untrigger("dashboard")
    print("[calendar] cleared — dashboard untriggered")
    return jsonify({"ok": True}), 200


@app.get("/dashboard/status")
def dashboard_status():
    try:
        w = weather_mod.fetch_weather()
        weather_text = weather_mod.format_weather(w)
    except Exception as e:
        weather_text = f"(weather error: {e})"
    import calendar_store as cs
    return jsonify({
        "calendar": cs.get_events(),
        "weather": weather_text,
    }), 200


@app.post("/dashboard/trigger")
def trigger_dashboard():
    scheduler.trigger("dashboard")
    return jsonify({"ok": True, "active_mode": scheduler.get_active_mode()}), 200


def run(host: str = "0.0.0.0", port: int = 5000) -> None:
    app.run(host=host, port=port, debug=False)


if __name__ == "__main__":
    run()
