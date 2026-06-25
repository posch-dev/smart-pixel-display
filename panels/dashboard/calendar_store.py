# In-memory store for calendar events received from the iPhone Shortcut.

import math
import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

_BIRTHDAY_RE = re.compile(r"^(.+)'s (\d+)(?:st|nd|rd|th) Birthday$")

_events: list[dict] = []
_birthdays: list[dict] = []


def _parse_birthday(event: dict) -> dict | None:
    title = event.get("title", "").replace("'", "'")
    m = _BIRTHDAY_RE.match(title)
    if not m:
        return None
    full_name = m.group(1).strip()
    age = int(m.group(2))
    parts = full_name.split()
    return {"first_name": parts[0], "last_name": parts[-1] if len(parts) > 1 else "", "age": age}


def append_event(event: dict) -> None:
    # Shortcut sends travel time as "travel_time" string (may be "NaN")
    if "travel_time" in event:
        try:
            minutes = float(event["travel_time"])
            event["_travel_minutes"] = None if math.isnan(minutes) else int(minutes)
        except (ValueError, TypeError):
            event["_travel_minutes"] = None
    elif "_travel_minutes" not in event:
        event["_travel_minutes"] = None
    _events.append(event)
    if event.get("calendar_name") == "Birthdays":
        parsed = _parse_birthday(event)
        if parsed:
            _birthdays.append(parsed)


def clear_events() -> None:
    global _events, _birthdays
    _events = []
    _birthdays = []


def get_events() -> list[dict]:
    global _events, _birthdays
    today = datetime.now().date()
    stale = []
    for ev in _events:
        try:
            ev_date = datetime.fromisoformat(ev["start_time"]).date()
            if ev_date < today:
                stale.append(ev)
        except (ValueError, KeyError):
            pass
    if stale:
        _events = [e for e in _events if e not in stale]
        _birthdays = [b for b in _birthdays if b not in stale]
    return _events


def get_birthdays() -> list[dict]:
    return _birthdays


def _leave_dt(ev: dict, local_tz) -> datetime | None:
    travel = ev.get("_travel_minutes")
    if travel is None:
        return None
    try:
        start_dt = datetime.fromisoformat(ev["start_time"]).astimezone(local_tz)
        return start_dt - timedelta(minutes=travel)
    except (ValueError, KeyError):
        return None


def format_events() -> str:
    if not _events:
        return "=== CALENDAR (0 events) ===\n(none)"

    local_tz = ZoneInfo("Europe/Vienna")
    now = datetime.now(local_tz)

    timed = []
    for ev in _events:
        if not (ev.get("is_all_day") or ev.get("isAllDay", False)):
            try:
                ev["_start_dt"] = datetime.fromisoformat(ev["start_time"]).astimezone(local_tz)
                timed.append(ev)
            except (ValueError, KeyError):
                pass
    timed.sort(key=lambda e: e["_start_dt"])

    next_ev = next((e for e in timed if _leave_dt(e, local_tz) is not None), None)

    lines = [f"=== CALENDAR ({len(_events)} events) ==="]

    for ev in _events:
        is_all_day = ev.get("is_all_day") or ev.get("isAllDay", False)
        title = ev.get("title", "")

        if ev.get("calendar_name") == "Birthdays":
            parsed = _parse_birthday(ev)
            if parsed:
                fn, ln, age = parsed["first_name"], parsed["last_name"], parsed["age"]
                title = f"{fn} {ln} \U0001f382 turns {age}"
            else:
                title = f"{title} \U0001f382"

        if is_all_day:
            prefix = "[All Day]"
        else:
            try:
                prefix = f"[{ev['_start_dt'].strftime('%H:%M')}]  "
            except KeyError:
                prefix = "[??:??]  "

        lines.append(f"{prefix} {title} ({ev.get('calendar_name', '')})")

        if not is_all_day and ev is next_ev:
            leave = _leave_dt(ev, local_tz)
            if leave is not None:
                if leave > now:
                    leave_in = round((leave - now).total_seconds() / 60)
                    timing = f"leave by {leave.strftime('%H:%M')} (in {leave_in} min)"
                else:
                    late = round((now - leave).total_seconds() / 60)
                    timing = f"LEAVE NOW! ({late} min late)"
                lines.append(f"          — {timing}")

    return "\n".join(lines)
