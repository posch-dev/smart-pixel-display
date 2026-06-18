#!/usr/bin/env python3

import os
import sys
import time
import datetime
import threading
import requests
import pylast
from dotenv import load_dotenv

_root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
sys.path.insert(0, _root)
load_dotenv(dotenv_path=os.path.join(_root, ".env"))

import assets.system.config as config
from genre_presets import get_preset
from bpm_cache import get_track_data

_POLL_LIMIT = {"lastfm": 0.25, "librefm": 1.0}  # minimum seconds between scrobbler polls

def _ts() -> str:
    return datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]

_current_scrobbler: str | None = None
_network: pylast._Network | None = None
_user: pylast.User | None = None


def _ensure_network() -> None:
    global _current_scrobbler, _network, _user
    scrobbler = config.get("nowplaying", "scrobbler") or "lastfm"
    if scrobbler == _current_scrobbler:
        return
    _current_scrobbler = scrobbler
    if scrobbler == "librefm":
        _network = pylast.LibreFMNetwork(
            username      = os.getenv("LIBREFM_USERNAME"),
            password_hash = pylast.md5(os.getenv("LIBREFM_PASSWORD") or ""),
        )
        _user = _network.get_user(os.getenv("LIBREFM_USERNAME"))
        print(f"{_ts()} [poller] switched to Libre.fm ({os.getenv('LIBREFM_USERNAME')})")
    else:
        _network = pylast.LastFMNetwork(
            api_key    = os.getenv("LASTFM_API_KEY"),
            api_secret = os.getenv("LASTFM_SECRET"),
        )
        _user = _network.get_user(os.getenv("LASTFM_USERNAME"))
        print(f"{_ts()} [poller] switched to Last.fm ({os.getenv('LASTFM_USERNAME')})")


def _fetch_cover(title: str, artist: str, size: int = 32) -> bytes | None:
    # Fetch album cover from iTunes.
    try:
        r = requests.get(
            "https://itunes.apple.com/search",
            params={"term": f"{artist} {title}", "media": "music", "limit": 1},
            timeout=10,
        )
        r.raise_for_status()
        results = r.json().get("results", [])
        if not results:
            return None
        url = results[0]["artworkUrl100"].replace("100x100bb", f"{size}x{size}bb")
        img = requests.get(url, timeout=10)
        img.raise_for_status()
        return img.content
    except Exception as e:
        print(f"[cover] {e}")
        return None


_lock  = threading.Lock()
_state = {
    "playing":    False,
    "title":      None,
    "artist":     None,
    "album":      None,
    "duration_s": None,
    "elapsed_s":  0.0,
    "bpm":        None,
    "genres":     [],
    "preset":     None,   # from genre_presets
    "cover":      None,   # raw image bytes
}
_song_start: float = 0.0   # monotonic time when current song was first seen

_running = threading.Event()
_running.set()


def pause() -> None:
    _running.clear()
    print(f"{_ts()} [poller] paused")


def resume() -> None:
    _running.set()
    print(f"{_ts()} [poller] resumed")


def get_state() -> dict:
    with _lock:
        s = dict(_state)
        if s["playing"] and _song_start:
            s["elapsed_s"] = time.monotonic() - _song_start
        return s


