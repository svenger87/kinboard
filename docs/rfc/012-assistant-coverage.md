# RFC-012 — Assistants across the rest of Kinboard

| | |
|---|---|
| **Status** | Implemented — extends RFC-011 on `feat/mcp-integration-api` (unreleased; deployed to the maintainer's household for testing) |
| **Date** | 2026-10-01 |
| **Depends on** | RFC-001, RFC-010, RFC-011, RFC-002 §6 |

## 1. Why

Testing with ChatGPT on the household install showed what assistants still
couldn't do: read a recipe or put its ingredients on the list, set a kitchen
timer, undo a delete, create a repeating task for a child with points, find an
appointment by name, read the school timetable, keep birthdays, book pocket
money, read the house battery, and handle countdowns, screen messages and
alerts. The household asked for all of it on 2026-10-01.

Everything below is an Integration API route (`/api/integration/v1/…`,
documented in `openapi/integration-v1.yaml`) with an MCP tool that calls it in
process, as RFC-010 §3 set out. The tools and permissions are listed for
households on the wiki's AI-Assistants page.

## 2. Scopes (append-only)

| Scope | New | Covers |
|---|---|---|
| `family:read` | — | adds recipes, timers, the recycle bin listing, the school timetable, birthdays, pocket-money balances and goals, countdowns, screen messages and attention items |
| `timers:write` | **new** | start and stop timers |
| `birthdays:write` | **new** | add, edit and delete birthdays; restore a binned one |
| `pocket_money:write` | **new** | *ask* for a booking — every one waits for PIN confirmation (§3) |
| `calendar:write` | — | adds countdowns, and the person an event is for |
| `tasks:write` | — | adds recurrence, assignee, priority, icon and points on create/edit; restore a binned task; dismiss an attention item |
| `shopping:write` | — | adds "put a recipe's ingredients on the list" |
| `notes:write` | — | adds restoring a binned note |
| `meals:write` | — | adds restoring a binned meal entry |
| `announcements:write` | — | adds acknowledging a screen message |
| `energy:read` | — | grows from the two solar sensors to every energy sensor configured in Kinboard (§5.8) |

The consent page's `family:read` label names everything it now reads.

### 2.1 Restoring from the recycle bin

There is no variable-scope restore tool. Each type has its own tool and needs
the scope that edits that type:

| Type | Tool | Scope |
|---|---|---|
| `task` | `restore_task` | `tasks:write` |
| `note` | `restore_note` | `notes:write` |
| `meal` (meal plan entry) | `restore_meal` | `meals:write` |
| `birthday` | `restore_birthday` | `birthdays:write` |

`POST /recycle-bin/{type}/{id}/restore` checks the type's scope; an unknown
type authenticates with `family:read` and answers 404. `GET /recycle-bin`
(`family:read`, optional `type`) lists at most 50 binned items of those four
types, newest first; a meal entry carries a `detail` (recipe title and note)
so two binned dinners on one day can be told apart. Only types an assistant
can delete are listed. Restoring is never a purge, needs no Idempotency-Key
and does not spend the edit/delete budget. An item already restored, binned
in another family, or purged is 404.

## 3. Confirmation becomes general

`assistant_action_requests` gains `kind` (`home` | `pocket_money`). Home
columns become nullable with a CHECK that `kind = 'home'` rows still carry them
and a second CHECK that `pocket_money` rows leave them empty; a pocket-money
request stores `{ person_id, person_name, amount_cents, currency, type, note }`
in `data`. Approval stays exactly as RFC-011 §4.3 (PIN to approve, anyone can
deny, 2-minute expiry, token re-check, limits); execution dispatches on `kind`
(a `{ validate, execute, describe }` handler per kind; an unknown kind ends
`failed` / `not_available` and runs nothing). Screens describe the request in
words for both kinds — the server sends the words, in the screen's language.
An assistant follows any of its requests at `GET /actions/{id}`
(`home:control` or `pocket_money:write`, its own requests only);
`GET /home/actions/{id}` stays as it was, for home requests only.

The pending-request limits are shared across kinds: at most 2 waiting and 5
created per 10 minutes per assistant connection.

### 3.1 Pocket money

**Every assistant pocket-money booking needs the PIN.**
`POST /pocket-money/bookings` (`pocket_money:write`, Idempotency-Key) takes
`{ person_id, amount, type: deposit | withdrawal, note? }`, with an amount
from 0.01 to 500 and at most two decimals. It checks, in this order, and
stores and pushes nothing after a refusal: the body; the person (404 for a
missing, binned or foreign person or a child with no account, 400
`not_a_child`); a withdrawal larger than the current balance (400
`insufficient_funds`); that the family has a PIN; the confirmation limits.
Then it answers 202 `pending_confirmation`. The note is stripped of invisible
and bidirectional-control characters and shown in quotes.

**`add_pocket_money` refuses assistant tokens.** RFC-001's `add_pocket_money`
service is unchanged for hand-made (Home Assistant) tokens — frozen contract —
but an OAuth-issued token gets 403 `forbidden` before anything is read;
otherwise an assistant holding `tasks:write` could book with no PIN. The
deciding fact is how the token was made, not the program presenting it. An
amount that rounds to 0 cents is now that service's existing 400.

**Every balance change is atomic.** The session route, the service, an
approved assistant request, an approved withdrawal request, the allowance
cron and the interest crons all go through SQL functions (SECURITY INVOKER,
`service_role` only):

- `book_pocket_money()` moves the balance with one conditional
  `UPDATE … WHERE balance_cents + delta >= 0` and writes the transaction in
  the same call, so concurrent bookings never overwrite each other and a
  withdrawal cannot take a balance below zero. It refuses a sign that
  contradicts the type, a goal not on that account and a person outside the
  family.
- `pay_pocket_money_allowance()` claims the allowance period
  (`last_allowance_at` compare-and-set) and books in the same call, so two
  cron runs pay a period once.
- `accrue_pocket_money_interest()` / `commit_pocket_money_interest()` accrue
  at most once a day and commit the pending interest under the row lock, so
  the same interest is never paid twice.
- `decide_pocket_money_withdrawal()` locks the request (`FOR UPDATE`), so a
  second approval answers `already_decided` and books nothing; a withdrawal
  that no longer fits is denied under the same lock.

An approved assistant request whose withdrawal no longer fits ends `failed`
with `reason: insufficient_funds`; the family is told so in words that do not
mention Home Assistant. Creating a child's withdrawal request refuses a
`related_goal_id` that is not a live goal of that account (400).

### 3.2 Upgrading a live install

Two steps for self-hosters, after the migrations have run:

- **Restart the realtime container** (`docker compose restart realtime`).
  `migration_zzzzz_action_request_kind.sql` adds `kind` to a table realtime
  already streams; a realtime that was running across the migration keeps
  the old row shape until it restarts.
- **Reload every household screen, or let it sit idle, before the first
  pocket-money request.** A screen still running the previous build words a
  confirmation from `entity_name`, `domain` and `service`, which a
  `pocket_money` row leaves empty: it would show a generic line with no
  amount and no child, yet still offer the PIN field. The screens take the
  new build on their own once idle (`pwa-provider.tsx`), and a request
  expires after two minutes, so the window is short — but what is approved
  must be what was read (RFC-011). Do this before connecting an assistant
  with `pocket_money:write`, or before its first booking request.

## 4. Boundaries

- Recipes: the family's own, never binned ones; external recipe search
  (Chefkoch) is not exposed. Recipe text is data, never instructions.
- Timers: an assistant's token (OAuth) is refused a new timer with 429
  `too_many_timers` while the family has 10 timers not dismissed (running
  or ringing), whoever started them — the Integration API cannot tell an
  assistant's timer from a person's without a migration. A timer that has
  rung for more than an hour without anyone dismissing it no longer counts,
  so a household with no screen showing the timers card is not locked out.
  A hand-made token (Home Assistant) is not capped, as the panel is not. At
  most 24 h each.
- Recycle bin: only types an assistant can delete (tasks, notes, meal
  entries, birthdays); restore only, never purge (§2.1).
- Timetable: read only; "school on day X" respects school holidays.
- Energy: sensors from Kinboard's energy settings only (RFC-010 §3.6 rule).
- Attention: hints built from Home Assistant are redacted without `home:read`
  (§5.10).
- Still never: camera images, presence, vehicle location.

## 5. What each area does

### 5.1 Recipes
`GET /recipes` (title or tag, favourites first), `GET /recipes/{id}` and
`POST /recipes/{id}/shopping` (`shopping:write`, Idempotency-Key). The
shopping call adds all ingredients or the `ingredient_ids` picked, scaled to
`servings`, exactly as the recipe page does, and pushes to Bring! when sync
is on (a Bring! or catalogue failure never fails the add). An ingredient id
not in the recipe is a 400 with nothing added; a foreign or binned recipe is
404; the same key with another body is 409.

### 5.2 Timers
`GET /timers`, `POST /timers` (Idempotency-Key, `duration_seconds` 1–86400,
label ≤ 60 after trimming), `DELETE /timers/{id}` (an already dismissed timer
is 404, so a retried stop never moves the dismissal time).

### 5.3 Tasks
`POST /lists/tasks` and `PATCH /lists/tasks/{id}` accept `person_id`,
`recurrence` (`once`, `daily`, `weekly`, `biweekly`, `monthly`, `days:MO,WE…`),
`priority`, `icon` and `points`. Points are awarded only for a child's task.
`PATCH` on the shopping list refuses every task-only field with 400.
`services/create_task` only gained the family check on `person_id`; its other
fields stay as RFC-001 froze them (Home Assistant sends a numeric priority).

### 5.4 Calendar
`GET /calendar/events?query=` searches title, location and description as a
literal, case-insensitive substring (every punctuation character escaped),
from today to a year ahead unless a range is given, at most 100.
`POST`/`PATCH` take `person_id` (family-checked); it is written through to
Google as the event's private `person_id` property. Google sync now accepts
that property only when it names a live person of the same family.

### 5.5 Timetable
`GET /schedule` (optional `person_id`, `day`): the weekly timetable, or for a
day whether there is school and, if not, whether it is a holiday or the
weekend. School holidays come from Settings and from calendars marked as
holidays; a holiday calendar's last day counts (the reader takes the local
day of the last instant before `end_at`). The family summary's
`school_tomorrow` uses the same reader, in the family's time zone.

