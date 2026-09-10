# Runs a panel without the display: the frames it would send over BLE land in a browser tab.

import argparse
import binascii
import logging
import os
import socket
import sys
import time
import threading
import webbrowser

import flask.cli
from flask import Flask, Response, jsonify

import assets.system.config as config
import assets.system.log as log

DEFAULT_PORT = 12833
STATE_S      = 3.0

_frame      = {"data": b"", "mime": "image/png", "version": 0}
_status     = {"label": "", "panel": "", "brightness": 100, "slot": "live"}
_slots      = {}
_lock       = threading.Lock()
_serving    = False
_last_poll  = 0.0

_PAGE = """<!doctype html>
<title>smart pixel display - visualize</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: flex; flex-direction: column;
         align-items: center; justify-content: center; gap: 18px;
         background: #14161a; color: #c9d1d9;
         font: 14px ui-monospace, SFMono-Regular, Menlo, monospace; }
  img  { width: min(1024px, 94vw); image-rendering: pixelated;
         border: 1px solid #2a2f37; border-radius: 4px; background: #000; }
  #label  { font-size: 15px; color: #e6edf3; text-align: center; padding: 0 16px; }
  #status { font-size: 12px; color: #6e7681; }
  #status b { color: #9aa4b2; font-weight: 500; }
  body.gone img    { opacity: .25; filter: grayscale(1) !important; }
  body.gone #label { color: #6e7681; }
  #gone { display: none; color: #e8a33d; font-size: 13px; text-align: center; padding: 0 16px; }
  body.gone #gone  { display: block; }
</style>
<img id="screen" src="/frame?v=0" alt="panel">
<div id="label">-</div>
<div id="status"></div>
<div id="gone">panel stopped &middot; leave this tab open, the next run picks it up</div>
<script>
  let shown = -1;
  async function tick() {
    try {
      const s = await (await fetch("/state")).json();
      // only swap the src when the frame really changed, or a gif restarts every poll
      if (s.version !== shown) {
        shown = s.version;
        document.getElementById("screen").src = "/frame?v=" + s.version;
      }
      document.getElementById("screen").style.filter = "brightness(" + (0.25 + s.brightness / 133) + ")";
      document.getElementById("label").textContent = s.label || "-";
      document.getElementById("status").innerHTML =
        "<b>" + s.panel + "</b> &middot; slot " + s.slot + " &middot; brightness " + s.brightness;
      document.body.classList.remove("gone");
    } catch (e) {
      // the panel is gone, say so rather than leaving a dead frame looking live
      document.body.classList.add("gone");
    }
    setTimeout(tick, 250);
  }
  tick();
</script>
"""


def flags() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--visualize",  action="store_true", help="show the frames in a browser and walk every canned state")
    parser.add_argument("--live",       action="store_true", help="with --visualize: real data and the api, instead of the canned walk")
    parser.add_argument("--offline",    action="store_true", help="no outgoing api calls at all, not even covers")
    parser.add_argument("--no-browser", action="store_true", help="serve the page but do not open it")
    return parser


def canned(args) -> bool:
    # --visualize is for building panels, so it walks the states unless --live says otherwise
    return bool(getattr(args, "visualize", False) and not getattr(args, "live", False))


def parse(parser: argparse.ArgumentParser | None = None) -> argparse.Namespace:
    parser = parser or argparse.ArgumentParser(parents=[flags()])
    return parser.parse_args()


def state_at(states: list, started: float, seconds: float = STATE_S) -> tuple:
    # which canned state a walk is on, by wall clock, so every caller agrees
    index = int((time.monotonic() - started) / seconds) % len(states)
    return index, states[index]


def _put(data: bytes, mime: str, slot="live") -> None:
    with _lock:
        _frame["data"]    = data
        _frame["mime"]    = mime
        _frame["version"] += 1
        _status["slot"]   = slot


def label(text: str, panel: str | None = None) -> None:
    _status["label"] = text
    if panel:
        _status["panel"] = panel


def showing(panel: str) -> bool:
    # a panel that is polled but not on screen must not relabel the frame that is
    return _status["panel"] == panel


