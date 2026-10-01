# RFC-011 — Assistants that act: editing family data and controlling the home

| | |
|---|---|
| **Status** | Draft — extends RFC-010 on `feat/mcp-integration-api` (WIP, unreleased) |
| **Date** | 2026-10-01 |
| **Depends on** | RFC-001 (Integration API), RFC-002 (Bridge threat model), RFC-006 (device catalogue), RFC-008 (dangerous HA actions), RFC-010 (built-in MCP) |
| **Supersedes** | RFC-010 §3.6 "tool set unchanged" and §4 "no actuation"; RFC-001 §8 "no write access to anything not named in §5.2" for the routes named here |

---

## 1. What changes

RFC-010 let an assistant read the family's day and add things. Households asked
for the rest: tick off a task, fix a typo on the shopping list, move or cancel
an appointment, plan dinner, put a message on the kitchen screen, and turn the
lights off. This RFC adds those, with one boundary the household decided
explicitly on 2026-10-01:

> Home Assistant control is limited to devices in Kinboard's **device
> catalogue**. Locks, alarm panels, garage doors and the other dangerous
> actions run only after someone **confirms on a Kinboard screen or phone with
> the settings PIN**.

Everything else stays as RFC-010 built it: the Integration API is the only
implementation, MCP tools call it in process, and every permission is a scope
the family ticks on the consent page.

## 2. Scopes

Write scopes cover create, edit and delete of their own kind — the rule the
`/lists/{list}/{item}` routes already follow for shopping and tasks.

| Scope | New? | Covers |
|---|---|---|
| `family:read` | — | everything readable today, plus people and the meal plan |
| `tasks:write` | — | create, complete, edit, delete tasks |
| `shopping:write` | — | add, check/uncheck, rename, delete items |
| `calendar:write` | — (unreleased) | create, edit, delete events, with Google/CalDAV write-through |
| `notes:write` | — | create, edit, delete notes (**broadens** an existing scope; see §8) |
| `meals:write` | **new** | add and remove meal-plan entries (there is no edit; change a meal by removing it and adding another) |
| `announcements:write` | — (unused until now) | send a message to the family's screens |
| `home:read` | **new** | list catalogue devices and their current state |
| `home:control` | **new** | run allowed actions on catalogue devices |
| `vehicles:read` | **new** | read the cars' charge level, range and charging status from Home Assistant; never a location (RFC-002) |
| `timers:write` | **new** | start and stop timers on the screens |
| `birthdays:write` | **new** | add, edit, delete birthdays |
| `pocket_money:write` | **new** | request pocket-money bookings; every booking waits for PIN confirmation |

`home:control` never implies `home:read`, consistent with RFC-001 §4.

## 3. Tools

| Tool | Scope | Notes |
|---|---|---|
| `list_people` | family:read | names and ids, so tasks can be assigned |
| `complete_task` | tasks:write | recurring tasks: done for today, in the family's time zone; a chore with points awards them (§8) |
| `reopen_task` | tasks:write | one-off tasks only (the UI has no "undo" for a recurring day) |
| `update_task` | tasks:write | title, due date, assignee |
| `delete_task` | tasks:write | to the recycle bin (soft delete), never a purge |
| `check_shopping_item` / `uncheck_shopping_item` | shopping:write | |
| `rename_shopping_item` | shopping:write | |
| `delete_shopping_item` | shopping:write | hard delete (shopping has no recycle bin) |
| `update_calendar_event` | calendar:write | title, time, all-day dates, location, description; written through |
| `delete_calendar_event` | calendar:write | provider first, then local, like the browser |
| `update_note` / `delete_note` | notes:write | delete goes to the recycle bin |
| `get_meal_plan` | family:read | date range ≤ 31 days |
| `add_meal` / `remove_meal` | meals:write | free-text meal or a recipe id, per date and meal type. Named `add_meal`, not `set_meal`: "set" would imply replacing a slot's existing entries, which deletes silently |
| `send_message` | announcements:write | ≤ 200 characters, shown on screens and pushed to phones |
| `list_home_devices` | home:read | catalogue devices with room, state and the actions allowed for each |
| `get_device_state` | home:read | one catalogue device |
| `control_device` | home:control | allowed action → runs; sensitive action → waits for confirmation |
| `get_action_status` | home:control | outcome of a pending sensitive action |
| `list_vehicles` | vehicles:read | charge level, range, charging status; device trackers and home/driving state are never read |

