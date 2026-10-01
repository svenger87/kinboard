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
| `meals:write` | **new** | add, change, remove meal-plan entries |
| `announcements:write` | — (unused until now) | send a message to the family's screens |
| `home:read` | **new** | list catalogue devices and their current state |
| `home:control` | **new** | run allowed actions on catalogue devices |

`home:control` never implies `home:read`, consistent with RFC-001 §4.

## 3. Tools

| Tool | Scope | Notes |
|---|---|---|
| `list_people` | family:read | names and ids, so tasks can be assigned |
| `complete_task` | tasks:write | recurring tasks: done for today, in the family's time zone |
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

## 4. Home Assistant boundary

1. **Catalogue only.** The entity must be a `catalogue_items` row of the
   token's family with `kind = 'ha_entity'`. Anything else is "not found" —
   the assistant cannot learn which entities exist outside the catalogue.
2. **Per-domain service allowlist.** Only these run; everything else is refused:

   | Domain | Services | Sensitive |
   |---|---|---|
   | light | turn_on (brightness_pct, color_temp_kelvin, rgb_color), turn_off, toggle | |
   | switch, input_boolean, fan | turn_on, turn_off, toggle (fan: + set_percentage) | |
   | climate | set_temperature, set_hvac_mode, turn_on, turn_off | |
   | media_player | media_play, media_pause, media_stop, media_next_track, media_previous_track, volume_set, volume_mute, turn_on, turn_off, select_source | |
   | cover | open_cover, close_cover, stop_cover, set_cover_position | **unless `device_class` is awning, blind, curtain, damper, shade or shutter** |
   | scene | turn_on | |
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
   "Show as" in Home Assistant. `set_temperature` accepts −20 to 40, which
   assumes °C; households running Home Assistant in °F are a known limitation.
3. **Confirmation for sensitive actions.** `control_device` stores a pending
   request (expires after **2 minutes**) and returns `pending_confirmation`
   with an id. Every Kinboard screen shows it at once (realtime), and every
   phone with push enabled gets a notification that opens it. A family member
   approves with the **settings PIN** (same rate-limited check as everywhere);
   the server then runs the action exactly as stored and records the result.
   Deny, expiry, or a revoked assistant all end it without running anything.
   The assistant learns the outcome with `get_action_status`.
4. **Fail closed.** No Home Assistant configured, catalogue unreadable, state
   unreadable (for the garage check), PIN unreadable → refused, never "assumed
   safe".

## 5. Data model

`assistant_action_requests` (published to realtime, REVOKEd like the other
assistant tables, readable to the family's screens through a session route):
`id, family_id, token_id, client_name, entity_id, entity_name, domain, service,
data jsonb, status (pending|approved|denied|expired|failed|done), created_at,
expires_at, decided_at, decided_by_device_id, result jsonb`.

No other schema changes: tasks, notes and meal-plan entries already
soft-delete; events and shopping items do not, by earlier design.

## 6. Fixes the survey found on the way

- `PATCH`/`DELETE /lists/tasks/{item}` treat a recurring task as one-off and
  can edit or purge binned rows. Both are fixed: recurring completion writes
  `last_completed_day` in the family's time zone, and binned rows are invisible.
- `/api/google/events` `PATCH` and `DELETE` look the event up by id with **no
  family check** (present on `main`). Fixed here, and worth a separate fix on
  `main` before this branch lands.
- The session route `/api/homeassistant/services` validates neither domain nor
  service. Out of scope here (it serves the household's own screens), noted.

## 7. Threat notes (amends RFC-010 §4)

- Actuation now exists, inside a local allowlist the household builds on its
  own screen (the catalogue), with a second, physical-presence-style gate (PIN
  on a household device) for actions that open the house. Widening the allowlist
  remains a local act (RFC-002 §6).
- Prompt injection: note text, event titles and shopping items are attacker-
  reachable content in the model's context. The worst an injected instruction
  can do without a human is non-sensitive device control and edits/deletes that
  the recycle bin (tasks, notes) or provider history (calendar) can recover;
  door, alarm and garage actions need the PIN on a household device.
- Every action is attributable: domain events and the request table carry the
  token, and the Settings list shows each assistant connection.

## 8. Compatibility

`notes:write` gains edit and delete. Existing Home Assistant tokens holding
`notes:write` therefore can now edit and delete notes through the Integration
API. Accepted: it matches what `tasks:write` and `shopping:write` already
allow, and the HA component holds no edit tools. Called out in the release
notes when this ships.
