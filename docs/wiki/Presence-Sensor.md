# LD2410 presence sensor

Optional hardware accessory: an **HLK-LD2410** (or LD2410B / LD2410C) **24 GHz radar presence sensor**, wired to the kiosk via USB-UART. The sensor reports presence + distance to a body in front of it; Kinboard uses this to:

- POST presence state to `/api/presence` so the dashboard knows whether anyone's nearby
- Turn the display off after N seconds of nobody-detected
- Wake the display the moment someone walks up

Vastly nicer than a fixed sleep timeout. The display stays on while you're cooking and off while you're not.

## Hardware

- **Sensor**: HLK-LD2410, LD2410B, or LD2410C — €5-€15 from AliExpress / Banggood / Amazon. The B and C variants have additional features (Bluetooth config, slightly tighter detection patterns) but the base LD2410 is fine.
- **USB-UART adapter**: any FTDI FT232 or CH340-based 3.3V USB-to-serial dongle. €3-€10. Make sure it's 3.3V — the LD2410 doesn't tolerate 5V.
- **Wiring**: 4 pins on the LD2410 (GND, +5V, TX, RX) → 4 pins on the USB-UART (GND, VCC, RX, TX — note the swap, TX-to-RX and vice versa).

> TODO: photo of the LD2410 wired to a USB-UART adapter

Place the sensor pointing at the area in front of the kiosk display, with line-of-sight (it sees through wood and drywall, not metal). Mount it 1-2m above the floor at chest height.

## Software (Windows)

The Windows path uses the `presence-sensor.py` script in the repo root. It opens the FTDI port, reads LD2410 reports, POSTs presence to `/api/presence`, and controls Windows display power via `SendMessage(SC_MONITORPOWER)`.

### Install Python deps

```powershell
& "C:\Program Files\Python312\python.exe" -m pip install aio-ld2410 aiohttp pyserial
```

### Configure

Edit the script's top-of-file constants or set env vars:

```python
BAUD_RATE = 256000          # LD2410's default baud rate
DISPLAY_OFF_DELAY = 30      # seconds of no-presence before screen off
WATCHDOG_TIMEOUT = 30       # restart serial connection if no data this long
API_URL = os.environ.get("KINBOARD_URL", "http://localhost:3001").rstrip("/") + "/api/presence"
```

The `find_serial_port()` helper auto-picks the FTDI port; if you have multiple USB-serial adapters, hardcode `port = "COM3"` (or whatever).

### Run

The script takes the **device ID** as its first argument:

```powershell
& "C:\Program Files\Python312\python.exe" C:\presence-sensor.py 680d36e4-a08e-4d69-bca9-4339fffcf017
```

Find the device ID:
1. Open Kinboard → **Settings → Devices**
2. Toggle **Presence sensor** on for this device
3. The 8-character truncated UUID appears below — click the copy button to get the full ID

### Run hidden (so the user never sees a console)

Wrap the launch in a small VBS:

```vbscript
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """C:\Program Files\Python312\python.exe"" C:\presence-sensor.py YOUR_DEVICE_ID", 0, False
```

Save as `C:\run-presence-hidden.vbs`. Window-style 0 = hidden.

### Auto-start at logon

Register a Scheduled Task:

- Trigger: **At logon** of the kiosk user
- Action: `wscript.exe` with arguments `C:\run-presence-hidden.vbs`
- General → Run as user, **Run only when user is logged on**, **Run with highest privileges**
- Settings → Restart on failure (1 min, 3 attempts)

This is what the [Kiosk-Windows-11-Mele-4C](Kiosk-Windows-11-Mele-4C) reference deployment uses.

## Software (Linux)

Same `presence-sensor.py` script works on Linux with two changes:

1. The display-power code path uses `SendMessage(SC_MONITORPOWER)` — that's Windows-only. On Linux you need to swap to your DPMS backend (`wlopm`, `xset`, or `hyprctl`).
2. The serial port name will be `/dev/ttyUSB0` (or similar) instead of `COM3`.

