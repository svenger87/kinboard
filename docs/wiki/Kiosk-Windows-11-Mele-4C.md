# Kiosk on Windows 11 (Mele 4C reference setup)

This is the **maintainer's actual fielded configuration** — captured from the live device, registry keys and scheduled-task definitions included. Use it as a copy-paste recipe or as an example to adapt for your hardware.

## Why Windows 11

The reason for choosing Windows over Linux on a wall-mounted touchscreen comes down to one feature: **the on-screen keyboard auto-shows when you tap a text field**. Linux Wayland alternatives (wvkbd, Onboard, GNOME's GOK) require a separate visibility-bridge process and CDP-poking — fragile in practice. Windows' TabTip just works.

## Hardware at a glance

| Component | Spec |
|---|---|
| Mini PC | **Mele Quieter 4C** — fanless Intel N100/N150, 16 GB RAM, 256 GB eMMC |
| Display | 27" Novomatic open-frame touchscreen, 1920×1200, capacitive multi-touch via USB |
| Enclosure | Custom oak frame with rabbet for the panel + plywood back |
| Sensor | HLK-LD2410 mounted on top of the frame (optional) |
| Connectivity | Mele has Wi-Fi 5 + 2.5 GbE; reference build runs on Wi-Fi at 192.168.1.x |

For the **full build** — BOM, vendor links, frame construction, cabling, photos — see [Reference-Build](Reference-Build). This page covers the **software** that runs on top.

The unit captured for this wiki has these specifics:

| | |
|---|---|
| CPU | Intel N150 (the spec sheet lists N100; Mele refreshed silicon mid-cycle) |
| RAM | 16 GB LPDDR4 (15.7 GB usable) |
| Storage | 256 GB eMMC |
| Touch HID | USB VID `222A`, PID `1515` |

## OS

**Windows 11 IoT Enterprise LTSC, build 26100** (the LTSC variant — long-term servicing, no forced feature updates).

Why LTSC:
- No forced Windows Update reboots
- No telemetry / advertising / Cortana / Edge Bing hijack
- Stable for 5-10 years per release

If you don't have an LTSC license, regular Windows 11 Pro works fine. Pause Windows Update for max defer (5 weeks) to avoid surprise reboots interrupting the kitchen display.

## User account

Single local user named **`Calendar`** with auto-login enabled.

```
HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon
  AutoAdminLogon    = 1
  DefaultUserName   = Calendar
  DefaultDomainName = <hostname>
  DefaultPassword   = <stored in plaintext, standard Windows behavior>
  Shell             = explorer.exe
```

To set this up:
1. Settings → Accounts → Family & other users → **Add account** → "I don't have this person's sign-in information" → "Add a user without a Microsoft account" → name `Calendar`
2. Run `netplwiz` → uncheck "Users must enter a username and password" → OK → enter the password twice in the popup. Done.

The plaintext password in the registry is a known Windows AutoLogon tradeoff; that's by design. Don't reuse the password anywhere else.

## The boot chain

```
Boot → AutoLogon as Calendar
  ├─ Scheduled Task "KioskLauncher" (at logon, Highest, Interactive)
  │   └─ C:\kiosk-launcher.bat
  │       ├─ Forces tablet-mode + touch-keyboard auto-invoke registry
  │       ├─ Launches TabTip.exe (Windows touch keyboard)
  │       ├─ 2s delay
  │       └─ Launches Edge in --kiosk mode pointing at your Kinboard URL
  │
  └─ Scheduled Task "PresenceSensor" (at logon, Highest, Interactive)
      └─ wscript.exe C:\run-presence-hidden.vbs
          └─ pythonw … presence-sensor.py <FAMILY_DEVICE_ID>
              └─ FTDI USB serial → LD2410 → POST /api/presence
```

## Step-by-step

### 1. Install Python 3.12

Download from https://www.python.org/downloads/windows/. During install:
- ✓ **Add python.exe to PATH**
- ✓ **Install for all users** → installs to `C:\Program Files\Python312\`

Then install the presence-sensor dependencies:

```powershell
& "C:\Program Files\Python312\python.exe" -m pip install aio-ld2410 aiohttp pyserial
```

### 2. Install Microsoft Edge

Already installed on Windows 11. Verify:

```powershell
Get-Command msedge
```

### 3. Drop the kiosk launcher

Save as `C:\kiosk-launcher.bat`:

```bat
@echo off
set LOGFILE=C:\kiosk.log
echo [%date% %time%] === KIOSK STARTUP === >> %LOGFILE%

:: Force tablet mode + on-screen keyboard auto-invoke
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\ImmersiveShell" /v TabletMode /t REG_DWORD /d 1 /f >> %LOGFILE% 2>&1
reg add "HKCU\Software\Microsoft\TabletTip\1.7" /v EnableDesktopModeAutoInvoke /t REG_DWORD /d 1 /f >> %LOGFILE% 2>&1
reg add "HKCU\Software\Microsoft\TabletTip\1.7" /v TipbandDesiredVisibility /t REG_DWORD /d 1 /f >> %LOGFILE% 2>&1
echo [%date% %time%] Registry set >> %LOGFILE%

:: Start the Windows touch keyboard daemon
start "" "C:\Program Files\Common Files\microsoft shared\ink\TabTip.exe"
echo [%date% %time%] TabTip started >> %LOGFILE%

timeout /t 2 /nobreak > nul

:: Launch Edge in kiosk mode (--kiosk preserves cache; --edge-kiosk-type=fullscreen does not)
start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --kiosk https://<your-kinboard-url>/ --no-first-run --lang=de
echo [%date% %time%] Edge kiosk started >> %LOGFILE%
```

Replace `https://<your-kinboard-url>/` and `--lang=de` to taste.

The `EnableDesktopModeAutoInvoke=1` registry key is **load-bearing**. It's the setting that makes Windows pop the on-screen keyboard when a text field gets focus, even outside tablet mode.

### 4. Drop the presence-sensor wrapper

Save as `C:\run-presence-hidden.vbs`:

```vbscript
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """C:\Program Files\Python312\python.exe"" C:\presence-sensor.py <YOUR_DEVICE_ID>", 0, False
```

Replace `<YOUR_DEVICE_ID>` with the device's UUID from Kinboard (Settings → Devices → enable "Presence sensor" toggle on this device → copy the displayed ID).

The `Run …, 0, False` arguments mean: window-style 0 = hidden, wait = no-wait. So it launches Python detached and the user never sees a console.

### 5. Drop the presence-sensor script

Copy `presence-sensor.py` from the [Kinboard repo](https://github.com/svenger87/kinboard/blob/main/presence-sensor.py) to `C:\presence-sensor.py`.

Edit the URL constant:

```python
API_URL = os.environ.get("KINBOARD_URL", "http://localhost:3001").rstrip("/") + "/api/presence"
```

Or set `KINBOARD_URL` in the user environment so the same script works across redeployments. See [Presence-Sensor](Presence-Sensor) for full setup details.

### 6. Drop the display sleep / wake helpers

Save as `C:\display-sleep.ps1`:

```powershell
# 8:00 PM — Set 15-minute display timeout for nighttime standby
powercfg /change monitor-timeout-ac 15
```

Save as `C:\display-wake.ps1`:

```powershell
# 7:00 AM — Wake display, disable auto-off for daytime
powercfg /change monitor-timeout-ac 0

# Send SC_MONITORPOWER -1 to turn the display ON immediately
$sig = '[DllImport("user32.dll")] public static extern int SendMessage(int hWnd, int hMsg, int wParam, int lParam);'
$type = Add-Type -MemberDefinition $sig -Name DisplayWake -PassThru
$type::SendMessage(-1, 0x0112, 0xF170, -1)
```

### 7. Register the scheduled tasks

Open **Task Scheduler** (or use PowerShell). Create four tasks at the root level (Task Scheduler Library, not under a sub-folder):

#### Task: KioskLauncher

- Trigger: **At logon of any user** (or specifically `Calendar`)
- Action: Start a program → `C:\kiosk-launcher.bat`
- Run with **highest privileges**, run only when user is logged on
- General → Run with: `Calendar`, **Run only when user is logged on**, **Run with highest privileges**

#### Task: PresenceSensor (skip if not using presence sensor)

- Trigger: **At logon**
- Action: Start a program → `wscript.exe`, arguments: `C:\run-presence-hidden.vbs`
- Same principal settings as above

#### Task: DisplaySleep

- Trigger: **Daily at 20:00**
- Action: `powershell` with arguments `-ExecutionPolicy Bypass -File C:\display-sleep.ps1`
- General → Run as **SYSTEM**, **Run whether user is logged on or not**, **Run with highest privileges**

#### Task: DisplayWake

- Trigger: **Daily at 07:00**
- Action: `powershell` with arguments `-ExecutionPolicy Bypass -File C:\display-wake.ps1`
- Run as **SYSTEM** (same as above)

In each task's **Settings** tab, set:
- **Allow task to be run on demand** ✓
- **If the task fails, restart every** 1 minute, attempt 3 times
- **Stop the task if it runs longer than** 72 hours

### 8. Edge policies (optional but recommended)

Set these via Group Policy (`gpedit.msc` → Computer Configuration → Administrative Templates → Microsoft Edge) or directly in the registry:

```
HKLM\SOFTWARE\Policies\Microsoft\Edge
  BrowserSignin                = 0      (DWORD; disable Edge sign-in)
  HideFirstRunExperience       = 1      (DWORD; skip first-run wizard)
  DefaultBrowserSettingEnabled = 0      (DWORD; don't nag about default browser)
  ClearBrowsingDataOnExit      = 0      (DWORD; preserve PWA caches across reboots)
```

These keep Edge behaving in kiosk mode without surprise dialogs.

### 9. Power policy

Stay on the Balanced power plan but tweak:

```powershell
powercfg /change monitor-timeout-ac 0   # Display: never sleep on AC
powercfg /change standby-timeout-ac 0   # System: never sleep on AC
powercfg /change disk-timeout-ac 0      # Disk: never spin down
powercfg /change hibernate-timeout-ac 0 # Hibernate: never
```

The DisplaySleep / DisplayWake scheduled tasks override `monitor-timeout-ac` daily.

### 10. Reboot

```powershell
shutdown /r /t 0
```

The Mele auto-logs in as `Calendar`, KioskLauncher fires, Edge opens in kiosk mode pointed at Kinboard. PresenceSensor starts in the background.

## Updating

### Webapp updates

The Mele just runs a browser pointing at your Kinboard host. When you update the host (`./deploy.sh` or `./start.sh restart`), the kiosk picks up the new code on the next page reload (or after a momentary 502 during the webapp container restart).

### Updating the presence script

Push the new `presence-sensor.py` to the Mele over SSH:

```bash
scp presence-sensor.py calendar@<mele-ip>:C:\presence-sensor.py
ssh calendar@<mele-ip> "schtasks /End /TN PresenceSensor; schtasks /Run /TN PresenceSensor"
```

### Updating the kiosk launcher

Same pattern. After the file is updated, log out + back in (or run KioskLauncher once manually).

## Logging

Each part writes to a separate log:

| Log | What |
|---|---|
| `C:\kiosk.log` | KioskLauncher startup events |
| `C:\presence-sensor.log` | Presence sensor activity (state changes, distance reads, watchdog) |

Note: the presence-sensor log is not currently rotated. As of writing it can grow several MB per week. A v1.1 fix will swap to `RotatingFileHandler`. For now, `Clear-Content` it manually if it gets large:

```powershell
Clear-Content C:\presence-sensor.log
```

## Network

The reference Mele is on Wi-Fi only. If you have Ethernet, plug in and disable Wi-Fi for stability. Note that Wi-Fi sleep can occasionally drop the kiosk from the network for a few seconds; if that's a problem:

```powershell
# Disable Wi-Fi adapter power management
Set-NetAdapterPowerManagement -Name "Wi-Fi" -DeviceSleepOnDisconnect Disabled
```

## SSH server (optional but recommended)

For remote ops without RDP:

```powershell
# Install OpenSSH Server (if not already)
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Start-Service sshd
Set-Service -Name sshd -StartupType Automatic

# Open firewall (usually auto-opened by the install)
New-NetFirewallRule -Name sshd -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22
```

Then drop your public key into `C:\Users\Calendar\.ssh\authorized_keys` and you can `ssh calendar@<mele-ip>` without password prompts.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| **Edge doesn't auto-launch on boot** | KioskLauncher task didn't fire. Check `C:\kiosk.log` exists; if not, verify the task is enabled and runs as `Calendar` with **Run only when user is logged on**. |
| **On-screen keyboard doesn't appear** | `EnableDesktopModeAutoInvoke` not set, or TabTip.exe not running. Re-run `kiosk-launcher.bat` manually and verify both. |
| **Presence sensor not detecting** | Check `C:\presence-sensor.log` for the COM port detected. If wrong, set `SERIAL_PORT` env var or hard-code in the script. |
| **Display turns off mid-day** | Powercfg `monitor-timeout-ac` got reset by Windows Update. Re-apply via DisplayWake. |
| **Kiosk Edge shows "Your browser is being managed"** | Group Policy applied — that's fine, ignore the chrome banner. |
| **Edge updates pop a UAC dialog** | Group Policy → disable Edge auto-update, or accept that the dialog is one tap to dismiss |

## Related

- [Reference-Build](Reference-Build) — full BOM, frame construction, photos, cabling
- [Presence-Sensor](Presence-Sensor) — full LD2410 setup
- [Kiosk-Linux-Guidance](Kiosk-Linux-Guidance) — if you want to run on Linux instead
- [Self-hosting](Self-hosting) — the Kinboard host the kiosk points at
