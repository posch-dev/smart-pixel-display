# Changelog

All notable changes to smart pixel display. Newest first.

## v1.3.0 - unreleased

### Added

- Twin: The web UI carries a looksmaxxed version of whatever the panel is showing right now. Same data the display gets, easier on the eyes.
- Fullscreen twin viewer: The twin gets a page of its own, with far more settings than the tile has room for and every export option in one place.
- Export: A still leaves as SVG or PNG, a moving panel as GIF, MP4 or WebM. The dashboard can also film a whole day at one minute of day per second of film, which is lowkey the most fun thing in this release.
- Preview controls: Colours, cover glow, dot raster, tile grain, playhead and a panel you can drag around sit in a drawer next to the stage. Every panel remembers its own set.
- Icons: Pixel glyphs run through the whole UI now, so the thing finally looks like it belongs to the display it drives.
- Home tab: One screen holds the live tile, the panel squares, the trigger controls and the connection pill. It fits on a phone without scrolling, which took embarrassingly long to get right.
- Settings tab: Theme, accent colour and preview mode live here, next to an about block that credits the icon sets.
- Interactive installer: Setup asks instead of assuming. It scans for the display over Bluetooth, walks the panels one by one, takes the keys and coordinates each one needs, offers autostart on Linux and Windows, and starts the service when it is done.
- Update check: `./install.sh --check-update` asks GitHub whether something newer is out, and `--update` pulls it and restarts.
- Update notice: The web UI asks GitHub for the newest release and says so above the credits when you are behind, with a link straight to it.
- Verse translations: The verse of the day comes from OurManna and you pick the translation in the web UI.
- Direct connect: A config switch connects by address instead of scanning first, for when the panel is being stubborn and sitting on a stale link.
- Debug log: Verbose logging turns on from the config, from `--debug` or from `SPD_DEBUG`. You never have to touch the systemd unit for it.
- Config template: `config.example.toml` ships with the repo and the installer builds your `config.toml` out of it.
- Timezone: The dashboard reads the clock of the machine it runs on instead of a hardcoded Europe/Vienna, on Linux and on Windows alike. Set the zone with your OS, `timedatectl set-timezone` on a Pi, and the installer prints back what it found.
- Panel order: Drag the panels around in the enable card to set their priority.
- Dashboard API: The web UI asks the Pi what the dashboard would show at any minute of the day, so nobody has to write that maths a second time in JavaScript.
- Location picker: The weather stops asking for decimal degrees. Name a place or drop a pin on a map and the web UI works out the coordinates for you, the installer takes either form in one question. The map wears the theme and the accent colour like the rest of the UI.

### Changed

- Web UI overhaul: Almost every screen got rebuilt and plenty of controls moved. Give it a minute, it makes more sense than it used to.
- Usability: Settings turn up when they apply and stay out of the way when they do not, the nav remembers where you left it, and the mobile layout is no longer an afterthought.
- Logging: Every line goes through one module with levels and tags, so `journalctl -p err` actually filters something.
- Config location: `config.toml` sits in the repo root, stays out of git, and everything the web UI cannot reach lives in an `[expert]` block at the bottom.
- Default port: The web UI and the API listen on 12832 unless you say otherwise.
- Name: The project is smart pixel display now, not smart pixel dashboard. The systemd unit is `smartpixeldisplay.service` and the Windows task is SmartPixelDisplay; the installer removes the old ones on the way past. The dashboard panel keeps its own name.
- Weather config: `location` holds the name of the place you picked instead of the old wttr override, and `location_mode` remembers which of the two inputs the web UI shows. Coordinates are what gets stored either way, so nothing is looked up again once it is set.
- Labels: The panel descriptions and the lines under the settings say what a thing is instead of explaining it at length.

### Fixed

- Brightness on a panel switch: Switching panels could leave the display sitting at the old panel's brightness. The switch cancelled whatever was still being sent, and the brightness command went down with it, so the new panel drew at the wrong level until something else set it.
- Environment file: The bpm cache looked for a `.env` beside its own module, where there never was one, so the getsongbpm key went unread and the bpm readout stayed empty. It takes the one in the repo root.
- Panel nav on a phone: The nav row scrolls, but with its scrollbar hidden a row that happened to end flush with the screen edge looked like the whole list. The side that still has panels behind it frays out now.
- Freeze: Freezing the twin held the picture but not the reading behind it. Freeze during a song, wait for the next one, export, and the file came out with the wrong song on it. A still is a still now, for all four panels.
- Album in exports: The album name sits at the end of its box in the twin and came out at the front of it in every exported file. It lands where the row shows it.

