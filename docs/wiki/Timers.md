# Timers

The Timers widget puts kitchen timers directly on the dashboard. It requires no
integration or account and is enabled by default.

## Start and stop a timer

Tap one of the preset times in the Timers widget: **3 min**, **5 min**,
**10 min** and **15 min** until the family changes them (see below). The
countdown appears immediately and is shared with every device in the family.
Several timers can run at once, and any family device can stop one with its
close button.

To pause a running timer, tap the pause button next to it. A paused timer keeps
its time, shows **Paused** on every device, and waits until somebody taps the
play button. Its phone notification moves with it.

When the countdown reaches zero, the row changes to **Time's up** and stays
there until somebody selects **Dismiss**. The screensaver is held back while a
finished timer needs attention.

Timers use the server clock as their reference. A tablet with a slightly wrong
system clock therefore still agrees with the other devices and with the server.

## Alerts

- A kiosk device rings when a timer ends, on whatever page it shows: two
  beeps every three seconds until somebody dismisses the timer, for at most
  two minutes. The red **Time's up** stays after the sound stops.
- Devices subscribed to Kinboard notifications receive a push alert.
- Several timers ending together ring as one, not as overlapping sounds.

Browser audio rules block sound until somebody has touched the screen since the
page loaded; any touch or key press turns it on. While a timer is running or
ringing on a kiosk that cannot sound yet, the Timers widget shows **Tap for
sound** in its header. The persistent red **Time's up** state is
the reliable alarm; sound is a best-effort addition. Phones rely on push
notifications and do not also beep from an open Kinboard tab.

Stopping a timer cancels its queued push notification. A device that was asleep
when the timer ended shows the finished state when it wakes.

## Settings and troubleshooting

Use **Settings → Widgets** to show or hide Timers on the family dashboard.
Hiding the widget does not delete timer records, but the dashboard no longer
offers controls for them until the widget is enabled again.

**Settings → Widgets → Timers → Preset times** changes the buttons. Add a time
in whole minutes, from 1 minute to 24 hours, or remove one you don't use. There
can be up to eight, and the last one can't be removed. The presets belong to
the family, so every device shows the same ones. **Reset to defaults** brings
back 3, 5, 10 and 15 minutes.

| Problem | Check |
|---|---|
| No sound on the wall display | Touch the screen once after the kiosk browser starts (the Timers widget says when the sound is off), confirm the device is a kiosk under **Settings → Devices**, and check the tablet's media volume. |
| No phone notification | Enable notifications on that device and use **Settings → Notifications → Send test**. |
| Another device updates slowly | Confirm Realtime is healthy; a polling fallback will normally reconcile active timers within ten seconds. |
| Timers widget is missing | Enable it under **Settings → Widgets**. |

See [Notifications](Notifications) for browser and HTTPS requirements.
