# Smart Pixel Dashboard

A smart dashboard display for 128x32 RGB LED matrix panels. It runs on anything that has Python and Bluetooth (e.g Rasperry Pi Zero 2 w). The display itself just needs to support BLE and the pypixelcolor protocol (e.g. iPixel panel).

Four panels cycle on the display based on time, whether music is playing, and what's coming up on the calendar. You can also switch between them manually through the web UI or the REST API.

![Preview](.github/assets/preview.gif)

What it does:
- Shows Time as a digital 24h Clock
- Occasionally displays todays Bible Verse throughout the day.
- Displays Albumcover, Trackinfo and a Beatvisualizer from your currently listened to song when playing music on streaming services (i.e Apple Music, Spotify, YouTube Music)
- Shows you current weather information as well as dynamic personalized calender event information with optional departure time

## Hardware

- Display: 128x32 RGB LED matrix with BLE + pypixelcolor support (e.g. iPixel)
- Controller: any device with Python 3 and Bluetooth (Raspberry Pi, laptop, etc.)

→ [Jump to Setup](#setup)

BLE communication uses [pypixelcolor](https://pypi.org/project/pypixelcolor/).

## Panels

Each panel has a priority in `assets/config.toml`. Higher number wins. Clock is always on as the fallback at priority 1.

The scheduler handles switching automatically. Now Playing triggers when it detects a track scrobbling, Dashboard triggers when a calendar event is active, Verse of Day fires on a probability roll during its configured time windows. Manually triggering a panel from the web UI or API overrides the auto-scheduler until you hit "reset to auto". Outside `active_hours`, the display goes dark.

| Panel | What it shows |
|---|---|
| [Clock](panels/clock/clock.md) | ![](.github/assets/clock.gif) <br> 24h digital clock with blinking colon |
| [Verse of Day](panels/verse_of_day/verse_of_day.md)* | ![](.github/assets/verse_preview.gif) <br> Daily Bible verse from YouVersion |
| [Now Playing](panels/now_playing/now_playing.md)* | ![](.github/assets/nowplaying_preview.gif) <br> Last.fm/Libre.fm track with cover art, BPM visualizer, progress bar |
| [Dashboard](panels/dashboard/dashboard.md) | ![](.github/assets/dashboard_preview.gif) <br> Live weather and calendar events with travel countdowns |

\*Requires free API keys. Check the panel's `.md` file for which keys you need and how to get them.

## Setup

**Prerequisites:** Python 3.11+, python3-venv, Bluetooth

### 1. Clone and install

```bash
git clone https://github.com/posch-dev/smart-pixel-dashboard.git
cd smart-pixel-dashboard
./install.sh
```

The install script creates a `.venv` in the repo, installs all dependencies, and sets up a systemd service (`smartpixeldashboard`).

If you prefer doing it manually:
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure your device

Add your panel's MAC address to `assets/config.toml`:

```toml
[device]
mac_address = "XX:XX:XX:XX:XX:XX"
```

To find the address, pair the device via Bluetooth and run `bluetoothctl devices`.

#### 2.1 Add API keys (optional)

Create a `.env` file in the project root:

```env
# Required for Verse of Day
YOUVERSION=your_youversion_app_key

# Required for Now Playing (pick one scrobbler)
LASTFM_API_KEY=your_lastfm_key
LASTFM_SECRET=your_lastfm_secret
LASTFM_USERNAME=your_lastfm_username

# Or use Libre.fm instead (no API key needed, just credentials)
LIBREFM_USERNAME=your_librefm_username
LIBREFM_PASSWORD=your_librefm_password

GETSONGBPM_API_KEY=your_getsongbpm_key
```

Clock and Dashboard work out of the box, no keys needed. Now Playing supports [Last.fm or Libre.fm](panels/now_playing/now_playing.md) as scrobbler. All keys are free. Check [now_playing.md](panels/now_playing/now_playing.md) and [verse_of_day.md](panels/verse_of_day/verse_of_day.md) for step-by-step instructions on how to get and set them up.

### 3. Start

```bash
source .venv/bin/activate
python startup.py
```

The web UI will be at `http://<device-ip>:5000`.

You can also run each panel standalone:
```bash
python panels/<panel>/main.py
```

#### 3.1 Running on boot (optional)

If you ran `./install.sh`, the systemd service is already set up:

```bash
sudo systemctl start smartpixeldashboard      # Start
sudo systemctl status smartpixeldashboard     # Check status
sudo systemctl restart smartpixeldashboard    # Restart
sudo systemctl stop smartpixeldashboard       # Stop
journalctl -u smartpixeldashboard -f          # Live logs
```

## Configuration

Everything lives in `assets/config.toml`. The web UI and API write changes back to disk immediately. Key settings:

```toml
[device]
active_hours    = [6, 22]      # display off outside these hours
flip_vertical   = true         # for panels mounted upside-down
flip_horizontal = true

[clock]
brightness = 80
color      = [0, 255, 0]

[verse_of_day]
enabled     = true
probability = 0.30             # chance to auto-trigger per scheduler tick

[nowplaying]
brightness = 80
scrobbler  = "lastfm"          # "lastfm" or "librefm"

[dashboard]
[dashboard.weather]
lat      = 40.7580
lon      = -73.9855
units    = "metric"            # "metric" or "imperial"
```

Each panel supports webhooks* that fire HTTP requests on `on_enter` and `on_exit`. Device-level webhooks fire on power on/off and active hours start/end.

\*Now Playing also supports `on_song_change`, which fires when a new song is displayed. It has template variables for accent colors (`{{accent1_hex}}`, `{{accent1_rgb}}`, `{{accent1_full_r}}`, etc.), track info (`{{title}}`, `{{artist}}`, `{{album}}`), and full-brightness color variants for external devices like WLED.

## Web UI and API

The web UI at port 5000 lets you switch panels, adjust brightness, configure webhooks, and change settings. The REST API:

```
GET    /status                 - active mode, connected state, clearing status
POST   /display/power          - turn display on/off: {"on": true/false}
GET    /mode                   - current mode, triggers, display state
POST   /mode/trigger/{name}   - trigger a mode: clock | verse_of_day | nowplaying | dashboard
DELETE /mode/{name}           - untrigger a mode (returns to scheduler)
POST   /mode/reset            - clear all manual triggers, hand back to auto-scheduler
POST   /calendar              - push a calendar event to the dashboard
GET    /calendar              - list all calendar events
DELETE /calendar              - clear all calendar events
POST   /dashboard/trigger     - manually trigger dashboard
GET    /dashboard/status      - current dashboard data (weather + calendar)
GET    /config                - full config dump
POST   /config/{section}/{key} - update a config value: {"value": ...}
```

## License

GPL-3.0 - any software that uses or distributes this code must also be released under the same license.
