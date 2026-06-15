# Weather fetching, supports openmeteo (default), wttr.in, and NWS (US only).

import os
import sys
import requests

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import assets.system.config as config

# WMO weather codes → condition strings (openmeteo and wttr.in both use WMO codes)
_WMO: dict[int, str] = {
    0: "clear",  1: "clear",  2: "partly cloudy",  3: "overcast",
    45: "fog",  48: "fog",
    51: "drizzle",  53: "drizzle",  55: "drizzle",
    56: "drizzle",  57: "drizzle",
    61: "rain",  63: "rain",  65: "rain",
    66: "rain",  67: "rain",
    71: "snow",  73: "snow",  75: "snow",  77: "snow",
    80: "rain",  81: "rain",  82: "rain",
    85: "snow",  86: "snow",
    95: "thunderstorm",  96: "thunderstorm",  99: "thunderstorm",
}

# NWS shortForecast text → condition strings (checked in order, first match wins)
_NWS_MAP: list[tuple[str, str]] = [
    ("thunderstorm", "thunderstorm"),
    ("blizzard",     "snow"),
    ("snow",         "snow"),
    ("flurr",        "snow"),
    ("sleet",        "snow"),
    ("shower",       "rain"),
    ("rain",         "rain"),
    ("drizzle",      "drizzle"),
    ("fog",          "fog"),
    ("windy",        "windy"),
    ("overcast",     "overcast"),
    ("cloudy",       "partly cloudy"),
    ("partly",       "partly cloudy"),
    ("sunny",        "clear"),
    ("clear",        "clear"),
]


def _nws_condition(text: str) -> str:
    t = text.lower()
    for keyword, condition in _NWS_MAP:
        if keyword in t:
            return condition
    return "clear"


def set_location(lat: float, lon: float) -> None:
    w = config.get("dashboard", "weather", {})
    w["lat"] = lat
    w["lon"] = lon
    config.set("dashboard", "weather", w)


def _openmeteo(lat: float, lon: float, **_) -> dict:
    resp = requests.get(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": lat, "longitude": lon,
            "current": "temperature_2m,weathercode",
            "daily":   "temperature_2m_max,temperature_2m_min",
            "timezone": "auto", "forecast_days": 1,
        },
        timeout=10,
    )
    resp.raise_for_status()
    d = resp.json()
    return {
        "temp_now":  d["current"]["temperature_2m"],
        "temp_high": d["daily"]["temperature_2m_max"][0],
        "temp_low":  d["daily"]["temperature_2m_min"][0],
        "condition": _WMO.get(d["current"]["weathercode"], "clear"),
    }


def _wttr(lat: float, lon: float, location: str | None = None, **_) -> dict:
    query = location if location else f"{lat},{lon}"
    resp = requests.get(
        f"https://wttr.in/{query}",
        params={"format": "j1"},
        headers={"User-Agent": "LEDMatrix/1.0"},
        timeout=10,
    )
    resp.raise_for_status()
    d = resp.json()
    cur   = d["current_condition"][0]
    today = d["weather"][0]
    return {
        "temp_now":  float(cur["temp_C"]),
        "temp_high": float(today["maxtempC"]),
        "temp_low":  float(today["mintempC"]),
        "condition": _WMO.get(int(cur.get("weatherCode", 0)), "clear"),
    }


_nws_urls: dict = {}  # cached after first call: {"forecast": ..., "hourly": ...}

def _nws(lat: float, lon: float, **_) -> dict:
    global _nws_urls
    _HDR = {"User-Agent": "LEDMatrix/1.0"}

    if not _nws_urls:
        r = requests.get(
            f"https://api.weather.gov/points/{lat},{lon}",
            headers=_HDR, timeout=10,
        )
        r.raise_for_status()
        props = r.json()["properties"]
        _nws_urls = {"forecast": props["forecast"], "hourly": props["forecastHourly"]}

    def f_to_c(f: float) -> float:
        return round((f - 32) * 5 / 9, 1)

    hourly  = requests.get(_nws_urls["hourly"],   headers=_HDR, timeout=10).json()
    daily   = requests.get(_nws_urls["forecast"], headers=_HDR, timeout=10).json()

    current = hourly["properties"]["periods"][0]
    periods = daily["properties"]["periods"]
    day     = next((p for p in periods if p["isDaytime"]),  periods[0])
    night   = next((p for p in periods if not p["isDaytime"]), periods[1] if len(periods) > 1 else periods[0])

    return {
        "temp_now":  f_to_c(current["temperature"]),
        "temp_high": f_to_c(day["temperature"]),
        "temp_low":  f_to_c(night["temperature"]),
        "condition": _nws_condition(current["shortForecast"]),
    }


_PROVIDERS = {"openmeteo": _openmeteo, "wttr": _wttr, "nws": _nws}


def fetch_weather() -> dict:
    w        = config.get("dashboard", "weather", {})
    provider = w.get("provider", "openmeteo")
    lat      = w.get("lat",      -48.876667)
    lon      = w.get("lon",      -123.393333)
    location = w.get("location")

    fn = _PROVIDERS.get(provider, _openmeteo)
    return fn(lat=lat, lon=lon, location=location)


def format_weather(w: dict) -> str:
    return (
        "=== WEATHER ===\n"
        f"Now:   {w['temp_now']:.0f}°C  |  {w['condition'].title()}\n"
        f"High:  {w['temp_high']:.0f}°C     Low: {w['temp_low']:.0f}°C"
    )
