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

### 1. Clone Repository and install dependencies

```bash
git clone https://github.com//smart-pixel-dashboard.git
cd smart-pixel-Dashboard

pip3 install -r requirements.txt --break-system-packages
# or use: pip3 install -r requirements.txt
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

run `startup.py`. The web UI will be at `http://<device-ip>:5000`.

You can also run each panel standalone, without the web UI:
```bash
python panels/<panel>/main.py
```

#### 3.1 Running on boot (Optional)

run 'install.sh' to setup systemd service:

```bash
./install.sh
```

##### 3.1.1 Managing the autostart Service:

```bash
sudo systemctl status smartpixelpanel    # Check status
sudo systemctl restart smartpixelpanel   # Restart
sudo systemctl stop smartpixelpanel      # Stop
journalctl -u smartpixelpanel -f         # View live logs
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
lat      = 48.2082
lon      = 16.3738
units    = "metric"            # "metric" or "imperial"
```

## Web UI and API

The web UI at port 5000 lets you switch panels, adjust brightness, and change settings. The REST API:

```
GET    /status                 - active mode, connected state, clearing status
POST   /mode/trigger/{name}   - trigger a mode: clock | verse_of_day | nowplaying | dashboard
DELETE /mode/{name}           - untrigger a mode (returns to scheduler)
POST   /mode/reset            - clear all manual triggers, hand back to auto-scheduler
POST   /calendar              - push a calendar event to the dashboard
DELETE /calendar              - clear all calendar events
GET    /dashboard/status      - current dashboard data
GET    /config                - full config dump
POST   /config/{section}/{key} - update a config value
```

## License

GPL-3.0 - any software that uses or distributes this code must also be released under the same license.
