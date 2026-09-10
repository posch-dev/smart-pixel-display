# Clock

[Back to README](../../README.md) | [Next: Verse of Day](../verse_of_day/README.md)

Full-screen 24h digital clock. The colon blink time is adjustable through
the settings in the Web Application or in the `config.toml` file.

<img src="../../.github/assets/panels/clock/clock.png" alt="Clock cycling through 7 times" width="512">


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
./.venv/bin/python panels/clock/main.py              # on the display
./.venv/bin/python panels/clock/main.py --visualize  # in a browser tab, no display needed
```

`--visualize` serves the panel at `http://localhost:12833` and steps through five canned
times instead of reading the clock. Add `--live` to take the real time, `--no-browser` to
skip opening a tab. See [Flags](../../README.md#flags).

---

[Back to README](../../README.md) | [Next: Verse of Day](../verse_of_day/README.md)
