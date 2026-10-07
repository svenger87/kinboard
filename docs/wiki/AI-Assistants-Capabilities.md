# What assistants can do

Part of the [AI assistants](AI-Assistants) guide.

An assistant works through *tools*: small, named actions Kinboard offers it.
This page lists every one, grouped by area. You never call a tool yourself;
you ask in your own words, and the assistant picks the tools. Each tool needs
one permission (scope), which you grant on the consent page. An assistant
without it is told which permission is missing, and nothing happens. The
permissions themselves are explained in [Permissions and
safety](AI-Assistants-Permissions-and-Safety#permissions).

Kinboard also tells the assistant which tools only read, which add, which
change or remove something, and which reach outside Kinboard (Google,
CalDAV, Bring! or Home Assistant). What the assistant does with that, such as
asking you before it runs one, depends on the assistant.

In the tables, **Reads**, **Adds** and **Changes** say which kind each tool
is. *Outside Kinboard* means the change is also written to another service.

Text that comes from your family's data (note text, event titles, recipe
steps, names, message text) is handed to the assistant as data, and every
tool that returns it tells the assistant never to follow it as instructions.
See [Prompt injection](AI-Assistants-Permissions-and-Safety#text-in-your-data-is-data-not-instructions).

## Family and people

| Tool | What it does | Permission | Notes |
|---|---|---|---|
| `get_family_summary` | Today's family context: the next event, the upcoming birthday, due tasks, meals, attention hints and more, with the family's local date | `family:read` | Reads |
| `get_next_birthday` | The next family birthday, its date and how many days away it is, in the family's time zone | `family:read` | Reads |
| `list_people` | The people in the family with their ids, so a task, an event or a birthday can be assigned to someone by name | `family:read` | Reads |

> "What's going on today?" · "Was steht heute an?"
>
> "When is the next birthday?" · "Wer hat als Nächstes Geburtstag?"

## Calendar

| Tool | What it does | Permission | Notes |
|---|---|---|---|
| `list_calendar_events` | Events overlapping a date and time range | `family:read` | Reads |
| `search_calendar_events` | Find appointments by name: the title, place or description contains the words, ignoring case | `family:read` | Reads. From today to 365 days ahead unless a range is given (at most 370 days); at most 100 events, earliest first |
| `list_writable_calendars` | The calendars an event can be added to, including connected Google and CalDAV calendars | `family:read` | Reads. An event is always created on a calendar picked from this list |
| `create_calendar_event` | Add a timed or all-day event, optionally for someone | `calendar:write` | Adds, outside Kinboard: written through to Google or CalDAV when the calendar is connected; the assistant is told to report a sync failure. Without a time it asks first (all day, or when?); without a person it adds the event, then asks once who it's for |
| `update_calendar_event` | Change an event's title, time, all-day dates, place, description or who it is for | `calendar:write` | Changes, outside Kinboard. The previous values are overwritten, in Kinboard and in Google or CalDAV, and cannot be restored. One occurrence of a repeating CalDAV event can't be edited |
| `delete_calendar_event` | Delete an event, including from Google or CalDAV | `calendar:write` | Changes, outside Kinboard. Cannot be undone: calendar events have no recycle bin. If the provider refuses, the event is kept. One occurrence of a repeating CalDAV event can't be deleted |

> "What's on the calendar tomorrow?" · "Was steht morgen im Kalender?"
>
> "When is the dentist?" · "Wann ist der Zahnarzttermin?"
>
> "Put football training for Enno on Thursday from 5 to 6.30 pm." ·
> "Trag Enno für Donnerstag 17 bis 18:30 Uhr Fußballtraining ein."
>
> "Move the parents' evening to 7 pm." · "Verschieb den Elternabend auf 19 Uhr."

Who an event is for is kept with the event in Google, so the next sync keeps
it. On a Google calendar that has its own person, or whose mapping rules
match the event, clearing it gives the event that person again at the next
sync; a CalDAV calendar's next sync assigns it from the calendar's own
settings. See [Calendar](Calendar).

## School timetable

| Tool | What it does | Permission | Notes |
|---|---|---|---|
| `get_school_timetable` | The children's timetable: lessons per weekday with times, subject and room. For a given date: who has school and which lessons | `family:read` | Reads. During school holidays (entered under **Settings → Holidays**, synced from OpenHolidays, from a calendar marked as holidays, or a public holiday in your region outside the US) and at weekends it says there is no school, and why. Can be narrowed to one child |

> "Does anyone have school on Monday?" · "Hat am Montag jemand Schule?"
>
> "What does Mia have third period on Wednesday?" · "Was hat Mia am Mittwoch in der dritten Stunde?"

## Tasks

| Tool | What it does | Permission | Notes |
|---|---|---|---|
| `list_tasks` | The active tasks, with whether they're done and when they're due; for a task people take turns at, who takes part and whose turn it is today | `family:read` | Reads |
| `create_task` | Add a task. Optionally for someone, with a due date, repeating (once, daily, weekly, every other week, monthly, or on picked weekdays), with a priority (high, medium, low), an icon and points (0 to 10,000). A repeating task can also go round between people who take turns | `tasks:write` | Adds. The assistant never invents a due date, an assignee or a repetition; when you left them out it asks once afterwards |
| `complete_task` | Mark a task done. A repeating task is done for today, in the family's time zone, and comes due again on its next day | `tasks:write` | Changes. A child's task with points awards them, just as ticking it off on a screen does |
| `reopen_task` | Mark a one-off task not done again | `tasks:write` | Changes. Repeating tasks can't be reopened; Kinboard has no undo for a day already marked done |
| `update_task` | Change a task's title, due date, assignee, repetition, priority, icon or points, or who takes turns (or stop the turns) | `tasks:write` | Changes. A changed field's previous value is not kept |
| `delete_task` | Delete a task | `tasks:write` | Changes. Goes to the recycle bin; `restore_task` or **Settings → Recycle bin** brings it back |

> "Add 'take the bins out' for Enno, every Tuesday, 5 points." ·
> "Leg für Enno 'Mülltonnen rausstellen' an, jeden Dienstag, 5 Punkte."
>
> "Tick off vacuuming." · "Hak Staubsaugen ab."

Points are awarded only when a task is assigned to a child. On a grown-up's
task they're stored but never awarded. See [Tasks](Tasks).

When you add a task without saying who it's for or when, the assistant saves it
anyway and then asks you once, briefly, about what's missing: who it's for, a
day if one makes sense, and points if it's for a child (never for a grown-up).
Say "just add it" and it won't ask.

**Taking turns.** Ask for a chore that goes round ("the kids take turns
washing up, every day") and the assistant sets up one repeating task with the
people in order, as *Take turns* does in the task dialog. If you didn't say who
takes part, it asks once; it never assumes all the children. Points on such a
task go to whoever's turn it was when it's ticked off, and only if that's a
child. Asking "whose turn is it to wash up?" reads today's person from the task.

> "Mira and Jonas take turns emptying the dishwasher, every day, 2 points." ·
> "Mira und Jonas räumen abwechselnd die Spülmaschine aus, jeden Tag, 2 Punkte."

## Shopping list

| Tool | What it does | Permission | Notes |
|---|---|---|---|
| `list_shopping_items` | The shopping list, with how much of each item | `family:read` | Reads |
| `add_shopping_item` | Add an item, optionally with a quantity ("2", "500 g", "1 Packung") | `shopping:write` | Adds, outside Kinboard when Bring! sync is on. If the item is already on the list and not ticked off, it is merged into it instead (see below) |
| `check_shopping_item` | Mark an item bought | `shopping:write` | Changes |
| `uncheck_shopping_item` | Mark an item not bought | `shopping:write` | Changes |
| `rename_shopping_item` | Change an item's name | `shopping:write` | Changes. The previous name is not kept |
| `delete_shopping_item` | Delete an item | `shopping:write` | Changes. Permanent: the shopping list has no recycle bin |

> "Put milk and butter on the shopping list." · "Schreib Milch und Butter auf die Einkaufsliste."
>
> "Put 500 g of flour on the list." · "Schreib 500 g Mehl auf die Liste."
>
> "What do we still need to buy?" · "Was müssen wir noch einkaufen?"

### Adding something that's already on the list

When an assistant adds something that is already on the shopping list and
not yet ticked off, Kinboard doesn't add it a second time. It adds to the
item that's there, and the assistant is told so, so it can say "milk was
already on the list, it's 3 now".

- **Same item** means the same name, ignoring upper and lower case, extra
  spaces and simple plurals: *egg* and *eggs*, *tomato* and *tomatoes*,
  *Zwiebel* and *Zwiebeln*. Nothing looser than that: *milk* and *oat milk*
  stay two items, and so do *Ei* and *Eis*.
- **Quantities add up** when they are in the same unit: 2 and 1 make 3,
  500 g and 250 g make 750 g. A plain number and *Stück* count the same.
  Different units are not converted but written side by side: 2 and
  1 Packung become *2 + 1 Packung*.
- **No quantity means "some".** A second *salt* without a quantity leaves
  the salt that's there as it is, rather than turning it into *2 salt*.
- **A ticked-off item is never merged into.** Once it's bought, needing it
  again is a new need, so a new item is added.
- With Bring! sync on, Bring! gets the item's new quantity under the name
  it already has there, so Bring! updates its item rather than listing it
  twice.

The same applies to `add_recipe_to_shopping_list`, so two recipes that both
need milk leave one milk on the list, and to Home Assistant's shopping
to-do list. Items added on a Kinboard screen are not merged: there you can
see the list and use the + button on the item that's already there.

## Notes

| Tool | What it does | Permission | Notes |
|---|---|---|---|
| `list_notes` | The 100 newest notes | `notes:read` | Reads |
| `create_note` | Add a note | `notes:write` | Adds |
| `update_note` | Change a note's text, or pin or unpin it | `notes:write` | Changes. The previous text is not kept |
| `delete_note` | Delete a note | `notes:write` | Changes. Goes to the recycle bin; `restore_note` brings it back |

> "Make a note: the plumber comes on Friday at 8." · "Notier: Der Klempner kommt Freitag um 8."

## Meal plan and recipes

| Tool | What it does | Permission | Notes |
|---|---|---|---|
| `get_meal_plan` | Planned meals in a date range, at most 31 days: each with its date, slot (breakfast, lunch, dinner or snack) and a recipe or a free-text note | `family:read` | Reads |
| `add_meal` | Add a meal to a date and slot: one of the family's recipes, or a free-text note of up to 200 characters | `meals:write` | Adds. Adds to the slot rather than replacing what's there; a slot can hold more than one meal. When you didn't say which meal, the assistant asks ("tonight" means dinner) |
| `remove_meal` | Remove a meal plan entry | `meals:write` | Changes. Goes to the recycle bin; `restore_meal` brings it back |
| `search_recipes` | Find the family's own saved recipes by title or tag; with neither, favourites first | `family:read` | Reads. At most 50 results. Never searches the web |
| `get_recipe` | One recipe: servings, times, tags, ingredients and the steps | `family:read` | Reads |
| `create_recipe` | Save a recipe to your collection: title, a short description, servings, prep and cook time, tags, ingredients (quantity, unit, name, group, notes) and the steps in order. No picture | `meals:write` | Adds. The assistant looks for a saved recipe first and asks before saving a second one with the same name |
| `add_recipe_to_shopping_list` | Put a recipe's ingredients on the shopping list, all of them or only the ones picked, scaled to the servings asked for (up to 50) | `shopping:write` | Adds, outside Kinboard when Bring! sync is on, and Kinboard can't take them back off the Bring! list. Each ingredient keeps its quantity. One that's already on the list and not ticked off is [merged into that item](#adding-something-thats-already-on-the-list) rather than added again |

> "Put the ingredients for the lasagne recipe on the shopping list." ·
> "Pack die Zutaten vom Lasagne-Rezept auf die Einkaufsliste."
>
> "…but only for 6 people, and we've got the onions." ·
> "…aber für 6 Personen, und Zwiebeln haben wir."
>
> "Come up with a nice dinner for tonight." ·
> "Denk dir ein schönes Abendessen für heute aus."
>
> "Save that recipe to Kinboard." · "Speicher das Rezept in Kinboard."
>
> "Plan spaghetti bolognese for dinner on Saturday." ·
> "Plan für Samstagabend Spaghetti Bolognese ein."

**Inventing or saving a recipe.** Asked for a dinner idea, the assistant first
looks through your own recipes; only when nothing fits does it write a new one,
in your family's language, in metric units and sized for your household unless
you said otherwise. It saves it, plans it for the day you asked, and asks once
whether you already have some of the ingredients before putting the rest on the
shopping list. A recipe you worked out together is saved exactly as agreed, and
then the assistant only offers to plan it or shop for it. It never makes claims
about nutrition or allergies.

See [Recipes & meal planning](Recipes).

## Kitchen timers

| Tool | What it does | Permission | Notes |
|---|---|---|---|
| `list_timers` | The timers on the screens, running, paused or ringing, with the time left, the one due soonest first | `family:read` | Reads |
| `start_timer` | Start a timer from 1 second to 24 hours, with an optional label of up to 60 characters | `timers:write` | Adds. It counts down and rings on the screens that show the timers card, and notifies phones, like one set on the panel. Each call starts a new timer. At most 10 running, paused or ringing at once (a paused timer counts); one that has rung unanswered for over an hour no longer counts |
| `stop_timer` | Stop a timer and take it off the screens | `timers:write` | Changes. Its phone notification is cancelled. A stopped timer can't be resumed |

> "Set a timer for the pasta, 9 minutes." · "Setz einen Timer für die Nudeln, 9 Minuten."
>
> "How long is left on the oven?" · "Wie lange läuft der Ofen-Timer noch?"

See [Timers](Timers).

## Birthdays

| Tool | What it does | Permission | Notes |
|---|---|---|---|
| `list_birthdays` | The family's birthdays, the next one first, with the day each next falls on, how many days away it is and, when the birth year is known, the age the person turns | `family:read` | Reads. 29 February is celebrated on 1 March in other years |
| `add_birthday` | Add a birthday: a name, the date (the year may be left out, and then no age is shown), optionally the family member it belongs to, and how many days ahead to remind (0 to 60, 7 if not said) | `birthdays:write` | Adds. A birth year of this year or a future date is refused; the assistant is told never to invent a year |
| `update_birthday` | Change a birthday's name, date, family member or reminder | `birthdays:write` | Changes. The previous value is not kept |
| `delete_birthday` | Delete a birthday | `birthdays:write` | Changes. Goes to the recycle bin; `restore_birthday` brings it back |

> "Grandma's birthday is 14 March, remind us two weeks before." ·
> "Omas Geburtstag ist am 14. März, erinner uns zwei Wochen vorher."
>
> "How old will Mia be?" · "Wie alt wird Mia?"

See [Birthdays](Birthdays).

## Countdowns

| Tool | What it does | Permission | Notes |
|---|---|---|---|
| `list_countdowns` | The countdowns on the countdown widget, the soonest first, with how many days are left | `family:read` | Reads. Passed dates are not listed |
| `add_countdown` | Add a countdown: a title of up to 60 characters, a date (today or later) and one of the widget's seven icons (🎉 🎄 🎂 🏖️ 🎒 🚗 ⭐) | `calendar:write` | Adds. Two added at the same moment are both kept, but a screen saving an out-of-date list can still drop one. It disappears by itself once the date has passed |
| `delete_countdown` | Take a countdown off the widget | `calendar:write` | Changes. Permanent: countdowns have no recycle bin |

> "Add a countdown to the summer holidays on 23 July." ·
> "Mach einen Countdown bis zu den Sommerferien am 23. Juli."
>
> "How many days until we go on holiday?" · "Wie viele Tage noch bis zum Urlaub?"

## Pocket money

| Tool | What it does | Permission | Notes |
|---|---|---|---|
| `list_pocket_money` | Each child's pocket money: balance, what they've saved in total, their allowance, and their saving goals with how far along each one is | `family:read` | Reads. Only children with a pocket money account |
| `book_pocket_money` | Ask to add money to a child's pocket money or take some out: 0.01 to 500 at a time, at most two decimals, with an optional note of up to 100 characters | `pocket_money:write` | Adds, **after confirmation**. Nothing is booked until a family member allows it on a Kinboard screen with the settings PIN. A withdrawal larger than the balance is refused. Once booked, a mistake needs a booking the other way |
| `get_action_status` | What became of a booking, a reward decision (or a home action) that waited for confirmation | `pocket_money:write` or `home:control` | Reads. Only this connection's own requests |

> "Give Enno €5 pocket money for mowing the lawn." ·
> "Gib Enno 5 € Taschengeld fürs Rasenmähen."
>
> "How much has Mia saved for her bike?" · "Wie viel hat Mia schon für ihr Fahrrad gespart?"

How the confirmation looks on the screens: [Permissions and
safety](AI-Assistants-Permissions-and-Safety#confirmation-on-the-screens).
See also [Pocket Money](Pocket-Money).

## Points, creatures and rewards

| Tool | What it does | Permission | Notes |
|---|---|---|---|
| `get_rewards` | For each child with a creature: the points they can spend, have earned, owe and have waiting, and their creature's species and stage, with the stage's name in your language and how far it is to the next one. Also the family's rewards and the requests waiting for a parent, each with its id | `family:read` | Reads. Never the creature's name or how it looks; those stay on the family's own screens |
| `request_reward` | Ask for a reward for a child, as the child's own *Redeem* does. The child is named by name or id, the reward by title or id | `pocket_money:write` | **Only asks.** Nothing is spent until a parent approves it with the settings PIN in Settings → Creatures & rewards, and a parent may decline it. The parents' phones are told. Refused when the child has no creature or not enough points left over after what is already waiting. An assistant can't approve or decline a request itself; `decide_reward_request` asks a parent to |
| `decide_reward_request` | Ask a parent to approve or decline one of the requests waiting for a parent, by its id from `get_rewards` | `pocket_money:write` | **After confirmation.** Nothing is approved or declined until a parent allows it on a Kinboard screen with the settings PIN; anyone at the screen may refuse it, and it expires after 2 minutes. It then counts exactly as if the parent had pressed Approve or Decline in Settings → Creatures & rewards. Refused when the request was already answered in Kinboard, when a decision on it is already waiting, or, to approve, when the child no longer has the points. Refunds stay in the app |

> "How many points does Mia have?" · "Wie viele Punkte hat Mia?"
>
> "Mia would like an hour of Minecraft." · "Mia möchte eine Stunde Minecraft."
>
> "What stage is Ben's dragon at?" · "In welcher Stufe ist Bens Drache?"
>
> "Approve Mira's 30 minutes of tablet time." · "Genehmige Miras 30 Minuten Tablet-Zeit."

How a request reaches the parents: [Permissions and
safety](AI-Assistants-Permissions-and-Safety#rewards).

## Recycle bin

| Tool | What it does | Permission | Notes |
|---|---|---|---|
| `list_deleted_items` | What's in the recycle bin that an assistant can bring back: deleted tasks, notes, meal plan entries and birthdays, newest first | `family:read` | Reads. At most 50 |
| `restore_task` | Bring a deleted task back, exactly as it was | `tasks:write` | Adds |
| `restore_note` | Bring a deleted note back | `notes:write` | Adds |
| `restore_meal` | Bring a deleted meal plan entry back | `meals:write` | Adds |
| `restore_birthday` | Bring a deleted birthday back | `birthdays:write` | Adds |

An assistant can never empty the bin or erase anything in it for good. The
bin empties itself after the family's retention period, as it always does.

> "Undo that, bring the note back." · "Mach das rückgängig, hol die Notiz zurück."

See [Recycle bin](Recycle-Bin).

## Messages on the screens and the attention panel

| Tool | What it does | Permission | Notes |
|---|---|---|---|
| `send_message` | Put a message of up to 200 characters on every Kinboard screen and push it to every phone, marked **via** the assistant's name | `announcements:write` | Adds. At most 5 per 10 minutes per connection. It interrupts whoever is looking at a screen |
| `list_screen_messages` | The 20 newest messages on the screens, whether someone has seen each, and which assistant sent one | `family:read` | Reads |
| `acknowledge_message` | Mark a message as seen, like tapping "Got it", so it leaves every screen | `announcements:write` | Changes. Cannot be undone. If someone already tapped it, theirs stands |
| `list_attention_items` | The hints the attention panel is showing now ("Rain likely today"), most important first, in the family's language | `family:read` | Reads. A hint from Home Assistant, such as doors still open at bedtime, only says how many unless the connection also has `home:read` |
| `dismiss_attention_item` | Take a hint off the panel, as tapping OK on it does | `tasks:write` | Changes. The screens drop it within a few minutes. It comes back if the situation arises again |

> "Tell everyone dinner is ready." · "Sag allen, dass das Essen fertig ist."
>
> "Any new messages on the board?" · "Gibt es neue Nachrichten auf dem Board?"

See [Messages](Messages).

## Weather

| Tool | What it does | Permission | Notes |
|---|---|---|---|
| `get_weather_forecast` | The weather now, today's forecast in 3-hour steps, and each day for about five days ahead: lowest and highest temperature, the condition, and the chance of rain as a percentage (0% included). The same forecast the Weather widget shows | `family:read` | Reads. Always the place chosen under **Settings → Weather**, in the units chosen there; the assistant cannot ask about another town. Days are your family's days, in your time zone. Shares the widget's cached forecast instead of fetching a copy of its own |

> "Will it rain on the school trip on Thursday?" · "Regnet es am Donnerstag beim Schulausflug?"
>
> "Do the kids need a jacket this afternoon?" · "Brauchen die Kinder heute Nachmittag eine Jacke?"

If weather isn't set up yet (no location chosen, or no OpenWeatherMap key on
the server), the assistant says so instead of guessing. See
[OpenWeatherMap](OpenWeatherMap).

## Energy

| Tool | What it does | Permission | Notes |
|---|---|---|---|
| `get_solar_production` | Current solar power and today's solar energy. Today's energy is the change since midnight in the family's time zone, as on the Energy page; `total` is the counter's raw state | `energy:read` | Reads. Only the sensors chosen under **Settings → Energy** |
| `get_energy_status` | The whole energy picture: solar, battery, grid and home power right now, today's energy in and out (the change since local midnight, with the raw counter as `total`), and the battery's charge | `energy:read` | Reads. Only the sensors chosen under **Settings → Energy** |

"Today" is the change since midnight in the family's time zone, taken from
Home Assistant's statistics: the figure the Energy page shows. Each reading
also carries the counter's raw state as `total`, and the assistant is told
never to report that as today's figure. If Home Assistant has no statistics
for a sensor, today's figure is left empty with a reason rather than guessed.
See [Troubleshooting](AI-Assistants-Troubleshooting#energy-today-looks-wrong-or-is-missing).

> "How much did the panels make today?" · "Wie viel hat die Solaranlage heute erzeugt?"
>
> "Is the house battery full?" · "Ist der Hausakku voll?"

## Home

| Tool | What it does | Permission | Notes |
|---|---|---|---|
| `list_home_devices` | The devices in the family's catalogue, with their name, room, state and the actions each is allowed, each marked sensitive or not | `home:read` | Reads. Devices outside the catalogue are not visible |
| `get_device_state` | One catalogue device's state and allowed actions | `home:read` | Reads. A device outside the catalogue is reported as not found |
| `control_device` | Run an allowed action on a catalogue device: turn a light on and dim it, set a thermostat, pause the music, close a blind | `home:control` | Changes, outside Kinboard: it acts on the real home and can't be undone. Most actions run immediately; a sensitive one (a lock, an alarm, a garage door, a scene, a script…) waits for a family member to allow it with the settings PIN. At most 2 waiting and 5 per 10 minutes per connection |
| `get_action_status` | Whether a sensitive action that waited for confirmation was allowed, denied or expired, and whether it ran | `home:control` or `pocket_money:write` | Reads. Only `done` means it ran. Listed under Pocket money too |

> "Turn the living room lights down to 30 per cent." ·
> "Dimm das Wohnzimmerlicht auf 30 Prozent."
>
> "Set the bathroom to 22 degrees." · "Stell das Bad auf 22 Grad."
>
> "Lock the front door." · "Schließ die Haustür ab." (waits for someone to
> allow it on a screen)

Which actions run immediately and which wait:
[Permissions and safety](AI-Assistants-Permissions-and-Safety#home-assistant-devices).
A device the assistant can't find:
[Troubleshooting](AI-Assistants-Troubleshooting#the-assistant-cant-see-a-device).

## Vehicles

| Tool | What it does | Permission | Notes |
|---|---|---|---|
| `list_vehicles` | Each car's charge level, range and charging status, plus temperature, locks, doors, windows and odometer where the car reports them: the same readings as the Vehicles page | `vehicles:read` | Reads, from Home Assistant; values may be a few minutes old. **Never the car's location** |

> "What's the Tesla's charge level?" · "Wie ist der Ladestand vom Tesla?"
>
> "Is the car plugged in?" · "Hängt das Auto am Ladekabel?"

See [Vehicles](Vehicles).

## All tools by permission

| Permission | Tools |
|---|---|
| `family:read` | `get_family_summary`, `get_next_birthday`, `list_calendar_events`, `search_calendar_events`, `list_writable_calendars`, `list_people`, `get_school_timetable`, `list_tasks`, `list_shopping_items`, `get_meal_plan`, `search_recipes`, `get_recipe`, `list_timers`, `list_birthdays`, `list_countdowns`, `list_pocket_money`, `get_rewards`, `list_deleted_items`, `list_screen_messages`, `list_attention_items`, `get_weather_forecast` |
| `notes:read` | `list_notes` |
| `calendar:write` | `create_calendar_event`, `update_calendar_event`, `delete_calendar_event`, `add_countdown`, `delete_countdown` |
| `tasks:write` | `create_task`, `complete_task`, `reopen_task`, `update_task`, `delete_task`, `restore_task`, `dismiss_attention_item` |
| `shopping:write` | `add_shopping_item`, `check_shopping_item`, `uncheck_shopping_item`, `rename_shopping_item`, `delete_shopping_item`, `add_recipe_to_shopping_list` |
| `notes:write` | `create_note`, `update_note`, `delete_note`, `restore_note` |
| `meals:write` | `add_meal`, `remove_meal`, `restore_meal`, `create_recipe` |
| `announcements:write` | `send_message`, `acknowledge_message` |
| `energy:read` | `get_solar_production`, `get_energy_status` |
| `home:read` | `list_home_devices`, `get_device_state` |
| `home:control` | `control_device`, `get_action_status` |
| `vehicles:read` | `list_vehicles` |
| `timers:write` | `start_timer`, `stop_timer` |
| `birthdays:write` | `add_birthday`, `update_birthday`, `delete_birthday`, `restore_birthday` |
| `pocket_money:write` | `book_pocket_money`, `get_action_status`, `request_reward`, `decide_reward_request` |

63 tools in all.
