# Clock

[Back to README](../../README.md) | [Next: Verse of Day](../verse_of_day/README.md)

Full-screen 24h digital clock. The colon blink time is adjustable through
the settings in the Web Application or in the `config.toml` file.

<img src="../../.github/assets/clock.gif" alt="Clock cycling through 7 times" width="512">


## Configuration

Everything below is in the web app under **Panels -> Clock**, or in `config.toml` if you
would rather type. The priority is the exception: it sits under **Settings -> Device**,
where you drag the panels into the order you want.

```toml
[clock]
enabled        = true
priority       = 1            # higher number wins over lower
brightness     = 10           # 1 to 100
color          = [0, 255, 0]  # RGB, default green
blink_interval = 2            # seconds per colon phase
```

## Webhooks

Supports `on_enter` and `on_exit` webhooks.

## Running standalone

```bash
python panels/clock/main.py
```

---

[Back to README](../../README.md) | [Next: Verse of Day](../verse_of_day/README.md)
