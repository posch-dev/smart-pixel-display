import os
import sys
import random
import time
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
import assets.system.config as config

MODES = ["clock", "verse_of_day", "nowplaying", "dashboard"]


def _fallback_mode() -> str:
    best, best_prio = MODES[0], float("inf")
    for m in MODES:
        if not config.get(m, "enabled", False):
            continue
        prio = config.get(m, "priority", 999)
        if prio < best_prio:
            best, best_prio = m, prio
    return best

_triggered: dict[str, float] = {}
_trigger_source: dict[str, str] = {}
_trigger_expires: dict[str, float] = {}  # mode -> epoch seconds, only for timed triggers
_active_mode: str = MODES[0]
_active_since: float = time.time()
_verse_last_window: int = -1  # h*100+window_index, so we roll only once per window entry
_display_on: bool = True
_active_hours_override: bool = False  # user forced display on outside active hours


def get_active_mode() -> str:
    return _active_mode


def get_display_on() -> bool:
    return _display_on


def set_display_on(on: bool) -> None:
    global _display_on
    _display_on = on


def get_active_hours_override() -> bool:
    return _active_hours_override


def set_active_hours_override(on: bool) -> None:
    global _active_hours_override
    _active_hours_override = on


_sleep_timer_task = None  # asyncio.Task, kept generic to avoid importing asyncio here


def set_sleep_timer_task(task) -> None:
    global _sleep_timer_task
    _sleep_timer_task = task


def cancel_sleep_timer() -> None:
    global _sleep_timer_task
    if _sleep_timer_task is not None and not _sleep_timer_task.done():
        _sleep_timer_task.cancel()
    _sleep_timer_task = None


def has_user_trigger() -> bool:
    return any(_trigger_source.get(m) == "user" for m in _triggered)


def get_status() -> dict:
    return {
        "active_mode":     _active_mode,
        "active_since":    _active_since,
        "active_for_s":    round(time.time() - _active_since, 1),
        "triggered":       list(_triggered.keys()),
        "trigger_sources": dict(_trigger_source),
        "trigger_expires": dict(_trigger_expires),
        "display_on":      _display_on,
        "active_hours_override": _active_hours_override,
    }


def trigger(mode: str, source: str = "user", expires_at: float | None = None) -> None:
    if mode == _fallback_mode() and source != "user":
        source = "auto"
    _triggered[mode] = time.time()
    _trigger_source[mode] = source
    if expires_at is not None:
        _trigger_expires[mode] = expires_at
    else:
        _trigger_expires.pop(mode, None)
    _evaluate()


def is_triggered(mode: str) -> bool:
    return mode in _triggered


def untrigger(mode: str) -> None:
    _trigger_expires.pop(mode, None)
    if mode == _fallback_mode():
        _trigger_source[mode] = "auto"
        _evaluate()
        return
    _triggered.pop(mode, None)
    _trigger_source.pop(mode, None)
    _evaluate()


def _evaluate() -> None:
    global _active_mode, _active_since
    fb = _fallback_mode()
    if fb not in _triggered:
        _triggered[fb] = time.time()
        _trigger_source[fb] = "auto"

    user_modes = [
        m for m in _triggered
        if _trigger_source.get(m) == "user"
        and config.get(m, "enabled", False)
    ]

    if user_modes:
        best, best_prio = user_modes[0], config.get(user_modes[0], "priority", 0)
        for mode in user_modes[1:]:
            prio = config.get(mode, "priority", 0)
            if prio > best_prio:
                best, best_prio = mode, prio
    else:
        best, best_prio = fb, -1
        for mode in _triggered:
            if not config.get(mode, "enabled", False):
                continue
            prio = config.get(mode, "priority", 0)
            if prio > best_prio:
                best, best_prio = mode, prio

    if best != _active_mode:
        _active_mode = best
        _active_since = time.time()


def tick() -> None:
    global _verse_last_window

    now = time.time()
    for m, exp in list(_trigger_expires.items()):
        if now >= exp:
            untrigger(m)

    min_dur = config.get(_active_mode, "min_duration_s", 0)
    if min_dur > 0 and (time.time() - _active_since) >= min_dur:
        if _trigger_source.get(_active_mode) != "user":
            untrigger(_active_mode)

    if config.get("verse_of_day", "enabled", False) and "verse_of_day" not in _triggered:
        now = datetime.now()
        h, m = now.hour, now.minute

        active_hours = config.get("verse_of_day", "active_hours")
        hour_ok = active_hours is None or active_hours[0] <= h <= active_hours[1]

        if hour_ok:
            for i, (start, end) in enumerate(config.get("verse_of_day", "time_windows", [])):
                if start <= m <= end:
                    window_id = h * 100 + i
                    if window_id != _verse_last_window:
                        _verse_last_window = window_id
                        if random.random() < config.get("verse_of_day", "probability", 0.30):
                            trigger("verse_of_day", source="auto")
                    break

    _evaluate()
