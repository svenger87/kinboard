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
| `search_calendar_events` | Find appointments by name — "when is the dentist?" — in the title, place or notes; from today to a year ahead unless a range is given, at most 100 |
| `list_writable_calendars` | Calendars an event can be created on, including connected Google and CalDAV calendars |
| `create_calendar_event` | Add an event, optionally for someone, written through to Google or CalDAV when connected |
| `update_calendar_event` | Edit an event's title, time, location, description or who it is for, written through to Google or CalDAV; the previous values are overwritten and cannot be restored |
| `delete_calendar_event` | Delete an event, including from Google or CalDAV; cannot be undone — calendar events have no recycle bin |
| `list_people` | The people in the family, so a task or an event can be assigned to someone |
| `get_school_timetable` | The children's school timetable — lessons per weekday with times, subject and room — or, for a given date, who has school and which lessons. During school holidays (entered under Settings -> School schedule, or a calendar marked as holidays) and at weekends it says there is no school, and why |

### Tasks

| Tool | Does |
|---|---|
| `list_tasks` | Active tasks |
| `create_task` | Add a task — optionally for someone, repeating (daily, weekly, every other week, monthly or on picked weekdays), with a priority, an icon and points |
| `complete_task` | Mark a task done — a chore with points awards them, just as ticking it off on a screen does |
| `reopen_task` | Mark a one-off task not done again — recurring tasks can't be reopened |
| `update_task` | Edit a task's title, due date, assignee, repetition, priority, icon or points |
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

### Recipes

| Tool | Does |
|---|---|
| `search_recipes` | Find the family's own saved recipes by title or tag — never a recipe from the web |
| `get_recipe` | One recipe's ingredients, servings, times and steps |
| `add_recipe_to_shopping_list` | Put a recipe's ingredients — all of them or just the ones picked — on the shopping list, scaled to the servings asked for, exactly as the recipe page's button does. With Bring! sync on they go onto the Bring! list too |

### Kitchen timers

| Tool | Does |
|---|---|
| `list_timers` | The timers on the screens, running or ringing, with the time left |
| `start_timer` | Start a timer of up to 24 hours, with an optional label — it counts down and rings on the screens that show the timers card, and notifies phones, like one set on the panel. At most 10 can be running or ringing at once; one that has rung unanswered for over an hour no longer counts |
| `stop_timer` | Stop a timer and take it off the screens; its phone notification is cancelled |

### Birthdays

| Tool | Does |
|---|---|
| `list_birthdays` | The family's birthdays, the next one first, with the day each falls on next, how many days away it is and — when the birth year is known — how old the person is and will turn |
| `add_birthday` | Add a birthday, as on the Birthdays page: a name, the date (the year may be left out, and then no age is shown), optionally the family member it belongs to, and how many days ahead to be reminded (0 to 60, 7 if not said) |
| `update_birthday` | Change a birthday's name, date, family member or reminder |
| `delete_birthday` | Delete a birthday. It goes to the recycle bin, so `restore_birthday` can bring it back |

### Pocket money

| Tool | Does |
|---|---|
| `list_pocket_money` | Each child's pocket money: balance, what they have saved in total, their allowance, and their saving goals with how far along each one is |
| `book_pocket_money` | Ask to add money to a child's pocket money or take some out — up to 500 at a time, with an optional note. Nothing is booked until a family member allows it on a Kinboard screen with the settings PIN; `get_action_status` says whether it was |

Every booking an assistant asks for waits for a person, exactly like a
sensitive home action: it appears on every screen and phone as, for example,
*"ChatGPT wants to add €5.00 to Enno's pocket money (note: "mowing the
lawn")"*, anyone can deny it, allowing it needs the settings PIN, and it
expires after 2 minutes. The assistant's note is always shown in quotes, so
it can't pass itself off as Kinboard's own words. If a withdrawal is more
than the child has by the time someone allows it, nothing is booked and the
assistant is told why. Only children with a pocket money account can be
booked for. Home Assistant's `add_pocket_money` service is unchanged for the
token you paste into Home Assistant, but an assistant connection can't use
it — assistants always go through the confirmation. This depends on how the token was
made, not on the program using it: a token created by hand under Settings ->
Integrations books straight away even if you paste it into an AI app, so
only connect assistants through the "Allow AI assistants" sign-in.

### Undoing a delete

| Tool | Does |
|---|---|
| `list_deleted_items` | What's in the recycle bin that an assistant can bring back — deleted tasks, notes, meal plan entries and birthdays, newest first |
| `restore_task` / `restore_note` / `restore_meal` / `restore_birthday` | Take one back out of the recycle bin, exactly as it was. Each needs the same permission as editing that kind of thing (`tasks:write`, `notes:write`, `meals:write`, `birthdays:write`). An assistant can never empty the bin or erase anything in it for good |

### Countdowns

| Tool | Does |
|---|---|
| `list_countdowns` | The countdowns on the countdown widget, the soonest first, with how many days are left |
| `add_countdown` | Add a countdown — a title, the date and one of the widget's seven icons. It never overwrites a change made in the meantime, and two assistants adding at once are both kept — but a screen that saves an out-of-date list can still drop it |
| `delete_countdown` | Take a countdown off the widget. Permanent — countdowns have no recycle bin |

### Attention panel

| Tool | Does |
|---|---|
| `list_attention_items` | The hints the attention panel is showing right now ("Rain likely today"), most important first, in the family's language. A hint from Home Assistant, such as doors still open at bedtime, only says how many unless the assistant may also see the home (`home:read`) |
| `dismiss_attention_item` | Take a hint off the panel, as tapping OK on it does; the screens catch up within a few minutes. The hint comes back if the situation arises again |

### Messages and energy

