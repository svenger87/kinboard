# RFC-005 — Messages to the screen

| | |
|---|---|
| **Status** | Draft |
| **Date** | 2026-09-08 |
| **Target release** | unscheduled |
| **Depends on** | `push_subscriptions.device_id`, `src/lib/push-sender.ts`, the realtime table list, the screensaver provider |
| **Source** | Brainstorm 2026-09-08, from the magicframe.dev competitive review |

---

## 1. What this is for

Say something to the house. You are on the train, you type "back by 6", and the
kitchen panel says so — loudly enough that somebody standing in the kitchen
sees it without going looking, and it stays until one of them says they have.

**Checked before writing this.** Kinboard already has Notes: a `notes` table
with `content`, `pinned`, `person_id` and a soft-delete column, a widget on the
dashboard, a page at `/notes`, and realtime. You can already type something on a
phone and watch it appear on the board. So this feature only earns a table of
its own if the difference is structural, not decorative. (RFC-003 opened by
asserting a gap that turned out not to exist. This one was read first.)

The difference is the lifecycle. A note is a document: it is written, it sits in
a list, somebody eventually deletes it, and nothing anywhere records whether a
human ever read it. A message is an event: it interrupts, it is delivered
everywhere at once, and it is finished when somebody says they have seen it.
Those are different columns, different queries and a different screen. Bolting
`urgent` and `acknowledged_at` onto `notes` would put pinning, soft-deletion,
attribution and acknowledgement in one row, and force the notes list to decide
whether an urgent note appears twice or not at all.

### Decisions taken

- **Broadcast to every device except the one that sent it.** The sender knows
  what they typed. A phone that buzzes at you about your own message is the
  first thing anyone would complain about.
- **First acknowledgement clears it everywhere.** One household, one "somebody
  saw this". Per-device acknowledgement was considered and rejected: on a wall
  panel nobody dismisses anything, so the message would sit on it forever while
  the sender waited for a tick that never came.
- **Big briefly, then small until acknowledged.** It takes the board for a
  minute, then collapses into a row and waits. Expiring on its own was rejected
  — a message nobody was in the room for would be lost silently, which undoes
  the reason for acknowledging at all.
- **The push is sent immediately, not queued.** Every other notification in
  Kinboard is a row in `scheduled_notifications` picked up by a processor that
  runs every 30 seconds. For a reminder that is fine. For someone typing "back
  by 6" it is not.
- **The notification opens the message.** Tapping it deep-links to the message
  itself, not to the dashboard in general.
- **Not routed through the attention engine.** That engine's stated property is
  that the same data always produces the same hints, which is what makes its
  "Why?" button honest. A human-authored sentence is derived from nothing, and
  its explanation would have nothing true to say.

---

## 2. Data model

```sql
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 200),
  sender_device_id UUID REFERENCES public.devices(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by_device_id UUID REFERENCES public.devices(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX messages_family_id_acknowledged_idx
  ON public.messages (family_id, acknowledged_at, created_at DESC);
```

**The sender is a device, not a person.** The delivery rule is "every screen but
the one that sent it", and a device is what the client actually knows about
itself — `useFamilyStore().device`. Kinboard has no per-person login, so a
person id here would be a guess about who was holding the phone.

`ON DELETE SET NULL` on both device references: removing a device from Settings
must not delete the household's messages, and a message whose sender has since
been removed is still a message. A null `sender_device_id` means every screen
shows it, which is the correct failure — better than hiding it from everyone.

**Two things that are easy to forget and silently break the feature:**

- `'messages'` must be added to the hardcoded `direct_tables` array in
  `webapp/docker/migration_zz_row_level_security.sql`. A table missing from that
  array gets **no policy at all** — not a restrictive one, none — and the anon
  key can read every family's rows.
- The migration must run `ALTER PUBLICATION supabase_realtime ADD TABLE
  public.messages`, idempotently, in the pattern
  `migration_birthday_gift_ideas.sql` uses. A subscription to an unpublished
  table is not an error: the channel opens, the handler registers, and nothing
  ever arrives. That is exactly how `timers` shipped, working only on the one
  machine where somebody had run the `ALTER` by hand.
  `e2e/realtime-publication.spec.ts` now fails when a subscribed table is not
  published, so this one is caught rather than trusted.

**No soft delete.** A message is not a document, and its end is acknowledgement,
not deletion. It does not belong in the recycle bin.

---

## 3. Delivery

### 3.1 Everyone but the sender, in two different places

The exclusion happens twice, for two different reasons, and conflating them
would break one of them.

**On screen**, the realtime change reaches every subscribed client including the
sender's, and the client decides: if `sender_device_id === device.id`, do not
raise the takeover. Filtering server-side is impossible here — realtime
broadcasts one change to one channel, not a message per recipient.

**In push**, the exclusion is a query: send to every active subscription for the
family where `device_id <> sender_device_id`. `push_subscriptions.device_id`
already exists, so this is a `.neq()`, not a schema change.

