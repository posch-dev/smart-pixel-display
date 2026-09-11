# Runs a panel without the display: the frames it would send over BLE land in a browser tab.

import argparse
import asyncio
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

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import assets.system.config as config
import assets.system.log as log

DEFAULT_PORT = 12833
STATE_S      = 3.0

_frame      = {"data": b"", "mime": "image/png", "version": 0}
_status     = {"label": "", "panel": "", "brightness": 100, "slot": "live"}
_slots      = {}
_clock      = {"key": "", "colon_on": b"", "colon_off": b""}
_filling    = {"key": "", "colon_on": b"", "colon_off": b""}
_pending    = {}
_mode       = {"visualize": False, "canned": False}
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
  #standalone { position: fixed; bottom: 12px; left: 0; right: 0; text-align: center;
                font-size: 11px; color: #6e7681; padding: 0 16px; }
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


def note_clock(key: str, colon_on: bool) -> None:
    # the clock task knows the minute and the colon state, so nothing has to read pixels back
    _pending.update(clock=key, colon_on=colon_on)


def _keep_clock_pair(data: bytes) -> None:
    key, colon_on = _pending.pop("clock", None), _pending.pop("colon_on", False)
    if key is None:
        return
    if key != _filling["key"]:
        _filling.update(key=key, colon_on=b"", colon_off=b"")
    _filling["colon_on" if colon_on else "colon_off"] = data
    # the minute that is served keeps its whole pair until the next one has both halves,
    # or a blink alternates into the missing one and the tile goes black
    if _filling["colon_on"] and _filling["colon_off"]:
        _clock.update(_filling)


def _put(data: bytes, mime: str, slot="live") -> None:
    with _lock:
        _frame["data"]    = data
        _frame["mime"]    = mime
        _frame["version"] += 1
        _status["slot"]   = slot
        _keep_clock_pair(data)


def frame(variant: str = "") -> tuple[bytes, str]:
    with _lock:
        if variant in ("colon_on", "colon_off"):
            return _clock[variant], "image/png"
        return _frame["data"], _frame["mime"]


def mode() -> dict:
    return dict(_mode)


def live_state() -> dict:
    with _lock:
        return {"version": _frame["version"], "clock_key": _clock["key"],
                "has_pair": bool(_clock["colon_on"] and _clock["colon_off"]), **_status, **_mode}


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


def open_tab(url: str) -> None:
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
        open_tab(url)
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


class TapClient:
    # the real client with a mirror behind it: the web app shows what the display was given.
    # recording happens after the send, so a frame the display refused never reaches the page
    def __init__(self, inner, panel: str = ""):
        self._inner = inner
        _status["panel"] = panel

    async def __aenter__(self):
        await self._inner.__aenter__()
        return self

    async def __aexit__(self, *error):
        return await self._inner.__aexit__(*error)

    async def send_image_hex(self, hex_frame: str, ext: str = ".png") -> None:
        await self._inner.send_image_hex(hex_frame, ext)
        _put(binascii.unhexlify(hex_frame), "image/png")

    async def send_image(self, path: str, save_slot: int | None = None) -> None:
        await self._inner.send_image(path, save_slot=save_slot)
        with open(path, "rb") as handle:
            data = handle.read()
        mime = "image/gif" if path.lower().endswith(".gif") else "image/png"
        if save_slot is None:
            _put(data, mime)
        else:
            _slots[save_slot] = (data, mime)

    async def show_slot(self, slot: int) -> None:
        await self._inner.show_slot(slot)
        if slot in _slots:
            data, mime = _slots[slot]
            _put(data, mime, slot=str(slot))

    async def delete(self, slot: int) -> None:
        await self._inner.delete(slot)
        _slots.pop(slot, None)

    async def set_brightness(self, value: int) -> None:
        await self._inner.set_brightness(value)
        _status["brightness"] = int(value)

    def __getattr__(self, name):
        return getattr(self._inner, name)


def client(mac, args, panel: str = "", own_page: bool = True):
    _mode.update(visualize=bool(getattr(args, "visualize", False)), canned=canned(args))
    if not _mode["visualize"]:
        from pypixelcolor import AsyncClient
        real = AsyncClient(mac)
        # only the service has a web app to mirror into, a lone panel gains nothing from a tap
        return real if own_page else TapClient(real, panel)
    if own_page:
        serve(open_browser=not args.no_browser, panel=panel)
    return FakeClient(panel)


if __name__ == "__main__":
    # the tap is the one part that cannot be tried without a display, so it gets a stub
    import io
    from PIL import Image

    class _Stub:
        def __init__(self):      self.calls = []
        async def __aenter__(self):     self.calls.append("enter"); return self
        async def __aexit__(self, *e):  self.calls.append("exit");  return False
        async def send_image_hex(self, data, ext=".png"): self.calls.append("hex")
        async def send_image(self, path, save_slot=None): self.calls.append("image")
        async def show_slot(self, slot):                 self.calls.append("show")
        async def delete(self, slot):                    self.calls.append("delete")
        async def set_brightness(self, value):           self.calls.append("brightness")
        def get_device_info(self):                       return "passed through"

    def _green_png() -> str:
        buffer = io.BytesIO()
        Image.new("RGB", (128, 32), (0, 255, 0)).save(buffer, "PNG")
        return binascii.hexlify(buffer.getvalue()).decode()

    async def _check() -> None:
        stub = _Stub()
        async with TapClient(stub, "clock") as tap:
            await tap.send_image_hex(_green_png())
            data, mime = frame()
            assert Image.open(io.BytesIO(data)).convert("RGB").getpixel((0, 0)) == (0, 255, 0)
            assert mime == "image/png"
            await tap.set_brightness(42)
            assert live_state()["brightness"] == 42
            assert tap.get_device_info() == "passed through"
        assert stub.calls == ["enter", "hex", "brightness", "exit"], stub.calls
        print("tap passes every call on and mirrors what it saw")

    def _check_clock_hold() -> None:
        on, off, new = b"on", b"off", b"new-on"
        for key, colon_on, data in (("12:00", True, on), ("12:00", False, off), ("12:01", True, new)):
            note_clock(key, colon_on)
            _put(data, "image/png")
        assert live_state()["clock_key"] == "12:00", live_state()["clock_key"]
        assert frame("colon_on")[0] == on and frame("colon_off")[0] == off
        note_clock("12:01", False)
        _put(b"new-off", "image/png")
        assert live_state()["clock_key"] == "12:01"
        assert frame("colon_on")[0] == new
        print("a half filled minute never reaches the browser")

    asyncio.run(_check())
    _check_clock_hold()
