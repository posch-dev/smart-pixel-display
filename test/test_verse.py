#!/usr/bin/env python3

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import asyncio
from pypixelcolor import AsyncClient
from panels.verse_of_day.main import render_reference
from panels.clock.main import MAC_ADDRESS, BRIGHTNESS

TEST_REFS = [
    # short book names
    "JOB 3:3",
    "RUTH 1:16",
    "EZRA 7:10",
    # medium book names
    "MATTHEW 5:3",
    "PSALMS 23:1",
    "GENESIS 1:1",
    # long book names
    "1 THESSALONIANS 5:18",
    "1 CORINTHIANS 13:4",
    "ECCLESIASTES 3:1",
]

CYCLE_INTERVAL = 1.0  # seconds per reference


async def run() -> None:
    print(f"Connecting to {MAC_ADDRESS} ...")
    async with AsyncClient(MAC_ADDRESS) as client:
        info = client.get_device_info()
        display_w, display_h = info.width, info.height
        print(f"Display: {display_w}x{display_h}")

        await client.set_brightness(BRIGHTNESS)
        print("Cycling references — press Ctrl+C to stop.\n")

        i = 0
        while True:
            ref = TEST_REFS[i % len(TEST_REFS)]
            print(f"[{i % len(TEST_REFS) + 1}/{len(TEST_REFS)}] {ref}")
            frame = render_reference(ref, display_w, display_h)
            await client.send_image_hex(frame, ".png")
            await asyncio.sleep(CYCLE_INTERVAL)
            i += 1


if __name__ == "__main__":
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        print("\nStopped.")
