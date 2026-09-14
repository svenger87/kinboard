# Timers

The Timers widget puts kitchen timers directly on the dashboard. It requires no
integration or account and is enabled by default.

## Start and stop a timer

Tap **3 min**, **5 min**, **10 min**, or **15 min** in the Timers widget. The
countdown appears immediately and is shared with every device in the family.
Several timers can run at once, and any family device can stop one with its
close button.

When the countdown reaches zero, the row changes to **Time's up** and stays
there until somebody selects **Dismiss**. The screensaver is held back while a
finished timer needs attention.

Timers use the server clock as their reference. A tablet with a slightly wrong
system clock therefore still agrees with the other devices and with the server.

## Alerts

- A kiosk device plays one short tone when a timer ends.
- Devices subscribed to Kinboard notifications receive a push alert.
- Several timers ending together produce one tone rather than overlapping
  sounds.

Browser audio rules can block sound until somebody has interacted with the
page. The persistent red **Time's up** state is the reliable alarm; sound is a
best-effort addition. Phones rely on push notifications and do not also beep
from an open Kinboard tab.

Stopping a timer cancels its queued push notification. A device that was asleep
when the timer ended shows the finished state when it wakes.

## Settings and troubleshooting

Use **Settings → Widgets** to show or hide Timers on the family dashboard.
Hiding the widget does not delete timer records, but the dashboard no longer
offers controls for them until the widget is enabled again.

| Problem | Check |
|---|---|
| No sound on the wall display | Interact with the page once after the kiosk browser starts and confirm the device is configured as a kiosk. |
| No phone notification | Enable notifications on that device and use **Settings → Notifications → Send test**. |
| Another device updates slowly | Confirm Realtime is healthy; a polling fallback will normally reconcile active timers within ten seconds. |
| Timers widget is missing | Enable it under **Settings → Widgets**. |

See [Notifications](Notifications) for browser and HTTPS requirements.
