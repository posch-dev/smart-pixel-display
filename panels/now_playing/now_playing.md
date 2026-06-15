# Now Playing

[Back to README](../../README.md) | [Previous: Dashboard](../dashboard/dashboard.md)

Shows the currently scrobbling track from Last.fm or Libre.fm with album art, title and artist text, a progress bar, and a BPM-synced frequency visualizer.

| go away - Tate McRae | trying on shoes - Tate McRae | All The Love - Kanye West |
|---|---|---|
| ![go away](../../.github/assets/nowplaying_go_away.gif) | ![trying on shoes](../../.github/assets/nowplaying_trying_on_shoes.gif) | ![All The Love](../../.github/assets/nowplaying_all_the_love.gif) |

The left 32 pixels show the album cover, fetched from iTunes and brightness-boosted for dark images. When no cover is found you get a colored gradient with a music note instead. The center column shows the track title in light blue at the top, artist and album below in accent colors pulled from the cover. Text that doesn't fit the column gets clipped. The right 32 pixels are an 8-bar frequency visualizer that pulses to the BPM, bar heights shaped by the genre preset (more bass for hip hop, higher for pop, etc.) with colors from the cover accents. The bottom two pixel rows are the progress bar, filling left to right as the track plays.

## Priority

Default priority: **3**. Activates whenever a track is scrobbling. Dashboard (priority 4) can override it when a calendar event is active. Priority is set in `assets/config.toml`.

## How it works

You need a Last.fm or Libre.fm scrobbler running on your phone or computer. Scrobblers exist for all major platforms and as browser extensions - what they can pick up (local files, streaming services, etc.) depends on the app.

`poller.py` runs in a background thread and polls your scrobbler at the configured rate. When a new track is detected:

1. Cover art is fetched from iTunes (no key needed).
2. BPM is looked up via GetSongBPM, with a genre-based estimate as fallback. Results are cached in a local SQLite database (`bpm_cache.db`).
3. Genre tags are fetched from Last.fm and used to pick a visualizer preset.
4. The `state` dict is updated.

`display.py` consumes the state and calls `generate_gif()`, which renders `frames_per_beat x 2` frames (one full beat, looping). The GIF is pushed to the device and re-generated on each track change.

`main.py` ties everything together, handles the slot upload/switch cycle, and re-renders when BPM arrives late.

## Scrobbler switching

You can switch between Last.fm and Libre.fm in `assets/config.toml` or from the web UI under the NowPlaying card. Last.fm allows up to 4 polls per second, Libre.fm is capped at 1 per second.

## API keys

All keys go in the `.env` file in the project root.

### Last.fm

1. Go to [last.fm/api/account/create](https://www.last.fm/api/account/create).
2. Fill in the app name and description, then submit.
3. Copy the API key and shared secret.

```env
LASTFM_API_KEY=your_api_key
LASTFM_SECRET=your_shared_secret
LASTFM_USERNAME=your_lastfm_username
```

### Libre.fm

No API key needed - just your username and password.

```env
LIBREFM_USERNAME=your_librefm_username
LIBREFM_PASSWORD=your_librefm_password
```

### GetSongBPM

1. Go to [getsongbpm.com/api](https://getsongbpm.com/api) and sign up for a free account.
2. Copy your API key from the dashboard.

```env
GETSONGBPM_API_KEY=your_api_key
```

### iTunes

Cover art is fetched from the iTunes Search API. No key or account needed.

## Configuration

```toml
[nowplaying]
priority   = 3
enabled    = true
brightness = 80
scrobbler  = "lastfm"   # "lastfm" or "librefm"
poll_s     = 0.5        # poll interval in seconds (min 0.25 for Last.fm, min 1.0 for Libre.fm)
slot_a     = 0          # BLE slot for primary GIF
slot_b     = 1          # BLE slot for standby GIF
chunk_s    = 20         # seconds per GIF chunk before re-rendering
font       = 1          # 1-4, selects the text font
```

The genre preset (the frequency curve that shapes the visualizer bars) is picked automatically from Last.fm genre tags. All presets are in `panels/now_playing/genre_presets.py`.

## Running standalone

```bash
python panels/now_playing/main.py
```

---

Partially powered by [GetSongBPM](https://getsongbpm.com).

[Back to README](../../README.md) | [Previous: Dashboard](../dashboard/dashboard.md)
