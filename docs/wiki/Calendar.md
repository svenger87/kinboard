# Calendar

The `/calendar` page — month and week views of your family's calendar, synced from Google + any local events you add by hand.

![Calendar — month view with per-person color-coded events](images/calendar-month-view.png)

> TODO: week view variant

## Sources of events

The calendar surface unifies events from:

1. **Google Calendar (two-way sync)** — any calendar you've enabled in [Settings → Google Calendar](Google-Calendar). Events created or edited in Kinboard are pushed back to Google; edits made on the Google side flow down at the next sync interval. Subject to Google's per-calendar permissions: a read-only subscribed calendar (holidays, sports schedules, etc.) stays read-only in Kinboard too.
2. **Local events** — added directly in the Kinboard UI without selecting a Google calendar. Lives in `public.events` with no Google link and never round-trips to Google.
3. **Holidays** — Google calendars marked with the "holidays" badge get rendered with the 🎉 indicator and slightly different styling.
4. **Waste-pickup calendars** — Google calendars marked with the "waste pickup" badge are *hidden* from the calendar view and show up only on the waste widget. Avoids cluttering month view with weekly bin reminders.

## Month view

The default. 35-42 cells, one per day in the month. Each day shows:

- The day number (today highlighted with the monthly theme color)
- Up to 3 event chips, color-coded per person
- Holiday indicator if applicable
- Birthday indicator if applicable

Tap a day → day-detail panel slides in showing all events + birthdays + holidays for that date.

## Week view

7-column hourly grid for the active week, like a typical calendar app. Useful for time-bound planning. Time-of-day events show as colored blocks; all-day events float at the top.

## Per-person colors

Each event is color-coded by the person it's assigned to. Assignment happens in three ways:

1. **Whole calendar → one person** — set in [Settings → Google Calendar](Google-Calendar) per calendar
2. **Per-event mapping rule** — `contains "Emma"` / `starts_with "Mama:"` → assign to Emma. Configured in the same settings page.
3. **Manual override** — edit a local event and pick the person directly

If no rule matches, the event is "family-wide" (gray accent).

## Adding an event

The blue "+ New event" button opens a dialog:

- Title (required)
- All-day toggle
- Start + end (date picker)
- Person assignment (or "family")
- **Calendar** — pick any of your Google calendars (event will round-trip to Google) or "Local only" (stays inside Kinboard)
- Notes

Events show up immediately for everyone in the family. If you picked a Google calendar, the event lands on Google within a few seconds and the next sync round-trip cements it. Edits and deletes also propagate.

Tap any existing event → edit dialog with the same fields. Delete via the trash icon — a confirmation dialog guards it, and an "Undo" toast appears afterward to restore the event exactly as it was.

## Day-detail panel

Tapping any day in month view (or any block in week view) opens a side panel with:

- Date + day name
- Holiday card if applicable
- Event list for that day, grouped by all-day → timed → ended
- Birthday cards for anyone celebrating that day
- Add-event quick action

The day panel is the main "interaction" surface — month/week views are glance surfaces.

## Quick patterns

- **"What's on this week"** → tap any day in the current week, then arrow through
- **"Find an event"** → use the search field in the calendar's control row — see [Event search & links](#event-search--links) below
- **"Add a recurring event"** → not directly supported in the local-event editor. Add as a recurring event in Google Calendar and it'll sync in.

## Event search & links

The control row above the month/week grid has a search field: type 2+ characters and it matches against every event's title, location, and description (case-insensitive), searching across your full event history — not just the visible month. Tap a result to jump straight to it.

Every event also has a shareable link that deep-links to its date and opens it directly (`?event=<id>&date=<date>`) — useful for pasting into a family chat ("here's the appointment"). Opening the link jumps the calendar to that date and opens the event dialog automatically; the back button closes the dialog instead of leaving the calendar.

## Publish your calendar (ICS feed)

Settings → **Data & backup** has a **Calendar feed (ICS)** card. Tap **Create feed link** to generate a secret, read-only ICS URL for your family's events, then paste it into Google Calendar ("From URL"), Apple Calendar, or Outlook to subscribe — external calendar apps pull your Kinboard events on their own refresh schedule from there.

The link is a shared secret: anyone who has it can read your family's events (title, time, location), so treat it like a password. If it leaks, tap **Rotate link** on the same card — that invalidates the old URL and issues a new one, and you'll need to re-subscribe every calendar app that was using it.

## Holidays

The holidays widget is country-aware: pick your country in **Settings → Language** (Germany, US, UK, Netherlands, or France; existing families default to Germany). Add a Google Calendar with the "holidays" flag to override or augment further. See [Themes → Locales](Themes#locales) for the country picker.

## Calendar mapping rule editor

Hidden under [Settings → Google Calendar](Google-Calendar). Useful when:

- One shared family calendar, want each person's events colored differently → use rules to auto-assign by title pattern
- Subscribed to a calendar that mixes events for multiple people (school, sports club) → rules split it

Full match-type reference and the **Test** button: see [Google-Calendar → Mapping rules](Google-Calendar#mapping-rules).

## iCalendar (.ics) feeds

Read-only `.ics` feeds shipped in v1.0.19 and live alongside Google Calendar. The two providers can coexist — a typical setup is "Google for the family's main shared calendar (read/write) plus iCloud Family Sharing as an .ics feed for the partner's iPhone calendar (read-only)".

Add a feed at `/settings/ics`:

1. Paste the feed URL. `webcal://` links from iCloud and Google's "secret iCal address" are auto-rewritten to `https://`.
2. Click **Test** — Kinboard fetches the feed and reports the event count + the first event's title so you can sanity-check before saving.
3. Set a name, color, and (optionally) the family member it represents.
4. Click **Sync now** any time to refresh; otherwise the feed re-syncs every 30 minutes via cron. ETag conditional GETs mean a 304 from the upstream is a no-op (no re-parse).

Recurring events are expanded server-side and capped at 200 instances per calendar. The sync window is −30 days to +60 days from "now" so multi-year feeds don't bloat the events table. Events present in a previous fetch but absent from the current one are removed.

ICS sources Kinboard handles cleanly today: iCloud Family Sharing, Google's "secret iCal address", Outlook/Office 365 calendar publishing, most CalDAV providers (via their published `.ics` URL), school district calendars, sports league schedules.

## What's not supported

- **Attendees / invites.** Google events show their attendees in the day panel as read-only text; you can't RSVP or invite people from Kinboard.
- **Editing read-only subscribed Google calendars** — if Google itself marks the calendar as read-only (someone else's calendar shared with you, public holiday calendars, etc.), Kinboard can't write to it either.
- **Writing to ICS feeds.** ICS support is read-only by design — feeds are typically published-only URLs without CalDAV write semantics. Use Google Calendar for editable family events.

## Related

- [Google-Calendar](Google-Calendar) — connect Google + per-event mapping rules
- [Birthdays](Birthdays) — birthdays appear in the calendar; managed separately
- [Themes](Themes) — date formatting per locale + the holiday country picker
- [Self-hosting](Self-hosting#backing-up-your-data) — the JSON export vs. the ICS feed, and when to use each
