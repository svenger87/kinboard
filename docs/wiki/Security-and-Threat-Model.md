# Security and threat model

Familyboard is **designed for a single trusted home network**. Read that sentence once more — the entire authorization model rests on it.

## What the auth model actually is

Identity is a 2-tuple:

1. **Family** — identified by a 6-character `join_code`. Anyone with the code can register a device and read/write the family's data.
2. **Device** — identified by a UUID stored in a cookie. Each device that joins a family gets its own row in `public.devices` with a `last_seen` timestamp.

There are **no user accounts**. There is **no password protection on data access by default** beyond the join code. There is an optional 4-digit PIN gate on the `/settings/*` area (see "Settings PIN" below).

Every database row is gated by a [Row-Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) policy that checks `family_id` against a header derived from the join code. The Supabase service-role key bypasses RLS and is held only by the Next.js server process — never exposed to the browser.

## What this is good for

- **A trusted LAN.** Everyone in the house has the join code. Nobody else does. A new family member joining just needs the code, like a Wi-Fi password.
- **Low-friction kiosk and PWA UX.** No login screens to confuse the kids. No tokens to refresh. No password resets.
- **Self-hosters who already secure their LAN.** The rest of your home network has the same trust model — your printer doesn't need OAuth either.

## What this is NOT good for

- **Public internet exposure without a wrapping auth layer.** The join code is 6 alphanumeric characters (~30 bits of entropy). Brute force is possible. Don't expose `/join` publicly without something like Authelia, Authentik, Cloudflare Access, or Traefik forward-auth in front.
- **Untrusted users on the same family.** Anyone with the code can read every event, todo, recipe, photo URL, OAuth token, and device fingerprint of every other device in the family. The model assumes "everyone in the family has the same trust level."
- **Compliance scenarios.** No audit logs, no role-based access, no per-resource ACL. Don't use Familyboard for anything that needs HIPAA, GDPR-data-controller distinction, or similar.

## Sensitive data Familyboard handles

If something goes wrong, these categories are at risk:

- **OAuth refresh tokens** for Google Calendar (in `settings.value` JSONB, AES-encrypted at rest by Postgres only if you enable disk encryption — Familyboard itself does not encrypt the column)
- **Long-lived access tokens** for Home Assistant
- **API keys** for Immich, OpenWeatherMap, Bring! account credentials
- **VAPID push notification keys** at host level (in `webapp/docker/.env`)
- **Family content**: events, todos, shopping lists, recipe library, uploaded avatars, screensaver photo URLs, camera RTSP URLs (and embedded credentials), HA entity history
- **The Supabase JWT secret** (`JWT_SECRET`) and service role key — host-level, in `webapp/docker/.env`

A vulnerability that lets an unauthenticated client read or write any of the above qualifies as high-severity. See [`SECURITY.md`](https://github.com/svenger87/familyboard/blob/main/SECURITY.md) in the repo for disclosure.

## Recommended hardening

For the typical home deployment:

### Required

- **Don't expose the stack directly to the public internet.** Use a reverse proxy with auth in front, or restrict via WireGuard / Tailscale / Cloudflare Tunnel + Access.
- **Generate strong secrets via `setup.sh`.** Don't hand-edit `.env` to use easily-guessed passwords.
- **Set the Settings PIN** if you have curious kids or visiting guests with the join code. See below.

### Recommended

- **Disable signup if you self-host Supabase Auth.** Familyboard doesn't actually use GoTrue auth flows for the family identity model, so leaving signup off avoids accidental account creation. Set `GOTRUE_DISABLE_SIGNUP=true` in `webapp/docker/.env`.
- **Limit the Postgres port to localhost.** The default `docker-compose.yml` exposes 5432 to the host network so you can `psql` for ops. If you don't need that, change `"5432:5432"` to `"127.0.0.1:5432:5432"`.
- **Rotate the family join code occasionally.** Currently no UI for this — direct DB update needed (`UPDATE families SET join_code=... WHERE id=...`).

### Nice-to-have

- **Disable kiosk auto-login on the wall display** if family members have different trust levels. Familyboard's PIN gate covers `/settings/*` but not the dashboard itself.
- **Apply Postgres at-rest encryption** at the filesystem layer (LUKS, ZFS encryption, etc.).

## The Settings PIN

Settings → **Settings PIN** sets a 4-digit code that's required to enter `/settings/*`. The PIN itself is stored as plaintext in the `settings.value` JSONB (under the `settings_pin` key) — it's a "keep curious kids out" feature, not a real auth boundary.

Once set, the PIN persists for the browser session via `sessionStorage`. Closing the tab requires re-entry; navigating between settings sub-pages does not.

## Trusted-LAN-but-still-paranoid checklist

- [ ] Stack runs on a host that's not directly reachable from the WAN
- [ ] If using Traefik publicly, an auth middleware sits in front of it
- [ ] `setup.sh` was run with no manual edits to the generated secrets
- [ ] `webapp/docker/.env` is mode 600 (`chmod 600`)
- [ ] Backups encrypt the `pg_dump` output
- [ ] No real production data lives in development checkouts (`webapp/.env.local` should be empty or have non-prod values)
- [ ] If multiple families share a host, each runs in its own Compose project (`PROJECT_NAME` differs)

## Reporting a vulnerability

Email **security@svenger87.de**. Don't open public issues. Acknowledgement within 7 days, fix targeted within 30 days for high-severity. Full text in [`SECURITY.md`](https://github.com/svenger87/familyboard/blob/main/SECURITY.md).