def _poll_loop() -> None:
    global _song_start

    current_title = None
    _none_count   = 0
    _NONE_DEBOUNCE = 3  # consecutive None polls before treating as stopped

    while True:
        _running.wait()
        _ensure_network()
        try:
            track = _user.get_now_playing()

            if track is None:
                _none_count += 1
                if _none_count >= _NONE_DEBOUNCE:
                    with _lock:
                        _state["playing"] = False
                    current_title = None
                    _song_start   = 0.0

            else:
                _none_count = 0
                title  = track.title
                artist = track.artist.name

                with _lock:
                    dur = _state["duration_s"]
                    if (current_title == title
                            and dur is not None
                            and _song_start > 0
                            and time.monotonic() - _song_start > dur + 10):
                        # song should be over by now, treat as nothing playing
                        _state["playing"] = False
                        current_title = None
                        _song_start   = 0.0
                        print(f"{_ts()} [poller] song expired by duration")
                        time.sleep(1)
                        continue

                if title != current_title:
                    current_title = title
                    _song_start   = time.monotonic()
                    print(f"{_ts()} [poller] new song: {artist} — {title}")

                    # Fetch everything except BPM synchronously (fast: 1-3s total)
                    duration_s = None
                    try:
                        ms = track.get_duration()
                        if ms:
                            duration_s = ms / 1000
                    except Exception:
                        pass

                    lastfm_tags = []
                    try:
                        lastfm_tags += [x.item.name for x in track.get_top_tags(limit=10)]
                    except Exception:
                        pass
                    try:
                        lastfm_tags += [x.item.name for x in _network.get_artist(artist).get_top_tags(limit=10)]
                    except Exception:
                        pass

                    album_name = None
                    try:
                        album_obj  = track.get_album()
                        album_name = album_obj.title if album_obj else None
                    except Exception:
                        pass

                    preset = get_preset(lastfm_tags)
                    cover  = _fetch_cover(title, artist)

                    with _lock:
                        _state.update({
                            "playing":      True,
                            "title":        title,
                            "artist":       artist,
                            "album":        album_name,
                            "duration_s":   duration_s,
                            "elapsed_s":    0.0,
                            "bpm":          None,
                            "danceability": None,
                            "acousticness": None,
                            "genres":       lastfm_tags,
                            "preset":       preset,
                            "cover":        cover,
                        })

                    cover_str  = "yes" if cover else "no"
                    preset_str = f"bass={preset['bass_mult']} mids={preset['mids_mult']} highs={preset['highs_mult']}"
                    print(f"{_ts()} [poller] duration={duration_s}s cover={cover_str} preset={preset_str}")
                    print(f"{_ts()} [poller] tags: {', '.join(lastfm_tags[:5])}")

                    # BPM fetch runs in background, it's the slow one (API can take 10s+)
                    def _fetch_bpm(_title=title, _artist=artist, _tags=lastfm_tags):
                        track_data = get_track_data(_title, _artist, genres=_tags)
                        bpm          = track_data.get("bpm")
                        danceability = track_data.get("danceability")
                        acousticness = track_data.get("acousticness")
                        with _lock:
                            if _state["title"] == _title:
                                _state.update({
                                    "bpm":          bpm,
                                    "danceability": danceability,
                                    "acousticness": acousticness,
                                })
                        print(f"{_ts()} [bpm] {_title}: {bpm} BPM")

                    threading.Thread(target=_fetch_bpm, daemon=True).start()

                else:
                    with _lock:
                        _state["playing"] = True

        except Exception as e:
            print(f"{_ts()} [poller error] {e}")

        min_sleep = _POLL_LIMIT.get(_current_scrobbler or "lastfm", 1.0)
        sleep_s   = max(min_sleep, config.get("nowplaying", "poll_s") or 1.0)
        time.sleep(sleep_s)


_poll_thread: threading.Thread | None = None

def start() -> None:
    # Start the poller in a background daemon thread (idempotent).
    global _poll_thread
    if _poll_thread is not None and _poll_thread.is_alive():
        return
    _poll_thread = threading.Thread(target=_poll_loop, daemon=True)
    _poll_thread.start()


if __name__ == "__main__":
    print("Starting poller — play something on Apple Music...\n")
    start()
    while True:
        s = get_state()
        if s["playing"]:
            print(f"[state] {s['artist']} — {s['title']} | "
                  f"BPM={s['bpm']} | elapsed={s['elapsed_s']:.0f}s / {s['duration_s']}s")
        else:
            print("[state] nothing playing")
        time.sleep(5)
