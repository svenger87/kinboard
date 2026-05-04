# Security policy

## Reporting a vulnerability

If you've found a security issue in Familyboard, please **don't** open a public GitHub issue. Email the maintainer directly:

**security@svenger87.de**

I'll acknowledge within 7 days and aim to ship a fix within 30 days for high-severity issues. If you don't hear back, please bump the thread — single-maintainer projects sometimes drop email.

When reporting, include:

- A description of the vulnerability and the impact
- Steps to reproduce, ideally with a minimal repro
- Affected version (commit hash if you've been tracking `main`)
- Any suggested mitigation

## Threat model

Familyboard is designed for **a single trusted home network**. The default security model assumes:

- All devices on the same LAN are trusted
- The Supabase admin credentials and service-role key are protected by the host's filesystem permissions
- The webapp is **not** exposed directly to the public internet

If you put Familyboard on the open internet, you're responsible for adding a reverse proxy with authentication in front of it (Authelia, Authentik, Traefik forward-auth, Cloudflare Access, etc.). The 6-character family join code is intended as a low-friction LAN onboarding mechanism, not as an internet-facing auth boundary.

## What's in scope

- The Next.js webapp (`webapp/src/`) and its API routes (`webapp/src/app/api/`)
- The bundled Docker stack (`webapp/docker/`)
- Database schema and RLS policies (`webapp/docker/init.sql`)
- The bootstrap script (`setup.sh`) and helper scripts (`webapp/docker/start.sh`, `webapp/deploy.sh`)

## What's out of scope

- Vulnerabilities in upstream dependencies — please report those upstream first
- Self-inflicted misconfigurations (e.g. exposing the stack to the internet without auth, leaking secrets in your own deployment)
- Issues that require physical or network access to the user's home LAN

## Sensitive data Familyboard handles

If something goes wrong, these are the categories at risk:

- **Google OAuth tokens** for Calendar sync (stored encrypted in Supabase)
- **Home Assistant long-lived access tokens** (stored encrypted in Supabase)
- **Immich API keys**, **OpenWeatherMap API keys**, **Bring! account credentials** (per-family, stored encrypted)
- **VAPID push notification keys** (host-level, in `.env`)
- **Family events, todos, shopping lists, photos** — the day-to-day household data the app exists to manage

A vulnerability that lets an unauthenticated client read or write any of the above qualifies as high-severity.

## Coordinated disclosure

I'm happy to credit reporters in release notes. Let me know how you'd like to be named, or if you'd prefer to remain anonymous.
