# Kiosk on Linux (guidance)

The maintainer's reference deployment runs Windows 11 (see [[Kiosk-Windows-11-Mele-4C]]) — primarily for the auto-popping on-screen keyboard. The Linux story is **untested as a shipped product**, but plenty of self-hosters prefer Linux. This page documents the moving pieces so you can roll your own.

> ⚠ This page is **guidance**, not a step-by-step recipe. Earlier versions of this repo shipped six bash launch variants; they're gone now because nobody dogfoods them. If you build a working Linux kiosk on top of this guidance and want to upstream the docs back, PRs welcome.

## What you need

A Linux distribution that can run:

- A modern browser (Chromium / Edge / Firefox) in kiosk mode
- Some kind of on-screen keyboard with auto-show on text-field focus
- Auto-login to a graphical session
- A way to keep the screen unlocked indefinitely (or wake on touch)

Pick one of the three flavors below based on which constraints you care about most.

## Flavor A: minimal Wayland (Cage + Firefox + wvkbd)

The lightest setup. **No window manager**, just one fullscreen surface running Firefox.

- **[Cage](https://github.com/cage-kiosk/cage)**: a wlroots-based Wayland compositor that launches one fullscreen application and exits when it does. ~50 KB binary.
- **Firefox** (or Chromium) with `--kiosk` flag.
- **[wvkbd](https://github.com/jjsullivan5196/wvkbd)** as the on-screen keyboard. Visibility controlled by SIGUSR1 / SIGUSR2.
- A small **CDP bridge** (Chrome DevTools Protocol) to connect to Firefox's debug port and send the right SIGUSR signal when a text field gains/loses focus.

Pros:
- Lowest resource footprint (no DE, no display manager)
- Boots straight into Firefox in <5s on modern hardware
- Easy to lock down — there's literally nothing else to escape into

Cons:
- The CDP bridge is fragile. Browser version updates occasionally break the protocol contract.
- wvkbd's auto-show isn't built in; you write the bridge yourself.
- No power management UI — you handle DPMS via `wlopm` or kernel cmdline.

Sketch of the launch script:

```bash
#!/usr/bin/env bash
# /usr/local/bin/familyboard-kiosk
exec cage -d -- bash -c '
  wvkbd-mobintl -L 300 -H 300 --hidden --non-exclusive \
    --bg 1b1b1f --fg 2d2d33 --fg-sp 1e1e22 \
    --press 3c3c44 --text e8eaed --text-sp a8abb3 &
  firefox-esr --start-maximized --remote-debugging-port 9222 \
    "${FAMILYBOARD_URL:-http://localhost:3001/}" &
  sleep 5
  python3 /usr/local/bin/keyboard-bridge.py
'
```

`keyboard-bridge.py` polls Firefox's CDP for `Runtime.consoleAPICalled` events flagging input focus and toggles wvkbd via SIGUSR2 (show) / SIGUSR1 (hide). The previous repo had one; if you write a better one, PR it back.

## Flavor B: GNOME with Chromium

If you want a familiar desktop underneath the kiosk (so you can drop into the Activities overview to fix something), GNOME is comfortable. GNOME's built-in `caribou` / GNOME Shell on-screen keyboard handles auto-show natively.

- Install GNOME (Fedora Workstation, Ubuntu GNOME, Debian, whatever)
- Set auto-login for the kiosk user
- Configure the Startup Applications to launch Chromium in kiosk mode
- Enable "Screen Keyboard" in GNOME Accessibility settings → it auto-pops on touch device focus

Sample launch shortcut (`~/.config/autostart/familyboard.desktop`):

```ini
[Desktop Entry]
Type=Application
Name=Familyboard Kiosk
Exec=chromium --kiosk --noerrdialogs --disable-infobars --no-first-run \
  --enable-gpu-rasterization --touch-events=enabled --disable-pinch \
  --overscroll-history-navigation=disabled --autoplay-policy=no-user-gesture-required \
  --remote-debugging-port=9222 \
  http://localhost:3001/
X-GNOME-Autostart-enabled=true
```

Pros:
- Working on-screen keyboard out of the box
- Mature DPMS / power management
- Easier to recover when something breaks (just press Super)

Cons:
- ~1 GB of GNOME installed; ~2-4 s longer boot than Cage
- More attack surface (anything in GNOME could be exploited)
- The on-screen keyboard appearance is GNOME-themed, which may or may not match your aesthetic

## Flavor C: X11 + Chromium app mode + Onboard

Old-school but rock-solid. X11 + a tiny WM (Openbox) + Chromium in app mode + Onboard for the keyboard.

- **Openbox** as a minimal stacking WM
- **Chromium** with `--app=<URL>` (kiosk-like, but allows the Onboard window to overlay)
- **[Onboard](https://launchpad.net/onboard)** as the on-screen keyboard, configured to auto-show on text-field focus

Pros:
- Predictable. X11 is X11.
- Onboard's auto-show works without a CDP bridge (it watches X events directly)
- Plenty of documentation and community support

Cons:
- X11 is being phased out across Linux distros
- Higher latency than Wayland for touch
- Pixel scaling on HiDPI is hit-or-miss

Sample Openbox autostart (`~/.config/openbox/autostart`):

```bash
onboard --layout Compact --theme Charcoal &
chromium \
  --app=http://localhost:3001/ \
  --start-maximized \
  --noerrdialogs --disable-infobars --no-first-run \
  --enable-gpu-rasterization --remote-debugging-port=9222 \
  --touch-events=enabled --disable-pinch \
  --overscroll-history-navigation=disabled \
  --autoplay-policy=no-user-gesture-required \
  --lang=de
```

## Auto-login

Distribution-specific. Common approaches:

- **systemd / lightdm / gdm**: edit the autologin user in the display manager config (`/etc/lightdm/lightdm.conf`, etc.)
- **getty + cage**: for the Cage flavor without any DM, autologin via `/etc/systemd/system/getty@tty1.service.d/override.conf`:

  ```ini
  [Service]
  ExecStart=
  ExecStart=-/sbin/agetty --autologin kiosk --noclear %I $TERM
  ```

  Then put the kiosk launch in `~/.bash_profile` so the autologin shell exec's it.

## Touch screen rotation

If your touchscreen reports input but the orientation is wrong, you need a udev rule + xinput / wlr-randr. Earlier versions of this repo shipped:

```
# /etc/udev/rules.d/99-touch-rotation.rules
ATTRS{name}=="ILITEK Multi-Touch", ENV{LIBINPUT_CALIBRATION_MATRIX}="0 1 0 -1 0 1"
```

(Adjust `name` and the matrix to match your hardware. The matrix above is a 90° clockwise rotation.)

## DPMS / display power

- **Wayland (Cage / Sway)**: `wlopm --on '*'` / `wlopm --off '*'`
- **Wayland (Hyprland)**: `hyprctl dispatch dpms on` / `dpms off`
- **GNOME (Mutter)**: D-Bus method `org.gnome.Mutter.DisplayConfig.Power` (custom; or `xset dpms force off` under XWayland)
- **X11**: `xset dpms force off` / `xset dpms force on`

The presence sensor script can call any of these. See [[Presence-Sensor]] for the configurable backend hooks.

## Why we don't ship working scripts

Earlier this repo shipped six launcher variants in `kiosk/`. They were unmaintained — the maintainer moved to Windows for the on-screen keyboard ergonomics, and nobody else was running the Linux scripts. Carrying broken bash + claiming it works is worse than not shipping it.

If you're a Linux self-hoster who'd like to upstream working scripts: open a discussion on GitHub describing your distro + flavor (A/B/C above) and we'll figure out a curated ship-shape together.

## Related

- [[Kiosk-Windows-11-Mele-4C]] — the working reference deployment
- [[Presence-Sensor]] — sensor wiring and DPMS hooks
- [[Quick-start]] — bring up the host that the kiosk points at
