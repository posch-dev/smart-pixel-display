# Asks github once a day whether a newer release is out, and starts the updater on request.

import json
import os
import subprocess
import threading
import time
import urllib.error
import urllib.request

import assets.system.config as config
import assets.system.log as log
from assets.system.version import VERSION

RELEASES_API   = "https://api.github.com/repos/posch-dev/smart-pixel-display/releases/latest"
CHECK_INTERVAL = 86400

_root       = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
_lock       = threading.Lock()
_latest     = {"tag": "", "url": "", "checked_at": 0.0}
_announced  = ""


def _numbers(version: str) -> list[int]:
    return [int(part) for part in version.replace("v", " ").split(".") if part.strip().isdigit()] or [0]


def is_newer(tag: str) -> bool:
    return bool(tag) and _numbers(tag) > _numbers(VERSION)


def fetch_latest() -> tuple[str, str]:
    request = urllib.request.Request(RELEASES_API, headers={"Accept": "application/vnd.github+json",
                                                            "User-Agent": "smart-pixel-display"})
    with urllib.request.urlopen(request, timeout=10) as answer:
        release = json.load(answer)
    return release.get("tag_name", ""), release.get("html_url", "")


def check(force: bool = False) -> dict:
    global _announced
    with _lock:
        fresh = time.time() - _latest["checked_at"] < CHECK_INTERVAL
        if fresh and not force:
            return dict(_latest)
        try:
            tag, url = fetch_latest()
        except (urllib.error.URLError, OSError, ValueError) as exc:
            log.debug("update", f"check failed: {exc}")
            return dict(_latest)
        _latest.update({"tag": tag, "url": url, "checked_at": time.time()})
        if is_newer(tag) and tag != _announced:
            _announced = tag
            log.info("update", f"{tag} is out, running {VERSION}")
        return dict(_latest)


def status() -> dict:
    enabled = bool(config.get("expert", "update_check", True))
    latest  = check() if enabled else dict(_latest)
    return {
        "version":  VERSION,
        "latest":   latest["tag"],
        "url":      latest["url"],
        "newer":    enabled and is_newer(latest["tag"]),
        "command":  "./install.sh --update" if os.name != "nt" else "install.ps1 --update",
        "can_install": os.name != "nt",
    }


def start_update() -> bool:
    if os.name == "nt":
        return False
    starter = os.path.join(_root, "install.sh")
    environment = dict(os.environ, SPD_RESTART_PID=str(os.getpid()))
    subprocess.Popen(["bash", starter, "--update"], cwd=_root, env=environment,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    return True
