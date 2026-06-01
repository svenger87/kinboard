# Onboarding

How devices join a family, and how the first family gets created.

## First-run experience

When the database has no families, the `/join` page detects this (via `/api/setup/status`) and:

- Auto-flips to "Create" mode
- Hides the join/create tab toggle
- Shows a "Welcome — let's set things up" card

You enter a family name, give the device a name, and click **Create family**. The family is created with a randomly-generated 6-character `join_code`, the device is registered, and you're redirected to the dashboard at `/`.

> TODO: screenshot of the fresh-install `/join` page

## Adding a second device

On the second device, browse to `http://<host>:<port>/join`. The page shows the join/create tabs because at least one family exists.

1. Tap **Join family**
2. Enter the 6-character code (find it under **Settings** on a connected device — see below)
3. Give the new device a friendly name (defaults to "My device")
4. Tap **Join**

The device's hardware fingerprint (browser characteristics) is stored alongside the device row. On future visits to `/join`, the page recognizes the fingerprint and offers a "Sign back in as Living-room display" shortcut so you don't need to retype the code.

## Where to find the join code

Settings → top of the page. Each family device shows the same `join_code`.

> TODO: screenshot of the join code panel in /settings

## Multi-family on one device

A device belongs to exactly one family at a time. To switch families, leave the current one (Settings → **Leave family**) and join a new one. The local data on that device is cleared (cookies + localStorage); the family's data on the server is unaffected.

## Multi-device per family

There's no hard cap on devices per family. Typical deployments:

- 1 wall-mounted kitchen display
- 2–4 phones (one per adult, optional ones for kids)
- 1–2 tablets (couch / nightstand)
- A dev laptop running `npm run dev`

All see the same state. Edits propagate via Supabase Realtime within ~100 ms.

## Identifying devices in /settings/devices

Each row shows:

- Custom device name (editable)
- Online/offline indicator (last_seen within 5 minutes = online)
- "This device" badge for the one you're currently on
- A device ID (8-character truncated UUID, copyable) — needed when configuring the [Presence-Sensor](Presence-Sensor)

<img src="images/settings-devices.png" alt="Settings — devices: joined-device list" width="420"/>

## Leaving a family

Settings → **Leave family** at the bottom. The device's row is deleted from the family's `devices` table; the family itself stays. The local browser state is cleared and you land back on `/join`.

If the device you're leaving is the last one in the family, the family rows stay in the database. Any other device that has the join code can re-enter and pick up where you left off.

## Resetting everything

To wipe a fresh-install state:

```bash
docker exec -i kinboard-db psql -U postgres -d postgres <<'EOF'
TRUNCATE families CASCADE;
EOF
```

`CASCADE` removes everything linked: devices, people, calendars, events, todos, shopping_items, etc. The schema and the demo seed (if applied) are unaffected.

## Anti-patterns

- **Don't share the join code over the public internet.** Anyone with the code + the URL can join your family. The model assumes a trusted LAN. See [Security-and-Threat-Model](Security-and-Threat-Model).
- **Don't manually edit the `devices` table** unless you know what you're doing. The webapp uses the row's UUID as the active device key in cookies; renaming the row is fine, deleting it logs the device out.
- **Don't enable AssignedAccess kiosk mode for the kiosk user account** if you want notifications + Edge to coexist — Kinboard's Edge `--kiosk` flag does the lockdown without the AssignedAccess complications. See [Kiosk-Windows-11-Mele-4C](Kiosk-Windows-11-Mele-4C).
