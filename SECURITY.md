# Security policy

## Reporting a vulnerability

If you've found a security issue in Kinboard, please **don't** open a public GitHub issue. Email the maintainer directly:

**security@kinboard.app**

I'll acknowledge within 7 days and aim to ship a fix within 30 days for high-severity issues. If you don't hear back, please bump the thread — single-maintainer projects sometimes drop email.

When reporting, include:

- A description of the vulnerability and the impact
- Steps to reproduce, ideally with a minimal repro
- Affected version (commit hash if you've been tracking `main`)
- Any suggested mitigation

## Threat model

Kinboard is designed for **a single trusted home network**. The default security model assumes:

- All devices on the same LAN are trusted
- The Supabase admin credentials and service-role key are protected by the host's filesystem permissions
- The webapp is **not** exposed directly to the public internet

If you put Kinboard on the open internet, you're responsible for adding a reverse proxy with authentication in front of it (Authelia, Authentik, Traefik forward-auth, Cloudflare Access, etc.). The 6-character family join code is intended as a low-friction LAN onboarding mechanism, not as an internet-facing auth boundary.

## What's in scope

- The Next.js webapp (`webapp/src/`) and its API routes (`webapp/src/app/api/`)
- The bundled Docker stack (`webapp/docker/`) including kong configuration and CORS allowlists
- Database schema (`webapp/docker/init.sql` + `migration*.sql`)
- The auth boundary: a device joins with the family code and receives a server-issued, HttpOnly session cookie; that cookie is exchanged at `/api/session/token` for a short-lived family-scoped JWT, and **row-level security in Postgres enforces isolation** using the `family_id` claim on that token (`webapp/docker/migration_enable_rls.sql`). `service_role` keeps `BYPASSRLS`, so the API routes and cron jobs establish the family server-side instead.

  This changed on 2026-08-04. RLS was previously disabled by design, on the reasoning that Kinboard runs on a trusted home network. That reasoning does not survive publishing the instance: the browser talks to PostgREST directly with the anon key, which is public by design, so with RLS off an unauthenticated request from the internet could read and write every table — including `families.join_code`. If you are running a build from before that date, treat your instance as readable by anyone who can reach it.
- The bootstrap script (`setup.sh`) and helper scripts (`webapp/docker/start.sh`, `webapp/deploy.sh`)

## What's out of scope

- Vulnerabilities in upstream dependencies — please report those upstream first
- Self-inflicted misconfigurations (e.g. exposing the stack to the internet without auth, leaking secrets in your own deployment)
- Issues that require physical or network access to the user's home LAN

## Sensitive data Kinboard handles

If something goes wrong, these are the categories at risk:

- **Google OAuth tokens** for Calendar sync (stored encrypted in Supabase)
- **Home Assistant long-lived access tokens** (stored encrypted in Supabase)
- **Immich API keys**, **OpenWeatherMap API keys**, **Bring! account credentials** (per-family, stored encrypted)
- **VAPID push notification keys** (host-level, in `.env`)
- **Family events, todos, shopping lists, photos** — the day-to-day household data the app exists to manage

A vulnerability that lets an unauthenticated client read or write any of the above qualifies as high-severity.

## Coordinated disclosure

I'm happy to credit reporters in release notes. Let me know how you'd like to be named, or if you'd prefer to remain anonymous.
