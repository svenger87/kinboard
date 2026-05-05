#!/usr/bin/env python3
"""
LD2410 Presence Sensor for Mele Kiosk
Reads presence from LD2410 via USB-UART (FTDI) and:
  1. POSTs state to webapp API (/api/presence)
  2. Controls display DPMS via Mutter D-Bus
"""

import asyncio
import json
import logging
import subprocess
import os
from aio_ld2410 import LD2410

# Configuration
SERIAL_PORT = "/dev/ttyUSB0"
BAUD_RATE = 256000
API_URL = os.environ.get("FAMILYBOARD_URL", "http://localhost:3001").rstrip("/") + "/api/presence"
DEVICE_ID = None  # Auto-detected from family store cookie
DISPLAY_OFF_DELAY = 30  # seconds after no presence before display off

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger(__name__)


def get_device_id():
    """Read device_id from the family-calendar cookie storage."""
    import glob
    # Try to find the device ID from Firefox profile
    for profile_dir in glob.glob(os.path.expanduser("~/.mozilla/firefox/*.default-esr")):
        storage_file = os.path.join(profile_dir, "storage.sqlite")
        if os.path.exists(storage_file):
            try:
                import sqlite3
                conn = sqlite3.connect(storage_file)
                # Try to find the device ID in cookies or storage
                conn.close()
            except Exception:
                pass
    return None


def set_display_power(on: bool):
    """Control display via Mutter D-Bus PowerSaveMode + GNOME Screensaver lock."""
    env = os.environ.copy()
    env["DBUS_SESSION_BUS_ADDRESS"] = f"unix:path=/run/user/{os.getuid()}/bus"
    try:
        if on:
            # Deactivate screensaver first (unlocks DPMS), then set display on
            subprocess.run(
                ["gdbus", "call", "--session",
                 "--dest", "org.gnome.ScreenSaver",
                 "--object-path", "/org/gnome/ScreenSaver",
                 "--method", "org.gnome.ScreenSaver.SetActive", "false"],
                env=env, timeout=5, capture_output=True,
            )
            subprocess.run(
                ["busctl", "--user", "set-property",
                 "org.gnome.Mutter.DisplayConfig",
                 "/org/gnome/Mutter/DisplayConfig",
                 "org.gnome.Mutter.DisplayConfig",
                 "PowerSaveMode", "i", "0"],
                env=env, timeout=5, capture_output=True,
            )
        else:
            # Set display off, then activate screensaver to prevent Firefox from waking it
            subprocess.run(
                ["busctl", "--user", "set-property",
                 "org.gnome.Mutter.DisplayConfig",
                 "/org/gnome/Mutter/DisplayConfig",
                 "org.gnome.Mutter.DisplayConfig",
                 "PowerSaveMode", "i", "1"],
                env=env, timeout=5, capture_output=True,
            )
            subprocess.run(
                ["gdbus", "call", "--session",
                 "--dest", "org.gnome.ScreenSaver",
                 "--object-path", "/org/gnome/ScreenSaver",
                 "--method", "org.gnome.ScreenSaver.SetActive", "true"],
                env=env, timeout=5, capture_output=True,
            )
        logger.info(f"Display {'ON' if on else 'OFF'}")
    except Exception as e:
        logger.error(f"Failed to set display power: {e}")


async def post_presence(session, device_id: str, presence: bool, distance: int):
    """POST presence state to webapp API."""
    try:
        import aiohttp
        async with session.post(API_URL, json={
            "device_id": device_id,
            "presence": presence,
            "distance": distance,
        }, timeout=aiohttp.ClientTimeout(total=5)) as resp:
            if resp.status != 200:
                logger.warning(f"API returned {resp.status}")
    except Exception as e:
        logger.warning(f"API post failed: {e}")


class PresenceMonitor:
    def __init__(self, device_id: str):
        self.device_id = device_id
        self.last_presence = None
        self.display_off_task = None
        self.display_is_on = True

    async def run(self):
        import aiohttp
        async with aiohttp.ClientSession() as session:
            logger.info(f"Opening LD2410 on {SERIAL_PORT}")

            async with LD2410(SERIAL_PORT, baud_rate=BAUD_RATE) as device:
                logger.info("LD2410 connected")

                async for report in device.get_reports():
                    status = report.basic.target_status
                    presence = bool(status)
                    distance = report.basic.detection_distance

                    # Post every state to API
                    await post_presence(session, self.device_id, presence, distance)

                    # Handle display on state change
                    if presence != self.last_presence:
                        self.last_presence = presence
                        logger.info(f"Presence: {'ON' if presence else 'OFF'} (distance: {distance}cm)")
                        await self.handle_display(presence)

    async def handle_display(self, presence: bool):
        if presence:
            # Cancel pending off
            if self.display_off_task and not self.display_off_task.done():
                self.display_off_task.cancel()
            # Turn on if it was off
            if not self.display_is_on:
                set_display_power(True)
                self.display_is_on = True
        else:
            # Schedule delayed off
            self.display_off_task = asyncio.create_task(self.delayed_off())

    async def delayed_off(self):
        try:
            await asyncio.sleep(DISPLAY_OFF_DELAY)
            set_display_power(False)
            self.display_is_on = False
        except asyncio.CancelledError:
            pass


async def main():
    # Try to get device_id from command line or environment
    device_id = os.environ.get("DEVICE_ID", "")
    if not device_id:
        # Use a fixed ID for now — can be set via env or config
        import sys
        if len(sys.argv) > 1:
            device_id = sys.argv[1]
        else:
            logger.error("Usage: presence-sensor.py <device_id> or set DEVICE_ID env var")
            logger.error("Get device_id from: Settings > Devices in the webapp")
            return

    logger.info(f"Device ID: {device_id}")
    monitor = PresenceMonitor(device_id)

    while True:
        try:
            await monitor.run()
        except Exception as e:
            logger.error(f"Error: {e}")
            await asyncio.sleep(5)


if __name__ == "__main__":
    asyncio.run(main())
