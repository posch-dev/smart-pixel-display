import asyncio
from bleak import BleakScanner

async def scan():
    devices = await BleakScanner.discover(timeout=5)
    for d in devices:
        print(d.address, d.name)

asyncio.run(scan())