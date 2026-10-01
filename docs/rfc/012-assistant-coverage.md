# RFC-012 — Assistants across the rest of Kinboard

| | |
|---|---|
| **Status** | Draft — extends RFC-011 on `feat/mcp-integration-api` (WIP; deployed to the maintainer's household for testing) |
| **Date** | 2026-10-01 |
| **Depends on** | RFC-010, RFC-011, RFC-002 §6 |

## 1. Why

Testing with ChatGPT on the household install showed what assistants still
couldn't do: read a recipe or put its ingredients on the list, set a kitchen
timer, undo a delete, create a repeating task for a child with points, find an
appointment by name, read the school timetable, keep birthdays, book pocket
money, read the house battery, and handle countdowns, screen messages and
alerts. The household asked for all of it on 2026-10-01.

## 2. Scopes (append-only)

| Scope | New | Covers |
|---|---|---|
| `family:read` | — | adds recipes, timers, recycle bin listing, timetable, birthdays, pocket-money balances, countdowns, screen messages, attention items |
| `timers:write` | **new** | start and stop timers on the screens |
| `birthdays:write` | **new** | add, edit, delete birthdays |
| `pocket_money:write` | **new** | request bookings — every booking waits for PIN confirmation |
| `calendar:write` | — | adds countdowns and person assignment on events |
| `tasks:write` | — | adds recurrence, assignee, priority, icon and points on create/edit |
| `shopping:write` | — | adds "put a recipe's ingredients on the list" |
| `announcements:write` | — | adds acknowledging a screen message |
| `energy:read` | — | adds every energy sensor configured in Kinboard (battery, grid, consumption), never arbitrary entities |
| type's own write scope | — | restore from the recycle bin (tasks → tasks:write, notes → notes:write, meal entries → meals:write, birthdays → birthdays:write) |

Attention dismissal keeps RFC-001's `dismiss_attention` and its scope (`tasks:write`).

## 3. Confirmation becomes general

`assistant_action_requests` gains `kind` (`home` | `pocket_money`). Home
columns become nullable with a CHECK that `kind = 'home'` rows still carry them;
a pocket-money request stores `{ person_id, person_name, amount_cents, currency,
type, note }` in `data`. Approval stays exactly as RFC-011 §4.3 (PIN to approve,
anyone can deny, 2-minute expiry, token re-check, limits); execution dispatches
on `kind` (a `{ validate, execute, describe }` handler per kind). Screens
describe the request in words for both kinds — the server sends the words,
in the screen's language. An assistant follows any of its requests at
`GET /actions/{id}` (`home:control` or `pocket_money:write`, its own requests
only); `GET /home/actions/{id}` stays as it was for home requests.

**Every assistant pocket-money booking needs the PIN.** The RFC-001
`add_pocket_money` service is unchanged for Home Assistant tokens (frozen
contract); assistants never reach it — they use the confirmed path.

## 4. Boundaries

- Recipes: the family's own, never binned ones; external recipe search
  (Chefkoch) is not exposed.
- Timers: at most 10 running per family started by assistants, at most 24 h.
- Recycle bin: only types an assistant can delete (tasks, notes, meal entries,
  birthdays); restore only, never purge.
- Timetable: read only; "school on day X" respects school holidays.
- Energy: sensors from Kinboard's energy settings only (RFC-010 §3.6 rule).
- Still never: camera images, presence, vehicle location.

## 5. Fixes found by the survey

- `services/create_task` accepted a `person_id` from another family — now
  validated like the PATCH route.
- `school_tomorrow` in the family summary ignored school holidays.
- Attention items were not dismissable in practice: their keys were never
  exposed — a listing now returns them.
