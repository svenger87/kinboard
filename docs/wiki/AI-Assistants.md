# AI assistants

Kinboard has a built-in MCP endpoint at `/api/mcp`. Claude and ChatGPT use it
to read the family's calendar, tasks, notes, meal plan and shopping list, to
add to and edit them, and — within a device catalogue the family builds
itself — to control Home Assistant. Anything that opens a lock, a garage
door or an alarm, or that isn't a plainly harmless action, waits for a
family member to confirm it on a Kinboard screen or phone.

You can connect more than one assistant, and more than one connection of the
same assistant (say, Claude on the web and Claude Code). Each connection
appears as its own row under **Settings → Integrations**, with its own
permissions, and is revoked separately.

## Connect Claude or ChatGPT

0. Switch on **Settings → Integrations → Allow AI assistants**. It is off
   until you do, and while it is off Kinboard answers the assistant addresses
   as if they did not exist. Switching it off again disconnects every
   assistant.
1. Make Kinboard reachable over HTTPS on a public hostname (a reverse proxy,
   Cloudflare Tunnel or Tailscale Funnel). Claude and ChatGPT connect from the
   internet, not from your network.
2. In Claude: **Settings → Connectors → Add custom connector**. In ChatGPT:
   add a custom connector (developer mode). Enter
   `https://<your-kinboard>/api/mcp`.
3. A Kinboard page opens. If this browser isn't joined to your family yet,
   join first. Choose what the assistant may do, enter your settings PIN and
   select **Allow**. If your family has no PIN yet, you set one here (4 digits,
   entered twice) — it then also protects the settings pages.

Approve in the browser tab the assistant opened. The request is tied to that
browser, so a link copied to another device shows as expired — start the
connection again there instead.

The connection appears under **Settings → Integrations** with an "Assistant"
label. Revoke it there to disconnect.

## Claude Code on your own network

Claude Code runs on your computer, so a LAN address works:

    claude mcp add --transport http kinboard http://kinboard.local:3000/api/mcp

It signs in through the same Kinboard page — with the same settings PIN. Or create a token under
**Settings → Integrations** and pass it as a header:

    claude mcp add --transport http kinboard http://kinboard.local:3000/api/mcp \
      --header "Authorization: Bearer kbi_…"

## Tools

Grouped by what they touch. Every tool needs the matching permission below —
an assistant without `tasks:write`, for example, can read tasks but not
change them.

### Family, calendar and people

| Tool | Does |
|---|---|
| `get_family_summary` | Today's family context: next event, due tasks, meals, birthdays, more |
| `get_next_birthday` | The next family birthday and how many days away it is |
| `list_calendar_events` | Events in a date/time range |
| `list_writable_calendars` | Calendars an event can be created on, including connected Google and CalDAV calendars |
| `create_calendar_event` | Add an event, written through to Google or CalDAV when connected |
| `update_calendar_event` | Edit an event's title, time, location or description, written through to Google or CalDAV; the previous values are overwritten and cannot be restored |
| `delete_calendar_event` | Delete an event, including from Google or CalDAV; cannot be undone — calendar events have no recycle bin |
| `list_people` | The people in the family, so a task can be assigned to someone |

### Tasks

| Tool | Does |
|---|---|
| `list_tasks` | Active tasks |
| `create_task` | Add a task |
| `complete_task` | Mark a task done |
| `reopen_task` | Mark a one-off task not done again — recurring tasks can't be reopened |
| `update_task` | Edit a task's title, due date or assignee |
| `delete_task` | Delete a task — to the recycle bin, recoverable from Settings |

### Shopping list

| Tool | Does |
|---|---|
| `list_shopping_items` | The shopping list |
| `add_shopping_item` | Add an item |
| `check_shopping_item` / `uncheck_shopping_item` | Mark an item bought or not |
| `rename_shopping_item` | Change an item's name |
| `delete_shopping_item` | Delete an item — permanent; the shopping list has no recycle bin |

### Notes

| Tool | Does |
|---|---|
| `list_notes` | The 100 newest notes |
| `create_note` | Add a note |
| `update_note` | Edit a note's text or pinned state |
| `delete_note` | Delete a note — to the recycle bin, recoverable from Settings |

### Meal plan