| Tool | Does |
|---|---|
| `send_message` | Put text on every Kinboard screen and push it to every phone, marked "via" the assistant's name — at most 5 messages per 10 minutes per assistant connection |
| `list_screen_messages` | The 20 newest messages on the screens, whether someone has seen them yet, and which assistant sent one |
| `acknowledge_message` | Mark a message as seen, like tapping "Got it" — it leaves every screen. If someone already tapped it, theirs stands |
| `get_solar_production` | Current solar power and today's solar energy, from the sensors set up under Energy. Today's energy is the change since midnight in the family's time zone, from Home Assistant's statistics — the number the Energy page shows — and `total` is the counter's raw state, so a lifetime counter is never read out as today's yield |
| `get_energy_status` | The whole energy picture from the sensors set up under Energy: solar, battery, grid and home power right now, today's energy in and out (counted the same way: the change since local midnight, from Home Assistant's statistics, with the counter's raw state as `total`), and the battery's charge |

### Home

| Tool | Does |
|---|---|
| `list_home_devices` | The devices in the family's catalogue, with their room, state and what each is allowed to do |
| `get_device_state` | One catalogue device's current state |
| `control_device` | Run an allowed action on a catalogue device. Most run immediately; a sensitive one waits for a family member to confirm it |
| `get_action_status` | Check what happened to an action or a pocket money booking waiting for confirmation |

### Vehicles

| Tool | Does |
|---|---|
| `list_vehicles` | Each car's charge level, range and charging status (plus temperature, locks, doors, windows and odometer where the car reports them), read from Home Assistant — the same readings as the Vehicles page. Never the car's location |

## Permissions

| Permission | Lets the assistant |
|---|---|
| `family:read` | read the summary, calendar, tasks, people, meal plan and shopping list, the family's recipes, the timers, the school timetable, birthdays, each child's pocket money, what is in the recycle bin, the countdowns, the messages on the screens and the attention panel's hints (those from Home Assistant only as a count, unless `home:read` is granted too) |
| `notes:read` | read notes |
| `calendar:write` | add, edit and delete calendar events, and say who an event is for; add and delete countdowns |
| `tasks:write` | add, complete, edit and delete tasks, and bring them back from the recycle bin; dismiss hints on the attention panel |
| `shopping:write` | add, check/uncheck, rename and delete shopping items, and put a recipe's ingredients on the list |
| `notes:write` | add, edit and delete notes, and bring them back from the recycle bin |
| `meals:write` | add and remove meal plan entries, and bring them back from the recycle bin |
| `announcements:write` | send a message to the family's screens, and mark one as seen |
| `energy:read` | read the energy sensors set up under Energy (solar, battery, grid, consumption) |
| `home:read` | list the home catalogue and read a device's state |
| `home:control` | control catalogue devices — grant `home:read` too if the assistant should also be able to look before it acts |
| `vehicles:read` | read the cars' charge level, range and charging status — never their location |
| `timers:write` | start and stop timers on the screens |
| `birthdays:write` | add, edit and delete birthdays, and bring them back from the recycle bin |
| `pocket_money:write` | ask to book pocket money — every booking still needs a family member to confirm with the settings PIN |

Twenty wrong PINs within an hour lock PIN entry for the rest of that hour.

**Points.** Completing a task through an assistant is the same as ticking it
off on a screen: if the task is a chore with points and it's assigned to a
child, the child gets them (and reopening a one-off task takes them back).
An assistant can also put points on a task it adds or edits; on a task for
a grown-up they're kept but never awarded. Only grant `tasks:write` to an
assistant you'd let tick off and set up the children's chores.

**Limits.** Each assistant connection can make at most 30 edits and deletes
in 10 minutes, across tasks, shopping items, notes, calendar events and meal
entries, and can have at most 2 home actions waiting for confirmation (5 in
10 minutes). Past that it is told to slow down and nothing happens. This
limit applies to assistant connections only — a token you create by hand for
Home Assistant or another manual integration is not limited this way, so
bulk actions like "Clear completed" over a long shopping list still work.
Edits overwrite the previous text with no history; deleted tasks, notes and
meals go to the recycle bin, where an assistant can also bring them back
(restoring doesn't count towards the 30), but deleted shopping items and
calendar events are gone for good — calendar events from Google or CalDAV too.

## Home

Only devices you've added to Kinboard's own device catalogue are visible to
an assistant at all. Anything outside it can't be listed, read or
controlled, and the assistant has no way to find out what else exists on
your Home Assistant. For a catalogued device, only a fixed set of actions is
allowed per kind of device — a light can be turned on or off and dimmed, a
thermostat can have its temperature or mode set, and so on — there's no
"run any Home Assistant service" tool.

**Runs immediately:** lights, fans, climate devices (temperature 5–30 °C),
media players, vacuums, humidifiers, switches whose Home Assistant
`device_class` is `outlet`, and covers whose `device_class` is `awning`,
`blind`, `curtain`, `damper`, `shade` or `shutter`.

**Always waits for a family member to confirm:** locks, alarm panels,
scenes, scripts, input booleans (helper toggles), buttons, sirens, lawn
mowers, any switch that isn't an outlet — a switch can just as well be a
garage relay or an alarm — and any cover that isn't one of the plainly
harmless kinds above, including a garage door, a gate, a plain `door`, or a
cover with no device class set. Scenes and scripts ask because they can
include anything, an unlock or a disarm among them.

Home Assistant's **"Show as"** setting is how you tell it what a device
really is. A blind under a device class Kinboard doesn't recognise: set
"Show as" to the right kind of cover. A smart plug: show it as an outlet,
and switching it no longer asks. A switch that really drives a lamp: show it
as a light — Home Assistant then creates a new `light.` entity, which you
add to the catalogue in place of the switch.

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
