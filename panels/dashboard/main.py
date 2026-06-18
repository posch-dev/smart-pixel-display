#!/usr/bin/env python3
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import weather
import assets.system.config as config
import display

if __name__ == "__main__":
    w = config.get("dashboard", "weather", {})
    lat, lon = w.get("lat"), w.get("lon")
    if lat is not None and lon is not None:
        weather.set_location(lat, lon)
        print(f"[config] location set to {lat}, {lon}")

    asyncio.run(display.run())
