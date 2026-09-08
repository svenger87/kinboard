# RFC-004 — Timer widget

| | |
|---|---|
| **Status** | Implemented (#249) |
| **Date** | 2026-09-08 |
| **Target release** | unscheduled |
| **Depends on** | the realtime table list, `scheduled_notifications`, the 30s notification processor |
| **Source** | Brainstorm 2026-09-08, from the magicframe.dev competitive review |

---

## 1. What this is for

A kitchen wall panel cannot set a timer. It is the most obviously missing
thing on a screen that hangs where people cook, and it needs no integration,
no account and no protocol — which is why it is first out of the competitive
review's backlog rather than the larger items beside it.

**Checked before writing this.** There is no existing timer feature. The
`countdown` hits in the codebase are the error pages' retry counters and the
birthday countdowns; `setTimeout` and `timerRef` are unrelated. Home Assistant
has a `timer` domain, but `HAEntityDomain` does not list it and this feature
deliberately does not require Home Assistant. (RFC-003 opened by asserting
something similar and was wrong — see its §1. This one was verified.)

### Decisions taken

1. **Timers are shared across the household**, not local to a device. A timer
   started on the panel is visible on every phone, and anyone can stop it.
2. **When one ends: a tone on the panel and a push to phones.** Both, not
   either.
3. **The widget is present when idle.** It is the only place a timer can be
   started from.

---

## 2. Data model

One table, `timers`:

| column | notes |
|---|---|
| `id` | uuid |
| `family_id` | uuid, not null, cascade |
| `label` | text, nullable — "pasta" or nothing |
| `duration_seconds` | int, not null |
| `started_at` | timestamptz, not null, server-set |
| `finished_at` | timestamptz, null until it rings |
| `dismissed_at` | timestamptz, null until acknowledged |
| `created_at` / `updated_at` | timestamps |

It joins the existing realtime table list (`use-realtime.ts`), so every device
converges without new plumbing. It must also be added to `direct_tables` in
`migration_zz_row_level_security.sql` — **that array is hardcoded, and a table
missing from it silently gets no row-level security.** RFC-003's M1 shipped
exactly that mistake and it took a whole-branch review to find; it is written
here so the next table does not repeat it.

`finished_at` and `dismissed_at` are separate deliberately. A timer that has
rung and not been acknowledged is still on screen and still red; collapsing
them into a delete would lose that state and with it the whole point of an
alarm.

---

## 3. The countdown

**Nothing ticks on the server.** Remaining time is
`started_at + duration_seconds − now`, computed in the browser. A device that
joins an hour late does the same arithmetic and agrees; a tab that sleeps and
wakes recomputes rather than drifting; a paused tab costs nothing. This is the
same principle as the media player's progress bar (RFC-003 §2.2): derive from a
timestamp, never poll a counter.

### 3.1 Clock skew is the trap

`started_at` is written by the server; `now` is the browser's. A panel whose
clock is two minutes fast ends its timer two minutes early, and a wall tablet
correcting itself by NTP mid-timer visibly jumps.

So the client measures its offset against a server timestamp once and applies
it to every countdown. Small to do up front, painful to retrofit, and invisible
in testing on a machine whose clock is correct — which is every development
machine.

**No endpoint is needed for this.** Every HTTP response carries a `Date`
header, so the offset comes from a response the app already makes — verified
against this stack: `Date: Tue, 08 Sep 2026 05:41:44 GMT`. A dedicated
`/api/time` would be a round trip bought for nothing.

---

## 4. Alerting

### 4.1 The push reuses what exists

Starting a timer writes one `scheduled_notifications` row with
`scheduled_for = started_at + duration_seconds`. The existing
`process-notifications` job — `@every 30s` in the compose labels — sends it. No
new cron entry, no new sender, no new table.

Thirty seconds of worst-case lateness is acceptable for a phone alert and
irrelevant to the panel, which counts down locally in real time.

**Cancelling a timer must delete its scheduled row.** Otherwise a phone buzzes
for a timer that no longer exists. This is part of cancelling, not a separate
concern: it works in testing and embarrasses you the first time somebody
actually cancels something.

The handle already exists — `scheduled_notifications` carries
`related_entity_type` and `related_entity_id`, so a timer's row is written with
`('timer', <timer id>)` and cancellation deletes on that pair. Nothing new is
needed to find it, which is the difference between this being a one-line delete
and a fragile search by title and time.

### 4.2 The tone is best-effort, and the design says so

Browsers block audio until a page has had a user gesture. A kiosk somebody has
tapped is fine; a panel that booted overnight and sat untouched is not, and
there is no way to force it.

So **the guarantee is the visual alarm** — the widget goes to a finished state
and stays until dismissed — and the sound is an enhancement that may not
happen. An `AudioContext` is unlocked on the first gesture anywhere in the app
and reused, rather than trying to play cold at zero, which gives it the best
chance available.

### 4.3 Only kiosk devices make noise

Kinboard already distinguishes them (`html[data-kiosk]`, `KioskProvider`). A
phone in a pocket should not beep from an open browser tab; its channel is the
push. Without this rule, standing in the kitchen holding your phone means the
timer goes off twice.

Several timers ending together play one tone, not a chord.

---

## 5. The widget

### 5.1 It is present when idle — unlike the media widget

This looks like an inconsistency and is not, so the reasoning belongs in the
code as well as here.

Media has another origin: playback starts on the speaker, the phone, the TV, so
a widget that hides when nothing plays still leaves a normal way to start
something. **A timer has no origin but this screen.** A widget that hides when
idle can never start the thing it exists to show, and "open a page to set a
kitchen timer" is not what anybody does with floury hands.

Resting state: one-tap presets — 3, 5, 10, 15 minutes — and a custom entry, at
the 44px touch targets the accessibility audit settled on. Running: countdown
rings side by side, each with its label. Finished: red, and it stays until
dismissed.

### 5.2 Nothing else

No page, no settings screen, no plugin manifest. Timers are ephemeral; there is
no history worth browsing and nothing to configure. It is a plain dashboard
widget like `notes` and `tasks`, which keeps it far smaller than RFC-003's
plugin.

`WidgetVisibility` gains a `timers` key defaulting **on**. Unlike the media
player it needs no setup to be useful, so defaulting off would mean nobody
finds it.

---

## 6. Failure handling

- A timer whose row disappears mid-count (deleted on another device) simply
  goes; realtime already handles that.
- A device that was asleep when a timer ended shows it finished on wake,
  because the state is derived from timestamps rather than from having
  observed the moment.
- A failed write surfaces as a quiet inline mark, not a modal. Nobody is
  standing at a wall display.

---

## 7. Testing

Pure and testable without a browser:

- remaining-time arithmetic, including the clock-offset correction
- the finished/dismissed state machine
- cancellation deleting the scheduled notification row

Two browser guards, run in Chromium **and** WebKit:

1. **The widget is present when idle.** This is the opposite of the media
   widget's rule and therefore the thing most likely to be "fixed" by someone
   pattern-matching between the two. The test is what stops that.
2. A finished timer stays on screen until dismissed.

Every assertion must be seen to fail before it counts. RFC-003's browser guard
shipped an assertion that could not fail — `getByRole("slider", …)` matching a
name that lives on a wrapping `role="group"` — because the "prove it fails"
step was run against a different assertion in the same test.

---

## 8. Out of scope

- Home Assistant's `timer` domain as a source. This feature must work with no
  integrations; adopting HA timers later is additive.
- Timer history, statistics, or naming presets.
- Per-timer sounds, or choosing the tone.
- Repeating or scheduled timers — that is what the calendar is for.

## 9. Open risks

- **Autoplay may be blocked on a panel nobody has touched**, and no design can
  fix that. The visual alarm is the guarantee; verify the real behaviour on the
  actual wall display rather than on a desktop browser, where a gesture has
  always happened.
- **Clock skew is invisible in development.** Every dev machine has a correct
  clock, so the offset correction will look like dead code until a real panel
  drifts.
