
import random
import sys
import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "panels", "dashboard"))

import calendar_store
import weather as weather_mod

LOCAL_TZ = ZoneInfo("Europe/Vienna")

CONDITIONS = ["clear", "partly cloudy", "overcast", "rain", "thunderstorm", "fog", "snow", "drizzle"]


def random_weather() -> dict:
    base = random.randint(5, 32)
    return {
        "temp_now": base,
        "temp_high": base + random.randint(1, 6),
        "temp_low": base - random.randint(1, 8),
        "condition": random.choice(CONDITIONS),
    }


def ordinal(n: int) -> str:
    if 11 <= n % 100 <= 13:
        return f"{n}th"
    return f"{n}{['th','st','nd','rd','th'][min(n % 10, 4)]}"


def fhwn_event(start_dt: datetime, travel_minutes: int) -> dict:
    ev = {
        "calendar_name": "FHWN",
        "title": "Mathematik - ILV",
        "start_time": start_dt.isoformat(),
        "end_time": (start_dt + timedelta(hours=1, minutes=30)).isoformat(),
        "location": "C1 AM",
        "isAllDay": False,
        "_travel_minutes": travel_minutes,
    }
    return ev


def birthday_event(first: str, last: str, age: int) -> dict:
    today = datetime.now(LOCAL_TZ).replace(hour=0, minute=0, second=0, microsecond=0)
    return {
        "calendar_name": "Birthdays",
        "title": f"{first} {last}’s {ordinal(age)} Birthday",
        "start_time": today.isoformat(),
        "end_time": today.replace(hour=23, minute=59, second=59).isoformat(),
        "location": "",
        "isAllDay": True,
        "_travel_minutes": None,
    }


def run_scenario(label: str, events: list[dict]) -> None:
    calendar_store.clear_events()
    for ev in events:
        calendar_store.append_event(ev)

    print(f"\n{'─' * 55}")
    print(f"  {label}")
    print(f"{'─' * 55}")
    print(calendar_store.format_events())
    print()
    print(weather_mod.format_weather(random_weather()))
    if birthdays := calendar_store.get_birthdays():
        print(f"\n[parsed birthdays] {birthdays}")


now = datetime.now(LOCAL_TZ)

# leave_dt = start - 35 - 5 = now + 103 - 40 = now + 63 min
run_scenario(
    "Scenario 1 — event in 1h43m, 35min travel",
    [fhwn_event(now + timedelta(hours=1, minutes=43), 35)],
)

# leave_dt = now - 7  →  start = leave_dt + 40 = now + 33
run_scenario(
    "Scenario 2 — 7 minutes late (LEAVE NOW!)",
    [fhwn_event(now + timedelta(minutes=33), 35)],
)

run_scenario(
    "Scenario 3 — event in 1h43m + 1 birthday",
    [
        fhwn_event(now + timedelta(hours=1, minutes=43), 35),
        birthday_event("Anna", "Müller", 29),
    ],
)

run_scenario(
    "Scenario 4 — 7 min late + 2 birthdays",
    [
        fhwn_event(now + timedelta(minutes=33), 35),
        birthday_event("Thomas", "Berger", 45),
        birthday_event("Sophie", "Kaufmann", 31),
    ],
)
