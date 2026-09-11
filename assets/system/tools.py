import asyncio
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import assets.system.config as config

MAX_SLOTS       = 256
STOP_AFTER_FAILS = 3


def scan(timeout: float = 5.0) -> None:
    from bleak import BleakScanner

    async def _run():
        print(f"Scanning {timeout:.0f}s ...")
        for device in await BleakScanner.discover(timeout=timeout):
            print(f"  {device.address}  {device.name}")

    asyncio.run(_run())


def clear_slots() -> None:
    from pypixelcolor import AsyncClient
    mac = config.get("device", "mac_address")

    async def _run():
        print(f"Connecting to {mac} ...")
        async with AsyncClient(mac) as client:
            info = client.get_device_info()
            print(f"Connected. Device: {info.width}x{info.height}, type {info.device_type}")
            print(f"\nProbing and clearing user slots (max {MAX_SLOTS}) ...")
            cleared, fails = 0, 0
            for slot in range(MAX_SLOTS):
                try:
                    await client.delete(slot)
                    print(f"  Slot {slot:3d}: cleared")
                    cleared += 1
                    fails = 0
                except Exception as error:
                    fails += 1
                    empty = "empty" in str(error).lower() or "not found" in str(error).lower()
                    print(f"  Slot {slot:3d}: {'already empty' if empty else f'failed ({error})'}")
                    if fails >= STOP_AFTER_FAILS:
                        print(f"\n  {STOP_AFTER_FAILS} failures in a row, stopping.")
                        break
            print(f"\nDone. Cleared {cleared} slot(s).")

    asyncio.run(_run())


def poll_debug(interval: float = 1.0) -> None:
    # what the scrobbler reports, including the fields the panel never draws
    import pylast
    from dotenv import load_dotenv

    load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".env"))
    network = pylast.LastFMNetwork(api_key=os.getenv("LASTFM_API_KEY"),
                                   api_secret=os.getenv("LASTFM_SECRET"))
    user       = network.get_user(os.getenv("LASTFM_USERNAME"))
    last_title = None

    while True:
        try:
            track = user.get_now_playing()
            if track is None:
                print("Nothing playing.")
            elif track.title == last_title:
                print(f"Still playing: {track.artist.name} - {track.title}")
            else:
                last_title = track.title
                print("\n" + "=" * 60)
                print(f"  NOW PLAYING: {track.artist.name} - {track.title}")
                print("=" * 60)
                for name, get in (
                    ("Album",      lambda: (track.get_album() or "-") and str(track.get_album())),
                    ("Duration",   lambda: "{}:{:02d}".format(*divmod((track.get_duration() or 0) // 1000, 60))),
                    ("MBID",       lambda: track.get_mbid() or "-"),
                    ("Tags",       lambda: ", ".join(t.item.name for t in track.get_top_tags(limit=10))),
                    ("Artisttags", lambda: ", ".join(t.item.name for t in network.get_artist(track.artist.name).get_top_tags(limit=10))),
                    ("Similar",    lambda: ", ".join(s.item.name for s in network.get_artist(track.artist.name).get_similar(limit=5))),
                    ("Playcount",  lambda: f"{track.get_playcount():,}"),
                    ("Scrobbles",  lambda: str(len(user.get_track_scrobbles(track.artist.name, track.title)))),
                ):
                    try:
                        print(f"  {name+':':<12}{get()}")
                    except Exception:
                        print(f"  {name+':':<12}(unavailable)")
                print()
        except KeyboardInterrupt:
            print("\nStopped.")
            return
        except Exception as error:
            print(f"[error] {error}")
        time.sleep(interval)


def font_preview() -> None:
    # one gif per font into assets/fonts/previews, so a font can be picked by eye
    root = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
    sys.path.insert(0, os.path.join(root, "panels", "now_playing"))
    import display

    fonts_dir = os.path.join(root, "assets", "fonts")
    out_dir   = os.path.join(fonts_dir, "previews")
    os.makedirs(out_dir, exist_ok=True)

    song  = display.STATES[0]
    state = dict(song["state"], cover=display.fetch_cover(song["query"]))

    for filename in sorted(os.listdir(fonts_dir)):
        if not filename.lower().endswith((".ttf", ".otf")):
            continue
        name = os.path.splitext(filename)[0]
        display._FONT_PATH = os.path.join(fonts_dir, filename)
        display._font_cache.clear()
        try:
            gif = display.generate_gif(state)
            with open(os.path.join(out_dir, f"{name}.gif"), "wb") as handle:
                handle.write(gif)
            print(f"  {name}: {len(gif) // 1024} KB")
        except Exception as error:
            print(f"  {name}: failed ({error})")
    print(f"\nWritten to {out_dir}")