### Removed

- Timed triggers: A trigger could carry an expiry time that no caller ever set. If some shortcut of yours sends `expires_at`, it gets a trigger without an expiry.
- DNS workaround: A process wide `getaddrinfo` replacement is gone. It was doing a lot more than its name suggested.

## v1.2.2 - 2026-08-29

### Added
- Live re-rendering for verse color, no restart required anymore
- New `on_verse_change` webhook
- Brightness reassert after each send
- `start_powered_off` config option: display starts powered off when active hours are unset (prevents the panel going bright on a night-time reboot; with a schedule configured, the hour range still decides)
- "Start Powered Off" toggle in the Device tab (`index.html`, `script.js`)
- Links to the iPhone Shortcuts in README and dashboard docs

### Changed
- Power toggles outside active hours now fire `active_start`/`active_end` webhooks instead of `power_on`/`power_off`
- `startup.py`: `device.start_powered_off` flips `display_on` once before the connect loop (instead of a boot-black state with no `on_power_off` fired)
- `assets/config.toml`: new key `start_powered_off`, default `false`
- `README.md`: config excerpt updated with `start_powered_off`

## v1.2.1 - 2026-07-02

**NowPlaying**
- The "seamless transition" path (when the next song is already detected during the last 10s of the current one) now waits for the cover the same way a normal song change does, instead of rendering with a placeholder immediately. If the current song happens to end before that wait finishes, the currently displayed slot just stays up until the next render is ready
- get_now_playing() and the metadata fetch (cover, album, tags, duration) are now guarded with 15s/20s timeouts, so a hung Last.fm/Spotify request can no longer stall the poller forever.

**Stability**
- Fixed a bug where the clock display would freeze (e.g. stuck at "21:59" despite active hours ending at 22:00), silently skipping the active-hours transition and its webhooks. Root cause: Verse of Day was fetching/rendering its verse synchronously on the main loop, blocking everything.

**Triggers (Web UI)**
- Timed triggers and "hold indefinitely" locks used to live entirely in the browser, closing or reloading the tab could leave a trigger stuck forever ("limbo state"). Expiry is now tracked server-side, and the web UI reconciles its state from the server on every load/reload.

**Active Hours & Power**
- When active hours end automatically, the manual power switch in the UI now correctly reflects "off" (previously it kept showing "on").
- Manually turning the display on outside active hours now keeps it on until manually turned off again (like an indefinite panel trigger), instead of immediately turning back off. Turning it off again restores normal after-hours behavior. If active hours start naturally on their own, the override is cleared automatically.
- New setting: "Auto Sleep After Hours": when turned on manually outside active hours, an optional timer (adjustable via a slider) can automatically turn it back off instead of staying on indefinitely.

## v1.2.0 - 2026-06-23

### New features