def tag(default: str = "ble") -> str:
    # argv, not _serving: the connect line is printed before the server is up
    return "visualize" if (_serving or "--visualize" in sys.argv) else default


def _port_taken(port: int) -> bool:
    with socket.socket() as probe:
        return probe.connect_ex(("127.0.0.1", port)) == 0


def _tab_already_watching(wait_s: float = 1.0) -> bool:
    # a tab left open from an earlier run keeps polling and picks this server up by itself,
    # so if one asks for the state in the first moment, there is no need to open another
    deadline = time.monotonic() + wait_s
    while time.monotonic() < deadline:
        if _last_poll:
            return True
        time.sleep(0.05)
    return False


def serve(port: int | None = None, open_browser: bool = True, panel: str = "") -> int:
    global _serving
    port = port or int(config.get("expert", "visualize_port", DEFAULT_PORT))
    _status["panel"] = panel
    if _serving:
        return port

    # binding in a thread fails silently and the browser then shows whoever owns the port
    if _port_taken(port):
        log.error("visualize", f"port {port} is already in use, probably another panel still running")
        log.error("visualize", f"stop it, or set expert.visualize_port to something else")
        sys.exit(1)

    app = Flask(__name__)
    logging.getLogger("werkzeug").setLevel(logging.ERROR)  # no request log
    flask.cli.show_server_banner = lambda *_a, **_k: None

    @app.route("/")
    def _index():
        return Response(_PAGE, mimetype="text/html")

    @app.route("/state")
    def _state():
        global _last_poll
        _last_poll = time.monotonic()
        return jsonify(version=_frame["version"], **_status)

    @app.route("/frame")
    def _frame_route():
        with _lock:
            data, mime = _frame["data"], _frame["mime"]
        return Response(data, mimetype=mime, headers={"Cache-Control": "no-store"})

    threading.Thread(target=lambda: app.run(host="0.0.0.0", port=port, threaded=True),
                     daemon=True).start()
    _serving = True
    url = f"http://localhost:{port}"
    log.info("visualize", f"serving at {url} - look there, not at the display")
    if open_browser and _tab_already_watching():
        log.info("visualize", "a tab is already watching it, not opening another")
    elif open_browser:
        stdout, stderr = os.dup(1), os.dup(2)      # the browser launcher chats on both
        devnull = os.open(os.devnull, os.O_WRONLY)
        os.dup2(devnull, 1)
        os.dup2(devnull, 2)
        try:
            webbrowser.open(url)
        finally:
            os.dup2(stdout, 1)
            os.dup2(stderr, 2)
            for fd in (stdout, stderr, devnull):
                os.close(fd)
    return port


class FakeClient:
    # Same surface as pypixelcolor.AsyncClient, minus the radio.

    def __init__(self, panel: str = ""):
        _status["panel"] = panel

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    async def connect(self):
        return self

    async def disconnect(self):
        return None

    async def send_image_hex(self, hex_frame: str, _ext: str = ".png") -> None:
        _put(binascii.unhexlify(hex_frame), "image/png")

    async def send_image(self, path: str, save_slot: int | None = None) -> None:
        with open(path, "rb") as handle:
            data = handle.read()
        mime = "image/gif" if path.lower().endswith(".gif") else "image/png"
        if save_slot is None:
            _put(data, mime)
        else:
            _slots[save_slot] = (data, mime)

    async def show_slot(self, slot: int) -> None:
        if slot in _slots:
            data, mime = _slots[slot]
            _put(data, mime, slot=str(slot))

    async def delete(self, slot: int) -> None:
        _slots.pop(slot, None)

    async def clear(self) -> None:
        _slots.clear()

    async def set_brightness(self, value: int) -> None:
        _status["brightness"] = int(value)

    async def set_power(self, on: bool) -> None:
        return None

    def get_device_info(self):
        return _DeviceInfo()


class _DeviceInfo:
    width       = 128
    height      = 32
    device_type = "visualize"


def client(mac, args, panel: str = ""):
    if not getattr(args, "visualize", False):
        from pypixelcolor import AsyncClient
        return AsyncClient(mac)
    serve(open_browser=not args.no_browser, panel=panel)
    return FakeClient(panel)
