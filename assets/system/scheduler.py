# Mode scheduler with priority-based mode switching for the LED matrix.

import os
import sys
import random
import time
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
import assets.system.config as config

MODES = ["clock", "verse_of_day", "nowplaying", "dashboard"]

# clock is always triggered, it's the fallback when nothing else is active
_triggered: dict[str, float] = {"clock": time.time()}
_trigger_source: dict[str, str] = {"clock": "auto"}   # "auto" | "user"
_active_mode: str = "clock"
_active_since: float = time.time()
_verse_last_window: int = -1  # h*100+window_index, so we roll only once per window entry
_display_on: bool = True


def get_active_mode() -> str:
    return _active_mode


def get_display_on() -> bool:
    return _display_on


def set_display_on(on: bool) -> None:
    global _display_on
    _display_on = on


def has_user_trigger() -> bool:
    return any(_trigger_source.get(m) == "user" for m in _triggered if m != "clock")


def get_status() -> dict:
    return {
        "active_mode":     _active_mode,
        "active_since":    _active_since,
        "active_for_s":    round(time.time() - _active_since, 1),
        "triggered":       list(_triggered.keys()),
        "trigger_sources": dict(_trigger_source),
        "display_on":      _display_on,
    }


def trigger(mode: str, source: str = "user") -> None:
    # Mark a mode as active. 'source' is 'user' or 'auto'.
    _triggered[mode] = time.time()
    _trigger_source[mode] = source
    _evaluate()


def is_triggered(mode: str) -> bool:
    return mode in _triggered


def untrigger(mode: str) -> None:
    # Remove a mode's trigger so it no longer competes for the display.
    if mode == "clock":
        return
    _triggered.pop(mode, None)
    _evaluate()


def _evaluate() -> None:
    # Pick the highest-priority enabled triggered mode as the active one.
    global _active_mode, _active_since
    best, best_prio = "clock", -1
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
    # Called every second, handles expirations and time-based verse triggers.
    global _verse_last_window

    min_dur = config.get(_active_mode, "min_duration_s", 0)
    if min_dur > 0 and (time.time() - _active_since) >= min_dur:
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
