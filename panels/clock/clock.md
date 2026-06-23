# Clock

[Back to README](../../README.md) | [Next: Verse of Day](../verse_of_day/verse_of_day.md)

Full-screen 24h digital clock. The colon blinks every second.

![Clock cycling through 7 times](../../.github/assets/clock.gif)

Four digit slots (HH MM) laid out symmetrically across the 128x32 display. The font is binary-searched so the digit height fills exactly 32 pixels. The colon sits between hours and minutes and alternates on/off every `blink_interval` seconds.

No network calls. No API keys.

## Priority

Default priority: **1** (lowest). The clock is the fallback - when no other panel is active, the scheduler automatically falls back to it. Any panel with a higher priority (Verse of Day at 2, Now Playing at 3, Dashboard at 4) takes over when its trigger conditions are met. You can change the priority in `assets/config.toml`.

## Configuration

```toml
[clock]
priority       = 1
brightness     = 80           # 0-100
blink_interval = 2.0          # seconds per colon phase
color          = [0, 255, 0]  # RGB, default green
```

`[device]` settings also apply:

```toml
[device]
mac_address     = "XX:XX:XX:XX:XX:XX"
reconnect_delay = 3
flip_vertical   = true
flip_horizontal = true
active_hours    = [6, 22]     # display only runs between these hours
```

## Webhooks

Supports `on_enter` and `on_exit` webhooks.

## Running standalone

```bash
python panels/clock/main.py
```

---

[Back to README](../../README.md) | [Next: Verse of Day](../verse_of_day/verse_of_day.md)