| Tool | Does |
|---|---|
| `get_meal_plan` | Planned meals in a date range, up to 31 days |
| `add_meal` | Add a meal to a date and slot (breakfast, lunch, dinner or snack) — adds to the slot, doesn't replace what's already there |
| `remove_meal` | Remove a meal plan entry — to the recycle bin, recoverable from Settings |

### Messages and energy

| Tool | Does |
|---|---|
| `send_message` | Put text on every Kinboard screen and push it to every phone — at most 5 messages per 10 minutes per assistant connection |
| `get_solar_production` | Current solar power and today's solar energy, from the sensors set up under Energy |

### Home

| Tool | Does |
|---|---|
| `list_home_devices` | The devices in the family's catalogue, with their room, state and what each is allowed to do |
| `get_device_state` | One catalogue device's current state |
| `control_device` | Run an allowed action on a catalogue device. Most run immediately; a sensitive one waits for a family member to confirm it |
| `get_action_status` | Check what happened to an action waiting for confirmation |

## Permissions

| Permission | Lets the assistant |
|---|---|
| `family:read` | read the summary, calendar, tasks, people and shopping list |
| `notes:read` | read notes |
| `calendar:write` | add, edit and delete calendar events |
| `tasks:write` | add, complete, edit and delete tasks |
| `shopping:write` | add, check/uncheck, rename and delete shopping items |
| `notes:write` | add, edit and delete notes |
| `meals:write` | add and remove meal plan entries |
| `announcements:write` | send a message to the family's screens |
| `energy:read` | read the solar sensors set up under Energy |
| `home:read` | list the home catalogue and read a device's state |
| `home:control` | control catalogue devices — grant `home:read` too if the assistant should also be able to look before it acts |

Twenty wrong PINs within an hour lock PIN entry for the rest of that hour.

## Home

Only devices you've added to Kinboard's own device catalogue are visible to
an assistant at all. Anything outside it can't be listed, read or
controlled, and the assistant has no way to find out what else exists on
your Home Assistant. For a catalogued device, only a fixed set of actions is
allowed per kind of device — a light can be turned on or off and dimmed, a
thermostat can have its temperature or mode set, and so on — there's no
"run any Home Assistant service" tool.

**Runs immediately:** lights, switches, input booleans, fans, climate
devices, media players, scenes, vacuums, humidifiers, and covers whose Home
Assistant `device_class` is `awning`, `blind`, `curtain`, `damper`, `shade`
or `shutter`.

**Always waits for a family member to confirm:** locks, alarm panels, any
cover that isn't one of the plainly harmless kinds above — including a
garage door, a gate, a plain `door`, or a cover with no device class set —
scripts, buttons, sirens and lawn mowers. If Home Assistant has one of your
blinds under a device class it doesn't recognise, set its "Show as" in Home
Assistant to fix that.

When an action needs confirming, it appears on every Kinboard screen in the
house at once — including over the screensaver — and as a push notification
to every phone that has it enabled. Anyone standing at a screen can **deny**
it with no PIN; stopping an unexpected unlock should never be harder than
approving one. **Approving** it needs the family's settings PIN, and the
request expires after 2 minutes if nobody answers. A family with no
settings PIN can't approve sensitive actions at all —
`control_device` says so straight away, without leaving anything pending.

Every home action an assistant takes is recorded against that assistant,
including ones that ran immediately with no confirmation — so Settings can
always show which assistant did what.

**Never possible, whatever is approved:** an alarm or lock code is never
held or passed through by an assistant — arming, disarming, locking and
unlocking always go through PIN confirmation instead, never a code; nothing
outside the catalogue can be reached; and Home Assistant's own generic
"call any service" shortcut (`homeassistant.*`, and the same for
`automation.*`, `update.*`, `shell_command.*`) is never reachable.

## Forgot the PIN?

The PIN protects the settings pages and approving assistants, and Kinboard
checks it on the server — there is no way around it from a browser. If nobody
remembers it, remove it from the database on the machine running Kinboard
(the container is `kinboard-db` unless you changed `PROJECT_NAME`):

    docker exec -i kinboard-db psql -U postgres -d postgres -c "DELETE FROM integration_secrets WHERE key = 'settings_pin';"

That removes the PIN for every family on this Kinboard. Open **Settings** and
set a new one.
