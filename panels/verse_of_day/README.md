# Verse of Day

[Back to README](../../README.md) | [Previous: Clock](../clock/README.md) | [Next: Dashboard](../dashboard/README.md)

There is one bible verse per day, and the panel shows it at random times throughout the
day. How often it comes up is a matter of chance, you set the probability and it rolls
for it in its time windows.

<img src="../../.github/assets/verse_preview.gif" alt="Preview" width="512">

| Short book name                      | Medium book name             | Long book name |
|--------------------------------------|-------------------------------------------------------|---|
| <img src="../../.github/assets/verse_short.png" alt="JOHN 5:4" width="256"> | <img src="../../.github/assets/verse_medium.png" alt="ROMANS 8:18" width="256"> | <img src="../../.github/assets/verse_long.png" alt="REVELATION 22:21" width="256"> |

Book names that are too long for the line get cut off, like REVELATION above.

## Configuration

Everything below is in the web app under **Panels -> Verse**, or in `config.toml` if you
would rather type. The priority is the exception: it sits under **Settings -> Device**,
where you drag the panels into the order you want.

```toml
[verse_of_day]
enabled        = true
priority       = 2
brightness     = 100              # 1 to 100
color          = [255, 255, 255]  # RGB
min_duration_s = 120              # seconds to show before falling back
probability    = 0.3              # 0.0 to 1.0, the chance per time window
translation    = "bolls:ESV"
# active_hours = [7, 10]          # restrict to an hour range, omit the line for all hours
```

The time windows the roll happens in (`time_windows`) and the interval between BLE
re-sends (`refresh_interval`) are expert settings and live in `[expert]`.

## Webhooks

Supports `on_enter` and `on_exit` webhooks.

## Running standalone

```bash
python panels/verse_of_day/main.py
```

---

[Back to README](../../README.md) | [Previous: Clock](../clock/README.md) | [Next: Dashboard](../dashboard/README.md)

Amen.
