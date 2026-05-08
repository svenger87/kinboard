# Device recognition

Kinboard uses a device-cookie + family-join-code auth model — no usernames, no per-user passwords. To make that ergonomic, the app tries to recognize a returning device and offer a one-tap "Welcome back, *Device*" rejoin instead of asking for the family code every time.

This page documents how that works, what it survives, what it doesn't, and how to recover when recognition fails.

## The two layers

### Layer 1: persistent device-id (the durable identifier)

On first join, the client generates a random 16-byte device-id and stores it in **four** places for redundancy:

- HTTP cookie (`family-calendar-device-id`, 10-year expiry, `SameSite=Lax`)
- `localStorage`
- IndexedDB (`FamilyCalendarDevice` database, `config` store)
- Service worker (synced via `STORE_DEVICE_ID` postMessage)

When the device returns, `getDeviceId()` checks all four locations and uses the first available value (IndexedDB is the most persistent on iOS and Chrome). If found in some but not all, the rest get re-synced.

This is the **durable** path. As long as at least one of the four storage mechanisms survives, the device is recognized instantly.

### Layer 2: device fingerprint (the fallback identifier)

When the device-id is gone (cleared site data, browser reset, fresh device), the server can sometimes still recognize the device by **fingerprint** — a hash derived deterministically from the browser/OS environment.

The hash inputs (current set) are:

- `navigator.language`
- Screen geometry (`width × height × colorDepth`)
- Timezone offset
- `navigator.hardwareConcurrency`

`navigator.userAgent` and `navigator.deviceMemory` are deliberately **excluded** — both drift with browser updates and would invalidate every existing match the moment Safari/Chrome ships a new minor version.

The fingerprint is recomputed every time and never stored client-side.

### Layer 3: fingerprint history (the resilience layer)

Each device row in the `devices` table has a `fingerprint_history TEXT[]` array. Every time the recognition flow finds a device by current fingerprint **or** by `fingerprint_history` containing that fingerprint, the current fingerprint is appended to the array if it isn't there already.

The lookup is an `OR` against both columns:

```ts
.or(`fingerprint.eq.${fp},fingerprint_history.cs.{${fp}}`)
```

Effect: a device that has presented multiple fingerprints across its lifetime (e.g. one before a browser update, one after) has both stored. Future wipes that put the device back at *either* fingerprint still recognize.

A GIN index on `fingerprint_history` keeps the array-contains lookup fast.

## What recognition survives

| Scenario | Layer that catches it |
|---|---|
| Quit + reopen browser | Cookie / localStorage |
| Browser update (Safari 17 → 18) | Cookie still works; if cleared, fingerprint matches because UA isn't in the hash |
| OS update changing UA | Same as above |
| Clearing cookies only | localStorage / IndexedDB |
| Clearing all site data + browser update | Fingerprint history (if device has logged in at least once after the browser-version change since 1.0.11) |
| Fresh device install | Nothing — must enter family code |
| Switching browsers (Safari → Firefox) | Nothing — different UA, different fingerprint, different storage origin |

## What recognition doesn't survive

- **First wipe after a browser update on Kinboard < 1.0.11.** Pre-1.0.11 the fingerprint included `navigator.userAgent`, which changes on every browser update. After a wipe, the new fingerprint doesn't match the stored one. **Recovery: enter the family code manually once. The device's new fingerprint is then stored in `fingerprint_history`, and future wipes recover automatically.**
- **Switching browsers entirely.** Different browsers have different storage origins and different navigator inputs. The user has to enter the family code on the new browser.
- **Different physical device, same browser.** No storage carries over; fingerprint inputs differ enough on different hardware.

## Recovery flow

The family code is the master key for an entire family. **Any device** that's still connected to the family can show it:

`/settings` → "Family code" — copy the 6-character code (e.g. `S8L4GQ`).

On the unrecognized device:

1. Open `/join`
2. Paste the code
3. Set a device name (or accept the default)
4. Tap "Join"

The device is now linked to the family and will be recognized on subsequent visits via the device-id (Layer 1) and fingerprint (Layer 2/3).

When the recognition flow runs and finds zero matches, `/join` shows a recovery hint card explaining this exact path — no need to remember it.

## Privacy notes

- The fingerprint hash is deterministic but coarse — at family-scale (~3-10 devices) collisions are unlikely. Two identical iPhones in the same household with the same language/timezone settings would collide; in that case both rows would be returned by the lookup and the user picks the right one from the rejoin card.
- The fingerprint is not a tracking identifier — it's only ever compared against rows already linked to the family (server query is `SELECT … FROM devices WHERE family_id = ? AND fingerprint = ?` shape). It can't be used to identify a device across families.
- The fingerprint_history array is per-device — wiping one device's data doesn't affect any other device.
- All recognition queries go through the `devices` table which is family-scoped at the schema level. The device-cookie + family-scope auth model documented in [Security & threat model](Security-and-Threat-Model.md) is the primary trust boundary.

## Why not a stronger fingerprint?

The fingerprint is intentionally **low-entropy and stable**, the opposite of what most fingerprinting libraries optimize for. Tracking-grade fingerprints add canvas hashing, audio context, font enumeration, WebGL renderer strings, etc. — each new input increases uniqueness but also increases volatility (each is also more likely to change after a browser update or privacy-mode toggle).

Kinboard wants the *opposite* trade-off: enough entropy to disambiguate the 3-10 devices in a household, but stable enough that a Safari update doesn't break recognition for everyone in the family. Hence the deliberately small input set and the history-array fallback.

## See also

- [Self-hosting](Self-hosting.md) — the device-cookie + family-code auth model in context
- [Security and Threat Model](Security-and-Threat-Model.md) — what we trust, what we don't
- `webapp/src/lib/device-id.ts` — fingerprint computation
- `webapp/src/hooks/use-supabase-queries.ts` — `useFindDeviceByFingerprint`
- `webapp/docker/migration_fingerprint_history.sql` — schema for the history array