**The sender comes from the session, not the request body.** `SessionContext`
already carries `deviceId` alongside `familyId`, so the route reads it from
there. Taking it from the body would let a caller name somebody else's device as
the sender and silently exclude that person from every message. On an older
session where `deviceId` is null there is nothing to exclude, so the push goes
to the whole family — including, harmlessly, the sender.

### 3.2 Sent immediately

`sendPushToMultiple` in `src/lib/push-sender.ts` already takes a list of
subscriptions and a payload, so `POST /api/messages` calls it directly rather
than writing a `scheduled_notifications` row. Nothing new is built for this.

A push failure must not fail the message. The row is already written and every
screen in the house has it over realtime; the phones are the part that can be
lost. Log it and return 200 — the same rule the timer's queued push follows.

If VAPID is not configured at all (`isVapidConfigured()` is false), there is
nothing to send and that is not an error either. A household that has never set
up push still gets messages on its screens.

**Quiet hours do not apply.** Every other push in Kinboard is a reminder the
system decided to raise, and silencing those between 22:00 and 07:00 is right. A
message is a person deciding, at that moment, to tell the house something — and
the messages that get sent at 23:00 are the ones that matter most. The route
does not read `notification_preferences` at all; there is no per-type switch for
this and quiet hours are not consulted. A household that finds this wrong can
turn the widget off, which turns the feature off (§6).

### 3.3 The notification opens the message

The payload carries `url: "/?message=<id>"`. `public/sw.js:332` already reads
`event.notification.data?.url` and navigates an existing window there, or opens
one — **no service-worker change is needed**, which is worth stating because it
looks like it would need one.

Arriving at the dashboard with `?message=<id>` raises that message's takeover
even if its minute has passed, and even if it has since been acknowledged — the
person tapped a notification about it, and showing them the dashboard with no
explanation would be worse than showing them a message somebody already handled.
An acknowledged message opened this way says who acknowledged it and offers only
"Close".

---

## 4. On screen

### 4.1 Two states

**Takeover**, for the first 60 seconds after `created_at`: a full-width panel
above the widget grid, at the top of the dashboard, in the largest type the
board uses for text. Not a modal — nothing is blocked, nothing needs
dismissing to use the rest of the board.

**Waiting**, after that and until acknowledged: one row in the messages widget,
with the same "Got it" button.

The 60 seconds is a property of the message and its clock, not of the component
— a screen that renders it at second 55 shows five seconds of takeover, and a
screen that loads at second 90 shows the row. That falls out of computing it
from `created_at` rather than from a mount-time timer.

It is a fixed constant, not a setting. A household that wants a different
takeover length has not told us anything yet, and a settings row costs more to
maintain than the constant it replaces.

### 4.2 The screensaver must not cover it

The default screensaver timeout is 120 seconds and it renders full-bleed at
`z-[100]`. A message that arrives while the board is idle — which is most of
them, since the point is that nobody is standing there — would otherwise be
delivered underneath a photo slideshow. This is not hypothetical: every timer
preset is longer than 120 seconds, and the alarm rang behind the screensaver
until the whole-branch review caught it.

The same fix applies: a hook reporting "a message is demanding attention" folded
into `showScreensaver` in `src/app/providers.tsx`, and the screensaver returns
by itself once the message is acknowledged or its minute is up.

### 4.3 The board's own clock cannot be trusted

`created_at` comes from the server and "is it still within the first minute"
would otherwise be answered by the browser. A panel whose clock is two minutes
fast would never take over at all. Use `useServerClockOffset()` — the shared
measurement added for timers — rather than a second opinion. The timer feature
had exactly this bug between two of its own components: the widget corrected for
skew and the screensaver hook did not, so on a skewed panel the alarm rendered
underneath the screensaver it was meant to hold off.

### 4.4 A message does not fight the other things on the board

A ringing timer is a row inside its own widget, and the attention panel is a
section of the grid. The message takeover sits above both. Nothing is exclusive
except the screensaver, so no precedence rule is needed and none is defined —
inventing one would be inventing a conflict.

---

## 5. Acknowledgement

`PATCH /api/messages/[id]` sets `acknowledged_at` and
`acknowledged_by_device_id` — the latter from the session's `deviceId`, for the
same reason the sender is (§3.1) — guarded with `.is("acknowledged_at", null)`
so the first write wins. Two people tapping "Got it" on two panels within the same
second is a normal thing to happen in a house, and the second tap must not
overwrite who actually saw it first. The route returns the row either way; the
second tapper sees the same acknowledged message, not an error.

The realtime change clears it from every screen, including the takeover.

**The sender is told.** Their screen never raised the message, but it does show
that it was acknowledged, and by which device if the row still has one — a small
line, not an interruption. Without this the acknowledgement is invisible to the
one person who wanted it.

**What the sender's own screen shows meanwhile.** The message appears in their
messages widget in a muted "waiting" state, with no "Got it" — acknowledging
your own message would mean the feature could be satisfied without anybody in
the house having seen anything.

What the sender does get is **"Withdraw"**: never mind, I am not late after all.
It writes the same two columns, so the row is finished the same way and clears
from every screen the same way; only the wording differs, and the sender's own
device is recorded as the one that ended it. This is also the answer for a
household whose only device sent the message — without it, that row would wait
forever with no button anywhere that could end it.

