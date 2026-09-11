import glob
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
STATE_PATH     = os.path.join(os.path.dirname(__file__), "..", "..", ".update_state")
LOG_GLOB       = ".update-*.log"
KEEP_LOGS      = 5          # one file per update, so the oldest are pruned
STALE_S        = 600        # a marker older than this means the updater died without saying so

# how far along the bar stands per phase. the last stretch is the browser's, it only knows
# the service is back when /version answers with the new number
PHASES = {"starting": 5, "fetching": 25, "installing": 70, "restarting": 90, "failed": 100}

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


def _tag(version: str) -> str:
    return "v" + version.lstrip("v") if version else "unknown"


def _log_path(target: str) -> str:
    stamp = time.strftime("%Y%m%d-%H%M%S")
    return os.path.join(_root, f".update-{_tag(VERSION)}-to{_tag(target)}-{stamp}.log")


def newest_log() -> str:
    found = sorted(glob.glob(os.path.join(_root, LOG_GLOB)))
    return os.path.basename(found[-1]) if found else ""


def _prune_logs() -> None:
    found = sorted(glob.glob(os.path.join(_root, LOG_GLOB)))
    for old in found[:-KEEP_LOGS]:
        try:
            os.remove(old)
        except OSError:
            pass


def mark(phase: str, target: str = "") -> None:
    # one line so anything can write it, a shell script included, without reaching for jq
    try:
        with open(STATE_PATH, "w", encoding="utf-8") as handle:
            handle.write(f"{phase}|{target}|{time.time():.0f}\n")
        log.info("update", f"{phase}{' ' + target if target else ''}")
    except OSError as exc:
        log.warn("update", f"could not write the update marker: {exc}")


def clear_mark() -> None:
    try:
        os.remove(STATE_PATH)
        log.info("update", "done, this is the version it was waiting for")
    except FileNotFoundError:
        pass
    except OSError as exc:
        log.warn("update", f"could not clear the update marker: {exc}")


def progress() -> dict | None:
    try:
        with open(STATE_PATH, encoding="utf-8") as handle:
            phase, target, stamp = handle.read().strip().split("|")
        age = time.time() - float(stamp)
    except (OSError, ValueError):
        return None
    return {
        "phase":   phase,
        "target":  target,
        "percent": PHASES.get(phase, 0),
        "age_s":   round(age),
        "failed":  phase == "failed",
        "stale":   age > STALE_S,
        "log":     newest_log(),
    }


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
        "progress": progress(),
    }


def start_update() -> bool:
    if os.name == "nt":
        return False
    mark("starting", check().get("tag", ""))
    starter = os.path.join(_root, "install.sh")
    environment = dict(os.environ, SPD_RESTART_PID=str(os.getpid()))
    # the updater outlives this process, so its output goes to a file named after the jump
    # it is making. it used to go to /dev/null, which left nothing to read when one failed
    path = _log_path(check().get("tag", ""))
    log.info("update", f"starting the updater, output goes to {os.path.basename(path)}")
    try:
        stream = open(path, "w", encoding="utf-8")
    except OSError as exc:
        log.warn("update", f"no update log ({exc}), running without one")
        stream = subprocess.DEVNULL
    _prune_logs()   # after the new one exists, so the five that survive include it
    subprocess.Popen(["bash", starter, "--update"], cwd=_root, env=environment,
                     stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
    return True
