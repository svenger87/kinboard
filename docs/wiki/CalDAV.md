# CalDAV

Two-way calendar sync with any CalDAV server — Nextcloud, Radicale, Baïkal, SOGo, Synology Calendar, Fastmail, iCloud, mailbox.org. Events you create or edit in Kinboard are written back to the server; changes made on a phone flow down at the next sync.

Configure it at **Settings → Calendar → CalDAV**.

## Why CalDAV rather than an ICS feed

Kinboard has supported [`.ics` feeds](Calendar#icalendar-ics-feeds) since v1.0.19, and they cover a lot of ground — but a published `.ics` URL is a one-way, unauthenticated snapshot. CalDAV is the protocol those calendars are actually served over, and using it directly buys three things:

| | ICS feed | CalDAV |
|---|---|---|
| Authentication | None — the URL *is* the secret | Username + password |
| Direction | Server → Kinboard only | Both ways |
| Editing in Kinboard | No | Yes |
| Discovery | You paste one URL per calendar | Connect once, pick from the list |

If you're not in the Google ecosystem, CalDAV is the recommended way to connect a calendar to Kinboard.

## Connecting a server

1. **Settings → Calendar → CalDAV → Add server.**
2. Enter the **server URL**. The root is enough — Kinboard walks `current-user-principal` → `calendar-home-set` to find your calendars, exactly like a native calendar client does. Common starting points:

   | Provider | Server URL |
   |---|---|
   | Nextcloud | `https://cloud.example.com/remote.php/dav` |
   | Radicale | `https://radicale.example.com/` |
   | Baïkal | `https://dav.example.com/dav.php` |
   | Fastmail | `https://caldav.fastmail.com` |
   | iCloud | `https://caldav.icloud.com` |
   | Synology Calendar | `https://nas.example.com:5001/caldav.php` |
   | mailbox.org | `https://dav.mailbox.org/` |

3. Enter your **username and password**. Use an app-specific password wherever the provider offers one — Nextcloud (Settings → Security → Devices & sessions), Fastmail and iCloud all do. An app password can be revoked on its own without changing your account password, and several providers *require* one when 2FA is on.
4. Click **Connect**. Kinboard lists every calendar the account can see, marking which are read-only.
5. Tick the ones you want and click **Add**. Each becomes a calendar row in Kinboard, syncs immediately, and then re-syncs every 30 minutes.

Per-calendar colour, the assigned family member, and the holidays/waste-pickup flags are set afterwards with the pencil icon — same options as any other calendar.

## What syncs, and when

- **Window** — events from 30 days ago through 60 days ahead, the same slice ICS feeds use. Multi-year calendars don't bloat the events table.
- **Schedule** — every 30 minutes (`sync-caldav` in `webapp/docker/ofelia.ini`, at :15 and :45), plus **Sync now** in the settings page.
- **Change detection** — Kinboard reads the collection's CTag first and skips the full fetch when nothing has changed, so a quiet calendar costs one cheap request per cycle.
- **Recurring events** — expanded locally, capped at 200 instances per series. Server-side expansion is optional in RFC 4791 and implemented inconsistently, so Kinboard does it the same way for every provider.
- **Writes** — sent the moment you save, not on the sync cycle. Creating, editing or deleting an event in Kinboard issues a `PUT`/`DELETE` against that event's resource straight away.

## Conflicts and read-only calendars

Every write carries the ETag Kinboard last saw for that event. If the event changed on another device in the meantime, the server rejects the write with `412` and Kinboard tells you instead of silently discarding the other change. Re-run **Sync now** to pull the newer version, then make your edit again.

Calendars the server reports as read-only — someone else's calendar shared with you, a subscribed holiday collection — get a **Read-only** badge and are never written to. If a server doesn't publish privilege information at all, Kinboard assumes the calendar is writable and lets a failed write be the authority; that's the safer direction to guess in.

## Credentials and storage

Passwords go into the `integration_secrets` table, which is revoked from the `anon` and `authenticated` database roles and reachable only by the server. They are never included in an API response and never reach the browser — which is why the edit dialog asks you to re-enter a password to change it rather than showing the stored one.

Removing a calendar deletes its events and forgets its password. The calendar on the server is untouched.

## Self-hosted servers on your LAN

A CalDAV server on a private address (`https://192.168.1.10/...`, `https://nas.local:5001/...`) is fine — Kinboard deliberately does *not* apply the public-URL guard it uses for recipe imports, because self-hosted-on-the-LAN is the main use case. The trust boundary is the same one Home Assistant and Immich sit behind: an admin-configured URL in a PIN-gated settings page.

A **self-signed certificate** will be rejected. Either use a certificate the Kinboard container trusts (a LAN CA, or a real certificate via your reverse proxy), or reach the server over plain `http://` inside a trusted network.

## Not supported

- **Editing a single occurrence of a repeating event.** A recurring series is one resource on the server; changing one occurrence needs a `RECURRENCE-ID` override that Kinboard's event model has nowhere to store. Kinboard declines the edit and points you at your calendar app. Whole series still sync and display normally.
- **Creating recurring events.** Same reason — add them in your calendar app and they'll sync in.
- **Attendees and invitations.** Kinboard writes no `ATTENDEE` lines and does not RSVP; these are your household's own events, not meeting invites.
- **Tasks (`VTODO`) and journals.** Calendars that hold only tasks are filtered out of the picker. Kinboard's [Tasks](Tasks) feature is separate and not CalDAV-backed.
- **Creating new calendars on the server.** Kinboard subscribes to calendars that already exist; make new ones in your provider's UI.

## Troubleshooting

**"Authentication failed"** — with 2FA enabled, your normal password won't work; generate an app-specific password. On Nextcloud, check that the account isn't restricted to specific apps.

**"No CalDAV service at that URL"** — you likely gave a *calendar* URL rather than the server root. Both usually work, but the root is more reliable; for Nextcloud that's `/remote.php/dav`, not `/remote.php/dav/calendars/<user>/personal/`.

**"TLS certificate rejected"** — see the self-signed certificate note above.

**A calendar stopped updating** — the settings page shows the last error under the calendar's name. Expired app passwords are the usual cause and are otherwise invisible: the calendar just quietly stops changing.

**Events appear twice** — the same calendar was probably added both as a CalDAV calendar and as an `.ics` feed. Remove one; they're independent subscriptions and Kinboard has no way to tell they're the same upstream calendar.

## See also

- [Calendar](Calendar) — the calendar surface itself
- [Google-Calendar](Google-Calendar) — the OAuth-based alternative
- [Security-and-Threat-Model](Security-and-Threat-Model) — how integration credentials are stored
