# Dashboard

[Back to README](../../README.md) | [Previous: Verse of Day](../verse_of_day/verse_of_day.md) | [Next: Now Playing](../now_playing/now_playing.md)

Clock, live weather, and upcoming calendar events with travel-time warnings on one screen.

## Priority

Default priority: **4** (highest). When an event is pushed to the dashboard, it takes over from everything else. Now Playing (priority 3) and lower-priority panels yield to it. Priority is set in `assets/config.toml`.

## Display modes

### Mode 1: Clock and weather only (no events)

Everything is laid out as one centered block. Clock digits sit on the left, then the large temperature number with a degree symbol at its top-right corner, then the weather condition icon floating above the high/low column, with high and low stacked to the right. Temperature colors shift when values drop below freezing: current temp goes from yellow to light blue, high from green to deep blue, low from red to purple.

Metric (°C):

| Clear | Rain | Snow | Storm |
|---|---|---|---|
| ![sunny](../../.github/assets/dashboard_weather_sunny.png) | ![rain](../../.github/assets/dashboard_weather_rain.png) | ![snow](../../.github/assets/dashboard_weather_snow.png) | ![storm](../../.github/assets/dashboard_weather_storm.png) |

| Fog | Overcast | Partly Cloudy |
|---|---|---|
| ![fog](../../.github/assets/dashboard_weather_fog.png) | ![cloudy](../../.github/assets/dashboard_weather_cloudy.png) | ![partly](../../.github/assets/dashboard_weather_partly.png) |

Temperature color variations (metric):

| +temp, low below 0 | -temp, high above 0 | -temp, all negative |
|---|---|---|
| ![low neg](../../.github/assets/dashboard_weather_low_neg.png) | ![below zero](../../.github/assets/dashboard_weather_below_zero.png) | ![all neg](../../.github/assets/dashboard_weather_all_neg.png) |

Imperial (°F):

| Clear | Snow (below freezing, shifts to blue) |
|---|---|
| ![sunny_f](../../.github/assets/dashboard_weather_sunny_f.png) | ![snow_f](../../.github/assets/dashboard_weather_snow_f.png) |

Switch between metric and imperial with `units = "metric"` or `units = "imperial"` under `[dashboard.weather]` in `assets/config.toml`, or toggle it in the web UI.

### Mode 2: Event without travel time

Clock and weather stay on the left half. To the right of the weather block: event title at the top, start and end time centered below it. Calendar icon with the current day number sits on the right edge, vertically centered.

![Mode 2 - Gym, no travel](../../.github/assets/dashboard_mode2.png)

### Mode 3: Event with travel time (countdown to departure)

For events with a travel time, a departure countdown is shown in the space between the weather block and the right edge. Car icon in the top-right corner, calendar icon with day number in the bottom-right. Minutes to leave (large) sit at the top of that space with the departure time below, and the event title is at the bottom next to the calendar icon.

45 min to leave, Casino:

![Mode 3 - 45 min](../../.github/assets/dashboard_mode3.png)

Far out (90+ min), Night Shift:

![Mode 3 - 90 min](../../.github/assets/dashboard_mode3_far.png)

### Mode 3: LEAVE NOW

When the departure time has passed, the countdown switches to "NOW!" followed by how many minutes late you are. The text alternates between purple and orange every second.

![Mode 3 - LEAVE NOW](../../.github/assets/dashboard_mode3_late.gif)

## How it works

`display.py` is the renderer. `main.py` owns the async loop.

Weather is fetched in the background and cached in `.weather_cache.json` for 15 minutes. Supported providers: [Open-Meteo](https://open-meteo.com) (default), wttr.in, and NWS (US only). None require an API key.

Calendar events are pushed into `calendar_store.py` via the web API (`POST /calendar`). The store is in-memory, events survive across display ticks but reset on restart.

Set travel time per event with the `_travel_minutes` field. When present, the panel switches to Mode 3 and shows the departure countdown.

## Setup

### Location for weather

Set your coordinates in `assets/config.toml`:

```toml
[dashboard.weather]
provider = "openmeteo"   # "openmeteo", "wttr", or "nws"
lat      = 48.2082
lon      = 16.3738
units    = "metric"      # "metric" or "imperial"
```

### Pushing calendar events

Events are sent from a calendar automation (Shortcuts, n8n, Home Assistant, or similar) to the web API:

```bash
curl -X POST http://<pi-ip>:5000/calendar \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Casino",
    "start_time": "2026-09-17T20:00:00+02:00",
    "end_time":   "2026-09-17T23:00:00+02:00",
    "isAllDay": false,
    "_travel_minutes": 35
  }'
```

Omit `_travel_minutes` for Mode 2 (event shown without departure countdown).

## Running standalone

```bash
python panels/dashboard/main.py
# or cycle through all display states with test data:
python panels/dashboard/display.py --test
```

---

[Back to README](../../README.md) | [Previous: Verse of Day](../verse_of_day/verse_of_day.md) | [Next: Now Playing](../now_playing/now_playing.md)