---

## 6. Composing

A "Say something" button in the messages widget, opening a dialog with a single
text field and a send button. The same widget on a phone is the same control —
there is no separate phone UI, because there is no separate phone app.

The 200-character limit is enforced in the database (`CHECK`), in the route, and
as a counter in the dialog. It is a wall display: a message that needs
scrolling is a note, and `/notes` already exists for those.

Sending a message from a household's only device delivers it nowhere. The row is
still created and the sender still sees it in the widget as unacknowledged
(endable with "Withdraw", §5), but nothing pushes and no other screen lights up.
This is stated rather than prevented — a one-device family will work out that
the feature is not for them faster than any warning could explain it.

**The widget switch is the feature switch.** `messages` gets a key in
`WidgetVisibility`, defaulted **on**, and — this is the part that gets forgotten
— a row in the hand-maintained `WIDGET_CONFIGS` array in
`src/app/settings/widgets/page.tsx`. A visibility key missing from that array
has no switch anywhere in the interface, which is exactly what happened to the
timer widget and had to be caught in review.

A screen with the widget switched off gets **no takeover either**. The takeover
is not a separate feature that happens to live near the widget; switching
messages off on a screen means that screen is not one of the ones being talked
to. Note that the toggle is a per-family setting, not per-device, so this turns
the feature off for the household rather than for one panel.

The stored visibility blob of an existing installation has no `messages` key, so
the dashboard must merge it over `DEFAULT_WIDGET_VISIBILITY` rather than reading
it verbatim — otherwise "defaulted on" applies only to families created after
this ships. That merge landed with the timer work, so this is a note to keep it,
not a change to make.

---

## 7. Failure handling

| What fails | What happens |
|---|---|
| Push send throws or VAPID is unconfigured | Logged; the message is still created and still on every screen. `POST` returns 200. |
| A realtime change is dropped | The messages query polls as a backstop — 10s while an unacknowledged message exists, 30s otherwise. The realtime channel already carries ~22 tables and its server drops messages once a channel exceeds its per-second budget (`MessagePerSecondRateLimitReached`, observed under two boards driving each other). |
| Two acknowledgements race | First write wins via `.is("acknowledged_at", null)`; the second sees the acknowledged row. |
| The sending device is deleted afterwards | `sender_device_id` becomes null and every screen shows the message. Better than hiding it from all of them. |
| The board's clock is skewed | The takeover window is computed against the measured server offset, so it is right on a panel whose own clock is not. |

---

## 8. Testing

**Pure.** The takeover window — given `created_at`, a server-corrected now, and
an acknowledgement state, which of takeover / waiting / gone applies. Boundary
cases at exactly 60 seconds, and an acknowledged message inside its minute.

**Browser, two contexts.** This is the one guard that cannot be written with a
single page, and it is the whole feature:

1. Send a message from context A. It must appear on context B and **not** on A.
2. Acknowledge it on B. It must clear on both.
3. Open A at `/?message=<id>` for an acknowledged message: it says who
   acknowledged it rather than showing a "Got it" button.

**Every assertion proven to fail.** Not one representative of them. On this
project a browser guard shipped whose "prove it fails" step exercised a
different assertion in the same test, and the assertion that mattered turned out
to be incapable of failing. Sabotage has to reach the code under test: a
time-based sabotage of a component that stops re-rendering never fires, and one
placed inside a kiosk-only branch never runs off a kiosk — both happened while
testing timers, and both looked green.

**The publication guard** (`e2e/realtime-publication.spec.ts`) covers the
`ALTER PUBLICATION` for free, provided `messages` is added to `ALL_TABLES`.

---

## 9. Out of scope

- **Addressed to a person.** "Lisa — dentist at 4" routed to Lisa's phone and
  highlighted for her. It needs a notion of which device belongs to whom that
  Kinboard does not have.
- **Spoken aloud.** TTS or a chime on arrival. The tone work for timers showed
  how little a browser will promise about making noise, and a message read aloud
  to an empty kitchen is worth less than one that waits.
- **Replies, threads, history.** There is no message list page and no
  conversation. A message is finished when it is acknowledged.
- **Images, drawings, emoji stickers.**
- **Recycle bin.** Deliberately, per §2.

---

## 10. Open risks

- **The realtime channel budget.** This adds a 23rd table to a channel that
  already drops messages under load. The polling backstop covers correctness,
  not latency, and a message arriving 10 seconds late is a worse failure here
  than for any other table on that channel. Worth measuring after this ships,
  and worth splitting the channel if it bites.
- **Push latency is not ours.** "Immediately" means we hand it to the push
  service immediately. What a phone does with it — Doze on Android, delivery
  batching on iOS — is outside Kinboard, and a household that expects an instant
  buzz may not get one.
- **Nobody acknowledges.** A message that sits waiting forever becomes the
  fridge magnet nobody looks at any more. There is deliberately no expiry in
  this release; if unacknowledged messages pile up in practice, that is data
  worth having before choosing a rule for them.
