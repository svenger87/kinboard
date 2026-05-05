# Devices

Configured in **Settings → Devices**. The list of devices that have joined this family — the kitchen kiosk, phones, tablets, dev laptops.

> TODO: screenshot of /settings/devices

## What you see

A row per device with:

- **Icon** — phone / tablet / monitor (auto-detected from user-agent)
- **Name** — editable label ("Kitchen kiosk", "Mom's iPhone", "Living room iPad")
- **Online indicator** — green dot = active in the last 5 minutes
- **"This device" badge** on the row you're currently using
- **Kiosk mode toggle** — see below
- **Presence sensor toggle** — see below
- **Edit / Delete** action buttons

## Kiosk mode toggle

When enabled, the device:

- Hides the burger-menu navigation drawer
- Disables certain admin actions (creating a new family, leaving the family)
- Renders slightly larger touch targets (the 27" wall display ergonomics)

Toggle on for the wall-mounted display. Leave off for personal devices.

The toggle is purely UI-side; doesn't add real security. To prevent kids from disabling kiosk mode, set a [[Settings PIN|Security-and-Threat-Model#the-settings-pin]].

## Presence sensor toggle

Toggle on when an [[LD2410 presence sensor|Presence-Sensor]] is wired into this device. Reveals:

- The **device ID** below the row (truncated to 8 chars; copy button gives the full UUID)
- A live **presence indicator** showing current detected state + distance
- A **"Connection lost"** badge if the sensor stops reporting for >30 s

You'll need the device ID when configuring the presence-sensor script — it's how the script tells the server "this is the kiosk in the kitchen."

## Naming conventions

Suggested:

| Use | Name pattern |
|---|---|
| Wall kiosk | "Kitchen kiosk" or "Wohnzimmer Display" |
| Phones | "<Person>'s iPhone" / "<Person>'s Pixel" |
| Tablets | "Living-room iPad" / "Kids' tablet" |
| Dev | "Sven's MacBook" / "Dev laptop" |

The dashboard's family-members row uses the **person** assigned to a device (if any) — no per-device nameplates. The Settings → Devices page is the only place names are surfaced directly.

## Last-seen and online state

Kinboard pings every device every 60 seconds while it's open (the heartbeat in `auth-guard.tsx`). Devices that haven't pinged in 5 minutes show as offline.

Devices that haven't pinged in 30+ days are good candidates to delete from the list. Kinboard doesn't auto-prune.

## Removing a device

Tap the delete icon → confirm. The device is removed from the family. **The device's local cookie isn't invalidated** — if you're physically still using the device, the user can re-join via the family code, but won't be able to read/write until they do.

You can't remove "this device" via this UI (would lock yourself out). To leave the family from the active device, use **Settings → Leave family** instead.

## Real-time

Real-time published. Online state updates on every device's view of /settings/devices within ~1 s of any change.

## Patterns that work well

- **Walk through after adding a new family member**: open /settings/devices, tap-edit each row, set proper names, mark which is kiosk
- **Kid-only devices**: set the kiosk toggle even if the device isn't on a wall — locks down accidental "leave family" presses
- **Detect a stale device**: see one offline for >30 days → delete it. Forces re-join if anyone tries that browser later.

## What's not supported

- **Per-device permissions.** All family devices have the same access. The kiosk toggle is UI-only.
- **Device fingerprint regeneration.** If a browser's cookies are wiped, the device re-creates as a new row with a new ID — the old row stays orphaned. Delete manually.
- **Renaming via the device itself.** Always edit from /settings/devices.

## Related

- [[Security-and-Threat-Model]] — the auth model and PIN gate
- [[Onboarding]] — joining and leaving families
- [[Presence-Sensor]] — using the device ID in the LD2410 script
