"""LD2410 Presence Sensor for Windows Kiosk."""
import asyncio
import ctypes
import logging
import sys
import serial
from aio_ld2410 import LD2410
import aiohttp

BAUD_RATE = 256000
import os
API_URL = os.environ.get("KINBOARD_URL", "http://localhost:3001").rstrip("/") + "/api/presence"
DEVICE_ID = sys.argv[1] if len(sys.argv) > 1 else ""
DISPLAY_OFF_DELAY = 30
WATCHDOG_TIMEOUT = 30  # Restart connection if no data for this many seconds

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler("C:\\presence-sensor.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

SC_MONITORPOWER = 0xF170
HWND_BROADCAST = 0xFFFF
WM_SYSCOMMAND = 0x0112
MOUSEEVENTF_MOVE = 0x0001
INPUT_MOUSE = 0

class MOUSEINPUT(ctypes.Structure):
    _fields_ = [("dx", ctypes.c_long), ("dy", ctypes.c_long),
                ("mouseData", ctypes.c_ulong), ("dwFlags", ctypes.c_ulong),
                ("time", ctypes.c_ulong), ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong))]

class INPUT(ctypes.Structure):
    class _INPUT(ctypes.Union):
        _fields_ = [("mi", MOUSEINPUT)]
    _fields_ = [("type", ctypes.c_ulong), ("ii", _INPUT)]

def set_display_power(on):
    try:
        if on:
            inp = INPUT()
            inp.type = INPUT_MOUSE
            inp.ii.mi.dx = 1
            inp.ii.mi.dy = 1
            inp.ii.mi.dwFlags = MOUSEEVENTF_MOVE
            ctypes.windll.user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(inp))
            ctypes.windll.user32.SendMessageW(HWND_BROADCAST, WM_SYSCOMMAND, SC_MONITORPOWER, -1)
        else:
            ctypes.windll.user32.SendMessageW(HWND_BROADCAST, WM_SYSCOMMAND, SC_MONITORPOWER, 2)
        logger.info("Display %s", "ON" if on else "OFF")
    except Exception as e:
        logger.error("Display control failed: %s", e)

def find_serial_port():
    import serial.tools.list_ports
    for port in serial.tools.list_ports.comports():
        if "FTDI" in (port.manufacturer or "") or "FT232" in (port.description or ""):
            return port.device
        if "USB" in (port.description or ""):
            return port.device
    ports = list(serial.tools.list_ports.comports())
    return ports[0].device if ports else "COM3"

def force_close_port(port_name):
    """Force close a serial port if it's stuck open."""
    try:
        s = serial.Serial()
        s.port = port_name
        if s.is_open:
            s.close()
    except Exception:
        pass

async def post_presence(session, device_id, presence, distance):
    try:
        async with session.post(API_URL, json={
            "device_id": device_id, "presence": presence, "distance": distance,
        }, timeout=aiohttp.ClientTimeout(total=5)) as resp:
            if resp.status != 200:
                logger.warning("API returned %d", resp.status)
    except Exception as e:
        logger.warning("API post failed: %s", e)

class PresenceMonitor:
    def __init__(self, device_id, serial_port):
        self.device_id = device_id
        self.serial_port = serial_port
        self.last_presence = None
        self.display_off_task = None
        self.display_is_on = True

    async def run(self):
        async with aiohttp.ClientSession() as session:
            logger.info("Opening LD2410 on %s", self.serial_port)
            try:
                async with LD2410(self.serial_port, baud_rate=BAUD_RATE) as device:
                    logger.info("LD2410 connected")
                    async for report in self._reports_with_watchdog(device):
                        status = report.basic.target_status
                        presence = bool(status)
                        distance = report.basic.detection_distance
                        await post_presence(session, self.device_id, presence, distance)
                        if presence != self.last_presence:
                            self.last_presence = presence
                            logger.info("Presence: %s (%dcm)", "ON" if presence else "OFF", distance)
                            await self.handle_display(presence)
            except Exception as e:
                logger.error("Serial error: %s", e)
                force_close_port(self.serial_port)
                raise

    async def _reports_with_watchdog(self, device):
        """Wrap get_reports() with a watchdog timeout.
        If no report arrives within WATCHDOG_TIMEOUT seconds, raise to trigger reconnect."""
        report_iter = device.get_reports().__aiter__()
        while True:
            try:
                report = await asyncio.wait_for(
                    report_iter.__anext__(),
                    timeout=WATCHDOG_TIMEOUT,
                )
                yield report
            except asyncio.TimeoutError:
                logger.warning("Watchdog: no data for %ds, reconnecting", WATCHDOG_TIMEOUT)
                raise ConnectionError(f"No data from LD2410 for {WATCHDOG_TIMEOUT}s")
            except StopAsyncIteration:
                logger.warning("LD2410 report stream ended")
                raise ConnectionError("LD2410 report stream ended unexpectedly")

    async def handle_display(self, presence):
        if presence:
            if self.display_off_task and not self.display_off_task.done():
                self.display_off_task.cancel()
            if not self.display_is_on:
                set_display_power(True)
                self.display_is_on = True
        else:
            self.display_off_task = asyncio.create_task(self.delayed_off())

    async def delayed_off(self):
        try:
            await asyncio.sleep(DISPLAY_OFF_DELAY)
            set_display_power(False)
            self.display_is_on = False
        except asyncio.CancelledError:
            pass

async def main():
    if not DEVICE_ID:
        logger.error("Usage: presence-sensor.py <device_id>")
        return
    port = find_serial_port()
    logger.info("Device ID: %s, Serial: %s", DEVICE_ID, port)
    monitor = PresenceMonitor(DEVICE_ID, port)
    while True:
        try:
            await monitor.run()
        except Exception as e:
            logger.error("Reconnecting in 5s after: %s", e)
            force_close_port(port)
            await asyncio.sleep(5)
            # Re-detect port in case it changed
            port = find_serial_port()
            monitor.serial_port = port

if __name__ == "__main__":
    asyncio.run(main())
