#!/usr/bin/env python3

import os
import time
from dotenv import load_dotenv
import pylast

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

network = pylast.LastFMNetwork(
    api_key    = os.getenv("LASTFM_API_KEY"),
    api_secret = os.getenv("LASTFM_SECRET"),
)

user = network.get_user(os.getenv("LASTFM_USERNAME"))

last_title = None

while True:
    try:
        track = user.get_now_playing()

        if track is None:
            print("[15s] Nothing playing.")
        else:
            title  = track.title
            artist = track.artist.name

            if title == last_title:
                print(f"[15s] Still playing: {artist} — {title}")
            else:
                last_title = title
                print("\n" + "═" * 60)
                print(f"  NOW PLAYING: {artist} — {title}")
                print("═" * 60)

                try:
                    album = track.get_album()
                    print(f"  Album:     {album.title if album else '—'}")
                except Exception:
                    print("  Album:     (unavailable)")

                try:
                    duration_ms = track.get_duration()
                    if duration_ms:
                        m, s = divmod(duration_ms // 1000, 60)
                        print(f"  Duration:  {m}:{s:02d}")
                except Exception:
                    pass

                try:
                    mbid = track.get_mbid()
                    print(f"  MBID:      {mbid or '—'}")
                except Exception:
                    pass

                try:
                    top_tags = track.get_top_tags(limit=10)
                    if top_tags:
                        tag_names = [t.item.name for t in top_tags]
                        print(f"  Tags:      {', '.join(tag_names)}")
                except Exception:
                    print("  Tags:      (unavailable)")

                try:
                    artist_obj = network.get_artist(artist)
                    bio = artist_obj.get_bio_summary()
                    if bio:
                        bio_clean = bio[:120].replace("\n", " ") + "..."
                        print(f"  Bio:       {bio_clean}")
                except Exception:
                    pass

                try:
                    artist_tags = network.get_artist(artist).get_top_tags(limit=10)
                    if artist_tags:
                        a_tag_names = [t.item.name for t in artist_tags]
                        print(f"  Artist tags: {', '.join(a_tag_names)}")
                except Exception:
                    pass

                try:
                    similar = network.get_artist(artist).get_similar(limit=5)
                    if similar:
                        sim_names = [s.item.name for s in similar]
                        print(f"  Similar:   {', '.join(sim_names)}")
                except Exception:
                    pass

                try:
                    pc = track.get_playcount()
                    print(f"  Playcount (global): {pc:,}")
                except Exception:
                    pass

                try:
                    upc = user.get_track_scrobbles(artist, title)
                    print(f"  Your scrobbles:     {len(upc)}")
                except Exception:
                    pass

                print()

    except Exception as e:
        print(f"[error] {e}")

    time.sleep(1)
