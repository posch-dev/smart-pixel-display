# Now Playing

[Back to README](../../README.md) | [Previous: Dashboard](../dashboard/README.md)

Whatever you are listening to right now, on the display.
It follows your scrobbles, so it does not care which player
or streaming service the music comes from.

<img src="../../.github/assets/nowplaying_preview.gif" alt="Preview" width="512">

# Legend

| Element | What it shows |
|---|---|
| <!-- png --> | the cover art of the album |
| <!-- png --> | the title of the track |
| <!-- png --> | the artist |
| <!-- png --> | the album |
| <!-- png --> | the playhead, how far into the song you are |
| <!-- png --> | the frequency band, synced to the BPM of the song\* |

\*The frequency band needs [GetSongBPM](https://getsongbpm.com) API
set, to accurately move with the songs BPM. Without it the panel runs fine
but falls back to a BPM preset based on the songs genre.

# Scrobbler

The panel does not talk to Spotify, Apple Music or YouTube Music itself. It reads what
you are listening to from your scrobbler account, Last.fm or Libre.fm. So you need
something on the device you actually play music on that reports the song
you are currently playing to that scrobbler account.

| Scrobbler | Platform | Device |
|---|---|---|
| [Pano Scrobbler](https://github.com/kawaiiDango/pano-scrobbler) | Last.fm / Libre.fm | Android, Windows, Linux |
| [Last.fm app](https://www.last.fm/about/trackmymusic) | Last.fm | Android |
| [Orchard](https://apps.apple.com/us/app/orchard-music-scrobbler/id6761742676) | Last.fm | iPhone (Apple Music) |
| [Web Scrobbler](https://web-scrobbler.com) | Last.fm / Libre.fm | Browser (Firefox, Chromium) |
| [rescrobbled](https://github.com/InputUsername/rescrobbled) | Last.fm | Linux (any MPRIS player) |
| [Strawberry](https://www.strawberrymusicplayer.org) | Last.fm | Linux, Windows |
| [Rhythmbox](https://wiki.gnome.org/Apps/Rhythmbox) | Last.fm / Libre.fm | Linux |
| [mpdscribble](https://github.com/MusicPlayerDaemon/mpdscribble) | Last.fm / Libre.fm | Linux (MPD) |
| [MusicBee](https://www.getmusicbee.com) | Last.fm | Windows |
| [foo_scrobble](https://www.foobar2000.org/components/view/foo_scrobble) | Last.fm | Windows (foobar2000) |

All of them report the song while it is still playing, and that is what the panel needs.
It reads the "now playing" state of your account, not your play history, so a scrobbler
that only submits finished songs or catches up later leaves the display empty. The
official Last.fm app on iPhone is such a case, it scans your Apple Music library after the
fact, which is why it is listed for Android only.

Pano Scrobbler catches nearly every player on the phone, and Web Scrobbler covers YouTube
Music, Spotify Web, Apple Music, SoundCloud and a long list more.

>My own setup, if it helps: on Windows the
>[Web Scrobbler](https://web-scrobbler.com) browser extension, on the iPhone
>[Orchard](https://apps.apple.com/us/app/orchard-music-scrobbler/id6761742676) for Apple
>Music, and on Linux [rescrobbled](https://github.com/InputUsername/rescrobbled) as a
>system wide daemon, with its player whitelist set to
>[Sidra](https://github.com/wimpysworld/sidra) so nothing else gets scrobbled.

## API keys

Now Playing is the only panel that needs API keys, and all of them are free. The installer
asks for them, or you write them into `.env` yourself.

### Last.fm

1. Go to [last.fm/api/account/create](https://www.last.fm/api/account/create).
2. Fill in anything for the app name and description, then submit.
3. Copy the API key and shared secret.

```env
LASTFM_API_KEY=your_api_key
LASTFM_SECRET=your_shared_secret
LASTFM_USERNAME=your_lastfm_username
```

### Libre.fm

No API key needed, just your username and password.

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

## Configuration

Everything below is in the web app under **Panels -> NowPlaying**, or in `config.toml` if
you would rather type. The priority is the exception: it sits under
**Settings -> Device**, where you drag the panels into the order you want.

```toml
[nowplaying]
enabled    = false        # needs last.fm or libre.fm credentials in .env
priority   = 3
brightness = 50           # 1 to 100
scrobbler  = "lastfm"     # "lastfm" or "librefm"
font       = 3            # 1=PressStart2P  2=HIAIRP22  3=MinecraftStandard  4=pcsenior
```

The BLE image slots (`slot_a`, `slot_b`), the poll interval (`poll_s`) and the chunk
length (`chunk_s`) are expert settings and live in `[expert]`.

## Webhooks

| Event | Fires when |
|---|---|
| `on_enter` | the panel takes over the display |
| `on_exit` | it hands the display back |
| `on_song_change` | a new song is actually on the display, after the GIF upload and the slot switch, not when it is detected |

`on_song_change` brings template variables with it:

| Variable | What it is |
|---|---|
| `{{title}}`, `{{artist}}`, `{{album}}` | the track |
| `{{accent1_hex}}`, `{{accent1_rgb}}`, `{{accent1_r}}`, `{{accent1_g}}`, `{{accent1_b}}` | the first accent color picked from the cover |
| `{{accent1_hsv}}`, `{{accent1_h}}`, `{{accent1_s}}`, `{{accent1_v}}` | the same color as HSV |
| `{{accent1_full_hex}}`, `{{accent1_full_rgb}}`, `{{accent1_full_r/g/b}}` | the same hue at 100% brightness |
| `accent2`, `accent3` | the same set again for the second and third accent |

Full-brightness variants are the same hue but at max value, for things like WLED that handle brightness on their own.

## Running standalone

```bash
python panels/now_playing/main.py
```

---

[Back to README](../../README.md) | [Previous: Dashboard](../dashboard/README.md)