Edit the `set_display_power()` function:

```python
def set_display_power(on):
    cmd = ["wlopm", "--on" if on else "--off", "*"]
    subprocess.run(cmd, check=False)
```

Then run via systemd:

```ini
# ~/.config/systemd/user/presence-sensor.service
[Unit]
Description=LD2410 presence sensor for Kinboard
After=graphical-session.target

[Service]
ExecStart=/usr/bin/python3 /home/kiosk/presence-sensor.py YOUR_DEVICE_ID
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

Enable: `systemctl --user enable --now presence-sensor.service`.

## How the data flows

```
LD2410 sensor (24 GHz radar)
    │
    │ serial frames @ 256000 baud
    ▼
USB-UART adapter (FTDI / CH340)
    │
    │ /dev/ttyUSB0 or COM3
    ▼
presence-sensor.py
    ├──► POST {presence, distance, device_id} → /api/presence
    │       └─► Kinboard webapp updates `devices.last_presence` in DB
    │             └─► Realtime → other clients see the state change
    │
    └──► On no-presence > DISPLAY_OFF_DELAY:
            SendMessage(SC_MONITORPOWER, 2)   (Windows: turn display off)
            Or wlopm/xset on Linux
```

## Reading the dashboard

When the sensor is connected, `/settings/devices` shows a green dot next to "Presence sensor" with the current distance. Useful for debugging — wave at the sensor and the distance updates within ~1s.

## Configuring sensitivity (optional)

The LD2410's default sensitivity is good enough for most living-room scenarios. If you need to tune it:

- **B-variant** has a Bluetooth config app on Android — pair to the sensor and adjust per-zone sensitivity / max range
- All variants accept config commands over the serial port; the `aio-ld2410` library exposes them. See its [docs](https://pypi.org/project/aio-ld2410/) for the API.

Common adjustments:
- **Max distance**: default 6m, drop to 3-4m for a kitchen-counter mount to avoid triggering on people in the next room
- **Static / moving target threshold**: default works; raise if you get false positives from a HVAC vent

## Why radar, not PIR?

PIR (passive infrared) sensors detect movement, not presence. If you stand still while reading a recipe, a PIR thinks you've left and turns the screen off. The LD2410's mmWave radar detects a stationary human chest moving (breathing) at sub-millimeter resolution, so "still but present" stays "present."

## Logging

The script writes to `C:\presence-sensor.log` (Windows) or wherever you configure. As of v1.0 there's no log rotation — file just grows. A v1.1 fix will swap to `RotatingFileHandler`. For now, `Clear-Content` it manually if it gets large.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| **No serial port found** | USB-UART driver missing. Check Device Manager (Windows) or `dmesg` (Linux) for the device. FTDI drivers are usually built-in; CH340 needs a download from wch.cn. |
| **"Permission denied" on /dev/ttyUSB0** | User not in the `dialout` group: `sudo usermod -aG dialout $USER`, then re-login. |
| **Detected presence but display doesn't turn off** | The Windows `SC_MONITORPOWER` message doesn't always work — depends on monitor + driver. As a fallback, force-blank via PowerShell: `(Add-Type ... SendMessage(...))`. |
| **Distance reads 0 always** | Sensor wired to TX/RX swap incorrectly. Try swapping the wires. |
| **Watchdog reconnects every 30 s** | Serial cable is loose, or the sensor is power-cycling. Check the 5V supply. |
| **Display turns off mid-conversation** | DISPLAY_OFF_DELAY too short. Bump from 30 to 90 s. |

## Related

- [Kiosk-Windows-11-Mele-4C](Kiosk-Windows-11-Mele-4C) — full reference deployment
- [Database-Schema](Database-Schema) — `devices.has_presence_sensor` flag, presence state on the realtime feed
- [`presence-sensor.py`](https://github.com/svenger87/kinboard/blob/main/hardware/presence-sensor.py) — the script itself
