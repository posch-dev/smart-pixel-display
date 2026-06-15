#!/usr/bin/env python3

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import asyncio
from panels.clock.main import render_frame, MAC_ADDRESS, BRIGHTNESS
from pypixelcolor import AsyncClient

STEP_DELAY = 0.01  # seconds per minute step (full 24h cycle in ~14 seconds)


async def run() -> None:
    async with AsyncClient(MAC_ADDRESS) as client:
        await client.set_brightness(BRIGHTNESS)
        for h in range(24):
            for m in range(60):
                hh = f"{h:02d}"
                mm = f"{m:02d}"
                print(f"{hh}:{mm}")
                await client.send_image_hex(render_frame(hh, mm, True), ".png")
                await asyncio.sleep(STEP_DELAY)
        print("Done.")


asyncio.run(run())