### 5.6 Birthdays
`GET /birthdays`, `POST` (Idempotency-Key), `PATCH`/`DELETE /birthdays/{id}`.
A date is `YYYY-MM-DD` or `--MM-DD` when the year is unknown (stored as the
current year, as the Birthdays page does). Because the app reads a stored
current year as "unknown", **a full date in the current year is refused** with
a 400 that names the matching `--MM-DD`, and **a future year is refused**;
accepted birth years are 1900 to last year. `--02-29` is refused in a
non-leap year. Delete goes to the recycle bin.

### 5.7 Pocket money
`GET /pocket-money`: each child's balance, lifetime savings, allowance and
goals. Bookings: §3.1.

### 5.8 Energy
`GET /energy/current` (`energy:read`) reads every `sensor.*` id configured in
Kinboard's energy settings — 9 power readings, 6 energy-today readings and the
battery charge — from one Home Assistant `GET /api/states`, filtered to those
ids. Grouped readings are `{ value, unit, observed_at }`; `solar_power` and
`solar_energy_today` keep their original fields (with `entity_id`) for
existing clients. `get_solar_production` returns only those two keys.

Energy today (`energy_today` and `solar_energy_today`) is
`{ value, unit, observed_at, total, reason }`. **Today = the change since
local midnight in the family's time zone, from Home Assistant's statistics**
— one request for the configured energy-today ids, through the same code
path as the energy screens (`lib/home/ha-statistics.ts`). **`total` is the
counter's raw state.** The raw state is never `value`: households commonly
configure lifetime `total_increasing` counters there (the HA energy-dashboard
convention), and an assistant once read a 1,636 kWh lifetime total out as
today's yield. With no statistics for a sensor `value` is null with
`reason: "no_statistics"`; if the statistics request fails, null with
`"statistics_unavailable"`, and the power readings still come back.

