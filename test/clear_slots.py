#!/usr/bin/env python3

import asyncio
from pypixelcolor import AsyncClient

MAC_ADDRESS          = "XX:XX:XX:XX:XX:XX"
MAX_SLOTS_TO_PROBE   = 256  # device accepts all 256 indices (1-byte slot field)
STOP_AFTER_FAILURES  = 3   # device never returns failures in practice, just caps the probe loop


async def run() -> None:
    print(f"Connecting to {MAC_ADDRESS} ...")

    try:
        async with AsyncClient(MAC_ADDRESS) as client:
            # get_device_info() connects automatically but doesn't return slot count, so we probe below.
            info = client.get_device_info()
            print(f"Connected. Device: {info.width}x{info.height}, "
                  f"type {info.device_type}")

            print(f"\nProbing and clearing user slots (max {MAX_SLOTS_TO_PROBE}) ...")
            cleared = 0
            consecutive_failures = 0

            for slot in range(MAX_SLOTS_TO_PROBE):
                try:
                    # client.delete(n) sends iPixel command ID 2 with slot index. Raises on BLE/ACK error.
                    await client.delete(slot)
                    print(f"  Slot {slot:3d}: cleared")
                    cleared += 1
                    consecutive_failures = 0

                except Exception as e:
                    consecutive_failures += 1
                    error_str = str(e).lower()

                    if "empty" in error_str or "not found" in error_str:
                        print(f"  Slot {slot:3d}: already empty")
                    else:
                        print(f"  Slot {slot:3d}: failed ({e})")

                    if consecutive_failures >= STOP_AFTER_FAILURES:
                        print(f"\n  {STOP_AFTER_FAILURES} consecutive failures — "
                              f"assuming no more slots after index {slot - STOP_AFTER_FAILURES + 1}.")
                        break

            print(f"\nDone. Cleared {cleared} slot(s).")

    except KeyboardInterrupt:
        print("\nAborted.")
    except Exception as e:
        print(f"Error: {e}")


if __name__ == "__main__":
    asyncio.run(run())