## 4. Home Assistant boundary

1. **Catalogue only.** The entity must be a `catalogue_items` row of the
   token's family with `kind = 'ha_entity'`. Anything else is "not found" —
   the assistant cannot learn which entities exist outside the catalogue.
2. **Per-domain service allowlist.** Only these run; everything else is refused:

   | Domain | Services | Sensitive |
   |---|---|---|
   | light | turn_on (brightness_pct, color_temp_kelvin, rgb_color), turn_off, toggle | |
   | switch | turn_on, turn_off, toggle | **unless `device_class` is outlet** |
   | input_boolean | turn_on, turn_off, toggle | **always** (a helper toggle can drive any automation) |
   | fan | turn_on, turn_off, toggle, set_percentage | |
   | climate | set_temperature, set_hvac_mode, turn_on, turn_off | |
   | media_player | media_play, media_pause, media_stop, media_next_track, media_previous_track, volume_set, volume_mute, turn_on, turn_off, select_source | |
   | cover | open_cover, close_cover, stop_cover, set_cover_position | **unless `device_class` is awning, blind, curtain, damper, shade or shutter** |
   | scene | turn_on | **always** (a scene can unlock, disarm or open) |
   | vacuum | start, pause, return_to_base | |
   | humidifier | turn_on, turn_off, set_humidity | |
   | lock | lock, unlock, open | **always** |
   | alarm_control_panel | alarm_arm_home, alarm_arm_away, alarm_arm_night, alarm_disarm | **always** |
   | script | turn_on | **always** (a script can do anything) |
   | button, input_button | press | **always** (RFC-008) |
   | siren | turn_on, turn_off | **always** |
   | lawn_mower | start_mowing, dock, pause | **always** |

   `homeassistant.*`, `automation.*`, `update.*`, `shell_command.*` and every
   other domain are never callable. `device_class` is read live from Home
   Assistant at call time, never trusted from the caller. A cover with any
   other device class, or none, asks first — garage openers often report
   `door` or nothing; a household can mark an unclassified blind with
   "Show as" in Home Assistant. A switch is sensitive for the same reason —
   it can be a garage relay, a door opener or an alarm — unless Home
   Assistant reports it as an `outlet`. "Show as" covers both cases there
   too: a switch shown as an outlet keeps its entity and gets that device
   class; a switch shown as a light becomes a new `light.*` entity (Home
   Assistant's "Switch as X"), which the household adds to the catalogue in
   place of the switch, and it no longer asks. Scenes and helper toggles
   (`input_boolean`) always ask: what they do is decided in Home Assistant,
   not visible from the entity. `set_temperature` accepts 5 to 30, which
   assumes °C; households running Home Assistant in °F are a known limitation.
3. **Confirmation for sensitive actions.** `control_device` stores a pending
   request (expires after **2 minutes**) and returns `pending_confirmation`
   with an id, unless the family has no settings PIN — then nothing is
   stored and the error says a PIN is needed, since nobody could approve it
   anyway. Otherwise the prompt is mounted globally, on every authenticated
   page of a joined device (not only the dashboard) and over the
   screensaver, so a screen on another page does not miss a request inside
   the 2-minute window; every phone with push enabled also gets a
   notification that opens it. **Approving** needs the **settings PIN**
   (same rate-limited check as everywhere). **Denying** needs no PIN —
   refusing is always safe, and anyone at a screen must be able to stop an
   unexpected unlock. Approval re-checks that the assistant is still
   connected, that the entity is still in the family's catalogue, and that
   the stored action is still allowed by the policy (§4.2) before running
   anything; only then does the server run the action exactly as stored and
   record the result. If a screen has meanwhile reported a slow approval as
   "outcome unknown", Home Assistant's real answer replaces that report. The
   screen that approved keeps the outcome — done, didn't work, or unknown and
   "check the device" — on screen until someone closes it, and the
   screensaver stays off while it does. Expiry or a revoked assistant also end a
   request without running anything. The assistant learns the outcome with
   `get_action_status`.
4. **Fail closed.** No Home Assistant configured, catalogue unreadable, state
   unreadable (for the garage check), PIN unreadable → refused, never "assumed
   safe".

## 5. Data model

`assistant_action_requests` (published to realtime, REVOKEd like the other
assistant tables, readable to the family's screens through a session route):
`id, family_id, token_id, client_name, entity_id, entity_name, domain, service,
data jsonb, status (pending|approved|denied|expired|failed|done), created_at,
expires_at, decided_at, decided_by_device_id, result jsonb`.

`messages.sender_label` (nullable text, at most 100 characters): the
assistant connection's name, cut to 40 characters, on a message sent with
`send_message`; null for a message a person typed. Screens show "via
<name>" under an assistant's message.

No other schema changes: tasks, notes and meal-plan entries already
soft-delete; events and shopping items do not, by earlier design.

## 6. Fixes the survey found on the way

- `PATCH`/`DELETE /lists/tasks/{item}` treat a recurring task as one-off and
  can edit or purge binned rows. Both are fixed: recurring completion writes
  `last_completed_day` in the family's time zone, and binned rows are invisible.
- `/api/google/events` `PATCH` and `DELETE` look the event up by id with **no
  family check** (present on `main`). Fixed on `main` in PR #302, not on this
  branch — this branch picks the fix up once it is rebased onto `main`.
- The session route `/api/homeassistant/services` validates neither domain nor
  service. Out of scope here (it serves the household's own screens), noted.

## 7. Threat notes (amends RFC-010 §4)

- Actuation now exists, inside a local allowlist the household builds on its
  own screen (the catalogue), with a second, physical-presence-style gate (PIN
  on a household device) for actions that open the house. Widening the allowlist
  remains a local act (RFC-002 §6).
- Prompt injection: note text, event titles and shopping items are attacker-
  reachable content in the model's context. The worst an injected instruction
  can do without a human is non-sensitive device control, and edits and
  deletes — not all of which can be undone:
  - **Edits overwrite without history.** A changed task title, note text or
    event time is not kept anywhere; for a calendar event the change is also
    written through to Google or CalDAV.
  - **Deletes:** tasks, notes and meal entries go to the recycle bin and can
    be restored. Shopping items are deleted outright (the list has no
    recycle bin), and so are calendar events — including from Google or
    CalDAV, where a CalDAV server keeps no history either.
  - Door, alarm, garage, scene, script and non-outlet switch actions need the
    PIN on a household device.
- Per-assistant limits bound how much an injected instruction can do before
  somebody notices, on top of the Integration API's generic per-token limit
  (`lib/integration-limits.ts`; 429 `rate_limited` with `Retry-After`):
  - **Confirmations:** at most **2 waiting** and **5 created per 10 minutes**
    per assistant connection, checked before anything is stored or pushed —
    every request lights up every screen and phone in the house.
  - **Edits and deletes:** at most **30 per 10 minutes** per assistant
    connection across tasks, shopping items, notes, calendar events and meal
    entries (every Integration API `PATCH` and `DELETE`). Applies only to
    OAuth-issued assistant connections (`context.assistant`, from the token's
    `oauth_client_id`) — a token created by hand in Settings, such as Home
    Assistant or Bridge, is not limited this way, since a scripted client can
    legitimately send more than 30 in a row (Home Assistant's "Clear
    completed" deletes every ticked shopping item one `DELETE` at a time).
- Every action is attributable: `assistant_action_requests` carries the
  token for a sensitive action's confirmation *and* for an action that ran
  immediately (a `done`/`failed` row is written after the fact, with no
  screen ever shown), and the Settings list shows each assistant connection.
- Messages are attributed: an assistant's message carries its connection's
  name (`messages.sender_label`, §5), shown on every screen as "via <name>",
  so a family can tell it from one a person typed. The name is the client's
  own choice, so everywhere it is shown — the confirmation prompt included —
  it is cut to 40 characters and set as a label, not as running text.
- `send_message` has its own budget on top of the Integration API's generic
  per-token write limit: at most **5 messages per 10 minutes per assistant
  connection**, 429 `rate_limited` past it. A message interrupts whoever is
  looking at a screen in every room at once, so even a token doing exactly
  what it was asked can be too loud.

## 8. Compatibility

`notes:write` gains edit and delete. Existing Home Assistant tokens holding
`notes:write` therefore can now edit and delete notes through the Integration
API. Accepted: it matches what `tasks:write` and `shopping:write` already
allow, and the HA component holds no edit tools. Called out in the release
notes when this ships.

Completing a task through the API is the same completion as ticking it on a
screen, so a chore that carries points awards them to the person it is
assigned to (the database trigger from `migration_zzz_todo_points.sql`), and
reopening a one-off task takes them back. An assistant with `tasks:write`
can therefore move a child's points; the family grants that scope knowing
it, and every completion shows on the task list like any other.