Compatibility changes, both deliberate:

- **200 with null.** A configured sensor that Home Assistant does not report
  is `null` in an otherwise normal 200. It used to make the whole call 502.
  An entity reporting `unavailable` or a non-number is
  `{ value: null, unit, observed_at }`.
- **404 means "nothing to read".** 404 `not_found` when Home Assistant is not
  set up, its address is unusable, or **no** energy sensor is configured. It
  used to mean "no solar sensor", so a household with only a battery now
  gets a 200.
- 502 `upstream_unavailable` when Home Assistant cannot be reached, answers
  with an error, or sends something unusable or larger than 16 MiB (now the
  single cap for every `/api/states` read).

### 5.9 Countdowns and messages
Countdowns live in the widget's settings row; `POST /countdowns`
(`calendar:write`, Idempotency-Key) and `DELETE /countdowns/{id}` (permanent)
write it with an `updated_at` compare-and-set and up to three retries, so two
API writers never drop each other's change (a screen saving a stale list
still can). `GET /messages` lists the 20 newest screen messages;
`POST /messages/{id}/acknowledge` (`announcements:write`) acknowledges one,
first acknowledgement wins, and does not spend the edit/delete budget.

### 5.10 Attention
`GET /attention` (`family:read`) lists the active hints in the family's
language (en when unset). **Without `home:read`**, a hint from a rule marked
sensitive (today: doors and windows still open at bedtime) — or from a rule
this build doesn't know — keeps its `item_key`, `rule_id` and priority, but
its title is rendered from numeric parameters only ("2 still open") and
`detail` is null, so no entity id or device name reaches a `family:read`
token. Dismissal goes through RFC-001's `dismiss_attention` service
(`tasks:write`), called in process. Like acknowledging a message it is not
destructive and takes nothing from the edit/delete budget: the hint stays
off while the situation lasts and comes back if it arises again.

## 6. Fixes found by the survey

- `services/create_task` accepted a `person_id` from another family — now
  validated like the PATCH route.
- Google sync trusted the `person_id` property on a Google event, which could
  name another family's person — now only a live person of the same family.
- `add_pocket_money` let an assistant token book with no PIN — now 403 for
  OAuth-issued tokens.
- Pocket money: allowance, interest, withdrawal approval and bookings each
  read then wrote the balance, so concurrent ones could lose or double-book
  money — now atomic (§3.1).
- A holiday calendar's last day was treated as a school day, and one-day
  holidays were ignored.
- `school_tomorrow` in the family summary ignored school holidays.
- Attention items were not dismissable in practice: their keys were never
  exposed — a listing now returns them.
