# Verse of Day

[Back to README](../../README.md) | [Previous: Clock](../clock/clock.md) | [Next: Dashboard](../dashboard/dashboard.md)

Fetches the YouVersion verse of the day and shows it as a pixel-art cross with the book name and chapter:verse reference. Built for Christians who want a quiet daily reminder on their desk without picking up the phone.

| Short | Medium | Long book name |
|---|---|---|
| ![JOHN 5:4](../../.github/assets/verse_short.png) | ![ROMANS 8:18](../../.github/assets/verse_medium.png) | ![REVELATION 22:21](../../.github/assets/verse_long.png) |

Cross and text are centered together as a group. The cross is on the left of that group in the configured panel color, book name at the top-right of the cross, chapter and verse at the bottom-right, both in PerfectDOS VGA 437. If the book name is too long to fit, it gets trimmed character by character until it does. Numeric prefixes like `1 KINGS` use a tighter gap to save pixels.

## Priority

Default priority: **2**. It only triggers during configured time windows (7:00-10:00 by default) with a probability roll each tick. Now Playing (priority 3) and Dashboard (priority 4) can override it. Priority is set in `assets/config.toml`.

## How it works

`main.py` calls the YouVersion API once per day to get the verse reference (e.g. `JHN.3.16`), converts it to a display string (`JOHN 3:16`), and renders it. The rendered image is re-sent every `refresh_interval` seconds to keep the display alive without re-fetching. A local JSON cache avoids hitting the API on restart.

## API key: YouVersion

1. Go to [developer.youversion.com](https://developer.youversion.com) and sign in with your YouVersion account.
2. Create an application to get an App Key.
3. Add it to your `.env` file:

```env
YOUVERSION=your_app_key_here
```

Call `GET /v1/verse_of_the_days/{day_of_year}` with the key in the `X-YVP-App-Key` header.

## Configuration

```toml
[verse_of_day]
priority         = 2
enabled          = true
brightness       = 60
color            = [125, 40, 125]   # RGB purple
refresh_interval = 30               # seconds between BLE re-sends
probability      = 0.30             # auto-trigger chance per scheduler tick
active_hours     = [7, 10]          # hours when auto-trigger can fire
time_windows     = [[7, 11], [18, 25], [33, 41], [47, 56]]  # minute ranges within each hour
```

## Webhooks

Supports `on_enter` and `on_exit` webhooks.

## Running standalone

```bash
python panels/verse_of_day/main.py
```

---

[Back to README](../../README.md) | [Previous: Clock](../clock/clock.md) | [Next: Dashboard](../dashboard/dashboard.md)

Amen.