- Webhooks. Each panel has a webhooks toggle in the web UI now. Turn it on and you can add HTTP requests that fire on `on_enter` (panel becomes active) and `on_exit` (panel gets switched away from). Device-level webhooks fire on power on/off and active hours start/end. Now Playing gets an extra trigger, `on_song_change`, which fires when a new song actually shows up on the display (after the GIF uploads and the slot switches, not when the poller first detects it).
- Webhook template variables for Now Playing. The `on_song_change` body and URL support `{{accent1_hex}}`, `{{accent1_rgb}}`, `{{accent1_r}}`, `{{accent1_g}}`, `{{accent1_b}}`, `{{accent1_hsv}}`, `{{title}}`, `{{artist}}`, `{{album}}`, same thing for accent2 and accent3. There's also full-brightness variants (`{{accent1_full_hex}}`, `{{accent1_full_rgb}}`, `{{accent1_full_r/g/b}}`) that keep the same hue and saturation but at 100% value, for stuff like WLED strips that handle brightness on their own.
- Webhook editor in the web UI. It's a modal with method dropdown (GET/POST/PUT/PATCH/DELETE), URL field, key-value header rows you can add and remove like in iOS Shortcuts, and a body textarea that only shows for methods that actually have a body. Now Playing gets a collapsible "Variables" section with clickable buttons that insert the variable at your cursor position.
- Active hours grace period. When active hours end, the display spends 2 minutes sending a black screen every 10 seconds to make sure the panel is actually off before going into the sleep loop.
- Install script. `./install.sh` checks for Python 3.11+, python3-venv, and Bluetooth, creates a `.venv` inside the repo, installs everything there, and sets up the `smartpixeldisplay` systemd service. No more `pip install --break-system-packages`.
- Disabled panels are greyed out in the Trigger tab now with a "disabled" badge, and you can't click their inputs.
- Event grace period. Dashboard panels triggered by upcoming calendar events now stay visible past the departure time (or event start if there's no travel time) for a configurable grace period.

### Accent colors

- Rewrote the accent color algorithm. Colors are picked by prominence now (how many pixels on the cover share that hue) instead of vibrancy. Most common color becomes accent1 (artist text, visualizer bottom), second most common is accent2 (album text, visualizer middle), third is accent3 (visualizer top).
- Monochrome covers (like Jesus Is King, which is basically all blue) now get saturation and value variants of the dominant hue instead of random colors at 120 degree offsets that have nothing to do with the cover.
- accent3 (visualizer top) is now always the color most different from accent1 (visualizer bottom). Before this, accent2 could end up being the most contrasting one, stuck in the middle where nobody notices it.
- Placeholder cover when there's no album art is just black with a centered white music note now. Was a gradient before.
- Fallback accent colors (no cover art) changed from pink/blue/yellow to lime green, orange, and turquoise.

### BLE stability

- Fixed a bug where Now Playing would randomly lose BLE connection because it did all its BLE writes (GIF uploads, slot switches, brightness changes, slot deletes) without the ble_lock. Every other panel used the lock. So when Now Playing uploaded a GIF while the clock task sent a frame or the slot clearer deleted a slot at the same time, the concurrent writes corrupted the connection and the whole thing crashed.
- Fixed a bug where a failed GIF upload just printed "upload failed" and kept looping with a dead BLE client forever. The exception got caught and swallowed inside `run_loop`, so it never made it up to `startup.py` where the reconnect logic lives. Upload failures now kill the mode task, startup.py catches that, and it reconnects.
- Fixed a bug where `tick_loop` and `clear_slots` tasks were never cancelled on reconnect. Every time BLE dropped and came back, a new `tick_loop` got created without cancelling the old one. After a few reconnects you'd have multiple tick loops running in parallel, all calling `scheduler.tick()` every second, which made modes expire and switch around randomly.
- Quick reconnect. If BLE disconnects and comes back within 2 minutes, slot clearing gets skipped. The display picks up where it left off instead of wiping all 256 slots. Disconnects longer than 2 minutes still do a full clear like a fresh boot.
- Fixed a bug where `_black_keepalive` in Now Playing swallowed all BLE exceptions with `except Exception: pass`. If the connection dropped while keepalive was running, it just looped endlessly trying to send black frames to a dead client, hogging the ble_lock every time.

### Bug fixes

- Fixed a bug where the accent color algorithm produced pink/magenta instead of red for covers that are mostly red (like My Beautiful Dark Twisted Fantasy). The hue averaging used a linear mean, which breaks for hues near 0/360 degrees. Pixels at 351 degrees (red) and 6 degrees (warm brown) averaged to ~178 degrees (cyan) instead of ~358 degrees (red). Switched to circular mean with atan2(sin, cos).
- Fixed a bug where playing music while manually holding Clock (or any panel you triggered manually from the web UI) would still auto-switch to Now Playing. `has_user_trigger()` had a `m != "clock"` filter that excluded Clock from the check, so manually triggering Clock didn't count as a user trigger and the now playing watcher just ignored it.
- Fixed a bug where the calendar POST endpoint returned a 400 when the request body was empty or not a dict. The auto-trigger should fire regardless of whether there's event data in there. Now it always triggers the dashboard (if auto-trigger is on) and only appends event data when there's a valid dict.
- Fixed a bug where changing the Now Playing font in the web UI or config did absolutely nothing. `display.set_font()` was never called with the config value, so it was hardcoded to the default forever. Now it reads from config on start and checks for changes every poll cycle.

### Web UI

- Weather settings card is inside the Dashboard settings now, so it hides when Dashboard is disabled. "City Name" field only shows when wttr.in is the selected provider.
- Device tab active hours toggle matches the verse panel layout now (toggle left, label right, sub-row hidden by default).

### Docs

- README setup section rewritten with clone + `./install.sh` workflow, venv instructions, and correct systemd service name (`smartpixeldisplay`).
- README documents webhooks now, with an asterisk noting `on_song_change` is Now Playing only.
- API endpoint list has all endpoints now: `/display/power`, `GET /mode`, `GET /calendar`, `POST /dashboard/trigger`.
- Now Playing docs updated with webhooks section, template variables, full-brightness variants, corrected font default (3 instead of 1).
- Clock, Verse of Day, and Dashboard docs each got a short webhooks section.
- `requirements.txt` uses minimum versions (`>=`) instead of pinned (`==`) so it actually installs on different architectures.

## v1.1.0 - 2026-06-18

### New features

- Background processes (Last.fm/Libre.fm poller, weather fetcher, now playing watcher) now fully pause when the display is turned off or falls outside active hours. They resume automatically when the display comes back on.
- Changing active hours in the web UI now takes effect immediately. Previously the main loop slept in 15-minute cycles, so a config change could take up to 15 minutes to register. The loop now uses an asyncio.Event that fires on every config write, waking it up instantly.
- You can now toggle whether a POST /calendar request automatically triggers the dashboard. Previously this was always on.
- New option to auto-trigger the dashboard 'X' hours before an upcoming event. Uses the departure time (start minus travel time if set, otherwise start time). Example: event "Saufen" at 23:00 with 1.5h travel, configured to 2 hours before, triggers at 19:30 because departure is 21:30. Configurable in the web UI with a toggle and hours input.
- Long song titles, artist names, and album names on the now playing panel are now truncated at the character boundary where they'd overflow the 60px text area.
- Parenthetical and bracketed content is stripped from now playing text automatically. "ALL THE LOVE (feat. Andre Troutman)" becomes "ALL THE LOVE", "So Close To What (Deluxe Edition)" becomes "So Close To What".
- The Panels tab in the web UI now has sub-tabs for Clock, Verse, NowPlaying, and Dashboard. Only one panel's settings are visible at a time instead of all four stacked.
- The main tab bar and the panel sub-tabs are now sticky, so they stay visible when scrolling.
- Settings that depend on a toggle only show up when the toggle is in the right state. Disabling a panel hides all its settings. Enabling "Global Brightness" hides the local slider. Disabling "Always On" reveals the hour range inputs. The local brightness slider now sits in its own row with a label ("Clock Brightness", "NowPlaying Brightness", etc.).
- Browser tab icon added.
- Browser tab title changed

### Bug fixes

- Fixed a bug where resetting all triggers and then playing music would not auto-switch to now playing. The POST /calendar endpoint was triggering the dashboard with source "user" instead of "auto", so has_user_trigger() returned true and blocked the now playing watcher from auto-triggering. Calendar triggers now use source "auto".
- untrigger() now cleans up both _triggered and _trigger_source. Previously it left stale entries in _trigger_source, which could interfere with the scheduler.
- The reset endpoint no longer redundantly re-triggers clock. It just untriggers everything except clock and lets _evaluate() fall back to the lowest priority enabled mode on its own.
- MAC address _(upsi haha ^^)_ , brightness, blink interval, and reconnect delay were hardcoded in dashboard/display.py.

### Cleanup

- Removed 10 unused unused fonts
- Removed dead font variable from dashboard/display.py.

### README

- Simplified the panels table to two columns (Panel, What it shows) with preview GIFs inline above the description.
- Panels that need API keys are marked with an asterisk, linking to each panel's .md for setup instructions.
- Added 5 new songs to the now playing preview GIF:
- Created three merged preview GIFs: verse_preview.gif, dashboard_preview.gif, nowplaying_preview.gif.
- API keys section now says "(optional)" and mentions Last.fm/Libre.fm as scrobbler choices with direct links to the panel docs.
- Removed the Previews section (content moved into the table).
- Removed the Project Structure section.
- Removed the weather provider note from Configuration (already covered in the API keys section).

## v1.0.0 - 2026-06-15

initial release.
