# Security and threat model

Kinboard is **designed for a single trusted home network**. Read that sentence once more — the entire authorization model rests on it.

## What the auth model actually is

Identity is a 2-tuple:

1. **Family** — identified by a 6-character `join_code`. Anyone with the code can register a device and read/write the family's data.
2. **Device** — identified by a UUID stored in a cookie. Each device that joins a family gets its own row in `public.devices` with a `last_seen` timestamp.

There are **no user accounts**. There is **no password protection on data access by default** beyond the join code. There is an optional 4-digit PIN gate on the `/settings/*` area (see "Settings PIN" below).

**Row-Level Security is disabled on all family-scoped tables in the canonical schema.** Earlier versions shipped RLS policies keyed on `family_id`, but the application never reliably set the Postgres GUC they depended on, so the policies blocked legitimate writes more than they protected data — production has run with RLS off since shortly after launch (`webapp/docker/migration_disable_rls.sql`). **The device-cookie + join-code model described above is the actual, load-bearing security boundary** — it's enforced entirely in application code (every API route filters by `family_id`), not by Postgres. Anyone who can reach the API with a valid join code (or a `family_id`, which isn't itself a secret — it's visible in the client bundle and `localStorage`) can read and write that family's data; there is no database-level backstop if a route ever forgot to filter. See [Architecture → Row-Level Security](Architecture#row-level-security-disabled-and-why) for the technical detail.

The one place Kinboard does enforce a real database-level boundary is secrets: the Supabase service-role key bypasses everything and is held only by the Next.js server process, never exposed to the browser, and integration credentials get their own locked-down table — see [Integration credentials](#integration-credentials) below.

## What this is good for

- **A trusted LAN.** Everyone in the house has the join code. Nobody else does. A new family member joining just needs the code, like a Wi-Fi password.
- **Low-friction kiosk and PWA UX.** No login screens to confuse the kids. No tokens to refresh. No password resets.
- **Self-hosters who already secure their LAN.** The rest of your home network has the same trust model — your printer doesn't need OAuth either.

## What this is NOT good for

- **Public internet exposure without a wrapping auth layer.** The join code is 6 alphanumeric characters (~30 bits of entropy). Brute force is possible. Don't expose `/join` publicly without something like Authelia, Authentik, Cloudflare Access, or Traefik forward-auth in front.
- **Untrusted users on the same family.** Anyone with the code can read every event, todo, recipe, photo URL, and device fingerprint of every other device in the family. The model assumes "everyone in the family has the same trust level."
- **Compliance scenarios.** No audit logs, no role-based access, no per-resource ACL. Don't use Kinboard for anything that needs HIPAA, GDPR-data-controller distinction, or similar.

## Sensitive data Kinboard handles

If something goes wrong, these categories are at risk:

- **OAuth refresh tokens** for Google Calendar, and **CalDAV account passwords** (both in `integration_secrets`, encrypted at rest by Postgres only if you enable disk encryption — Kinboard itself does not encrypt the column, but the table is locked down from anon/authenticated reads; see [Integration credentials](#integration-credentials)). Prefer a provider-issued app password over your main account password for CalDAV: it can be revoked on its own if a backup leaks.
- **Long-lived access tokens** for Home Assistant
- **API keys** for Immich, OpenWeatherMap, Bring! account credentials
- **VAPID push notification keys** at host level (in `webapp/docker/.env`)
- **Family content**: events, todos, shopping lists, recipe library, uploaded avatars, screensaver photo URLs, camera RTSP URLs (and embedded credentials), HA entity history
- **The Supabase JWT secret** (`JWT_SECRET`) and service role key — host-level, in `webapp/docker/.env`

A vulnerability that lets an unauthenticated client read or write any of the above qualifies as high-severity. See [`SECURITY.md`](https://github.com/svenger87/kinboard/blob/main/SECURITY.md) in the repo for disclosure.

## Recommended hardening

For the typical home deployment:

### Required

- **Don't expose the stack directly to the public internet.** Use a reverse proxy with auth in front, or restrict via WireGuard / Tailscale / Cloudflare Tunnel + Access.
- **Generate strong secrets via `setup.sh`.** Don't hand-edit `.env` to use easily-guessed passwords.
- **Set the Settings PIN** if you have curious kids or visiting guests with the join code. See below.

### Recommended

- **Disable signup if you self-host Supabase Auth.** Kinboard doesn't actually use GoTrue auth flows for the family identity model, so leaving signup off avoids accidental account creation. Set `GOTRUE_DISABLE_SIGNUP=true` in `webapp/docker/.env`.
- **Limit the Postgres port to localhost.** The default `docker-compose.yml` exposes 5432 to the host network so you can `psql` for ops. If you don't need that, change `"5432:5432"` to `"127.0.0.1:5432:5432"`.
- **Rotate the family join code occasionally.** Settings → the join-code card has a "Rotate" action, plus an opt-in expiry (never / 1 hour / 24 hours / 7 days) — expired codes are rejected at join time.

### Nice-to-have

- **Disable kiosk auto-login on the wall display** if family members have different trust levels. Kinboard's PIN gate covers `/settings/*` but not the dashboard itself.
- **Apply Postgres at-rest encryption** at the filesystem layer (LUKS, ZFS encryption, etc.).

## The Settings PIN

Settings → **Settings PIN** sets a 4-digit code that's required to enter `/settings/*`. It's a "keep curious kids out" feature, not a real auth boundary — there's no per-user identity behind it, just a shared 4-digit code for the whole family.

As of v1.4.0, the PIN is checked and stored **server-side**: the value lives in `integration_secrets` (not the anon-readable `settings` table) and verification happens in `/api/pin`, rate-limited to 5 failed attempts per minute per family. Before v1.4.0 the PIN was compared client-side against a plaintext value any device on the network could read via PostgREST — that's fixed now; existing PINs migrated automatically on upgrade.

Once set, the PIN persists for the browser session via `sessionStorage`. Closing the tab requires re-entry; navigating between settings sub-pages does not.

## Integration credentials

OAuth tokens (Google, Home Assistant), CalDAV passwords, and API keys (Immich, Unsplash, Bring!) live in `public.integration_secrets`, a table with `anon`/`authenticated` database privileges revoked and excluded from the Realtime publication — only the server's service-role client can read it. Before v1.4.0 these lived in the same `settings` table as everything else, which is anon-readable by design (so the dashboard can live-sync); that meant any device on the network could read another family member's Google refresh token or Home Assistant long-lived token via PostgREST. Settings pages now read a merged, secret-stripped view to show "connected" status without the browser ever receiving the actual token. Existing installs migrate their previously-exposed credentials into the locked-down table automatically on upgrade — no reconnecting required.

## How device recognition works

Kinboard recognizes a returning device first via a stored device-id (cookie + `localStorage` + IndexedDB + service worker, kept in sync across all four). When that's gone — cleared site data, browser reset, fresh device — the server falls back to a **fingerprint**: a hash derived from the browser/OS environment. The current inputs are `navigator.language`, screen geometry (`width × height × colorDepth`), timezone offset, and `navigator.hardwareConcurrency`. `navigator.userAgent` and `navigator.deviceMemory` are deliberately excluded — both drift with browser updates and would invalidate every existing match the moment Safari or Chrome ships a new minor version. The fingerprint is recomputed on every visit and never stored client-side.

Each device row also keeps a `fingerprint_history TEXT[]` array. Every time recognition matches by the current fingerprint **or** by a fingerprint already present in the history, the current fingerprint is appended if it isn't there yet — the lookup is an `OR` against both columns:

```ts
.or(`fingerprint.eq.${fp},fingerprint_history.cs.{${fp}}`)
```

Effect: a device that has presented multiple fingerprints across its lifetime (e.g. one before a browser update, one after) has both stored, so a future wipe that lands the device back at *either* fingerprint still recognizes it. A GIN index on `fingerprint_history` keeps the array-contains lookup fast.

**What this doesn't survive:** a brand-new device, or switching browsers entirely — different storage origin, different fingerprint inputs, nothing to match against. Recovery is always available through the family code: any device still connected to the family can show it (**Settings** → "Family code"). On the unrecognized device, open `/join`, paste the code, name the device, and tap "Join". That links the device going forward — its new fingerprint gets stored in `fingerprint_history`, so subsequent wipes recover automatically without re-entering the code.

The fingerprint is intentionally low-entropy and stable — the opposite of tracking-grade fingerprinting (no canvas hashing, no audio context, no font enumeration, no WebGL renderer strings). It's enough to disambiguate the handful of devices in a household, but not so sensitive that a routine browser update breaks recognition for everyone in the family.

**Where the lookup runs.** Server-side, in `/api/session/recognize`, using the service role. It cannot run in the browser: `devices` joins to `families`, and families hold join codes, so a row-level-security policy permissive enough to let an anonymous caller read devices would let anyone enumerate households. The route decides what an unauthenticated caller is allowed to be told, and answers with the family's **name** and the device's **name** — never the join code, never the family id, never the other devices. It is rate-limited per IP, because a fingerprint is a guessable thing and this turns a guess into a household name.

**One device, not a list.** The route returns at most one match, the most recently seen. A browser that has joined several times leaves a row behind each time, and offering five identical "Sign back in" cards for one tablet is noise — but the real reason is collisions: where two households' devices happen to look alike, a list would put a stranger's family name on the screen.

**Resuming is a separate step, and it verifies the claim.** `/api/session/resume` issues the session, and a device id alone is not enough for it — those travel in responses. The device's own `hardware_id` is proof: only that device has it. A fingerprint is a guess, and accepting one is the deliberate trade that lets a wiped tablet come back without hunting for the code; it is the same trade the join code makes, on the same assumption of a trusted home network. Rate-limited harder than recognition, because it hands out credentials.

**The automatic restore accepts proof only.** A device with no session in its store is signed back in silently — it is how a wall display returns to the dashboard after a power cut — and that path sends **no fingerprint**. Acting on a guess is only fair when a person is there to confirm it, which is what the "Sign back in" button is.

**Privacy notes:** the fingerprint is not a tracking identifier: every lookup is scoped to a family, never global, so it can't be used to identify a device across families.

Source: `webapp/src/lib/device-id.ts` (fingerprint computation), `webapp/src/app/api/session/recognize/route.ts` (the lookup, and what it will say), `webapp/src/app/api/session/resume/route.ts` (issuing the session, and the trust model written out), `webapp/docker/migration_fingerprint_history.sql` (schema for the history array).

## Trusted-LAN-but-still-paranoid checklist

- [ ] Stack runs on a host that's not directly reachable from the WAN
- [ ] If using Traefik publicly, an auth middleware sits in front of it
- [ ] `setup.sh` was run with no manual edits to the generated secrets
- [ ] `webapp/docker/.env` is mode 600 (`chmod 600`)
- [ ] Backups encrypt the `pg_dump` output
- [ ] `GO2RTC_HTTP_BIND` left at `127.0.0.1` if you use cameras — go2rtc's `/api/streams` lists the sources it holds, and a camera added through Kinboard's settings appears there as a full `rtsp://user:pass@…` URL (see [Cameras](Cameras))
- [ ] No real production data lives in development checkouts (`webapp/.env.local` should be empty or have non-prod values)
- [ ] If multiple families share a host, each runs in its own Compose project (`PROJECT_NAME` differs)

## Reporting a vulnerability

Email **security@kinboard.app**. Don't open public issues. Acknowledgement within 7 days, fix targeted within 30 days for high-severity. Full text in [`SECURITY.md`](https://github.com/svenger87/kinboard/blob/main/SECURITY.md).
