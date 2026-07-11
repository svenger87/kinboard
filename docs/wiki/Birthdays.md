# Birthdays

The `/birthdays` page — family + extended-family birthday tracking with countdown + a year-ring visualization.

![Birthdays — year ring visualization + chronological list](images/birthdays-year-ring.png)

## Adding birthdays

Tap **+ Add birthday** on the page or via Settings → Family members → people who have a birthday recorded show up automatically.

Birthday entry asks for:

- **Name**
- **Date** — full date including year (year used for "turning N" math)
- **Person** (optional) — if this birthday is for an existing family member, link to their row to inherit color
- **Photo** (optional) — shown on the hero card, the year-ring dot, and the list, instead of the linked person's avatar
- **Notes** (optional) — gift ideas, what they like, allergies for kid party invites

Birthdays without a linked person stay separate from the family-member list. Useful for:

- Grandparents who aren't on the dashboard but you want to remember
- Friends and extended family
- Children's classmates whose parties you need to plan around

## Year ring

The headline UI element: a circular SVG showing 12 month sectors, today as a tick mark, and one colored dot per upcoming birthday positioned by date. Birthdays in the next 30 days are larger + show the person's name.

<img src="images/birthdays-year-ring.png" alt="Birthdays year-ring view: monthly arc with upcoming birthdays" width="420"/>

The center shows the total count of tracked birthdays.

## List view

Below the ring: a chronologically-sorted list of birthdays, **starting from today and wrapping to next year**. Each card shows:

- Avatar / colored dot
- Name + age the person is turning
- Date (formatted per locale)
- Days until / "Today!" / "Tomorrow"
- Linked notes (gift ideas, etc.)

The first card (closest birthday) is enlarged for emphasis.

## Dashboard integration

The dashboard's **birthday widget** surfaces:

- The **next 3** upcoming birthdays
- A "🎂 happening today" banner if anyone has a birthday today

The today-strip ribbon also shows birthday names if today's the day.

## Reminders

Push notifications for birthdays: enable the per-device toggle in **Settings → Notifications**, then set how much lead time you want per birthday — each birthday entry has its own **notify N days before** field, so a birthday that needs gift-shopping time can get a week's notice while others get a same-day nudge. Runs on the same cron infra as the [todo daily digest](Notifications#server-side-cron) and respects quiet hours. See [Notifications → Birthday reminders](Notifications#birthday-reminders).

You can also add a Google Calendar entry the day before any birthday and it'll show up via the regular [Calendar](Calendar) events flow if you want it integrated with the calendar widget too.

## Persistence

- Stored in `public.birthdays`
- One row per birthday (not aggregated by person)
- Real-time published — adding on a phone updates the ring on the kitchen wall in ~1 s
- Deleting a birthday shows an "Undo" toast that restores it exactly as it was

## Patterns that work well

- **Visual cue for kid parties:** the year ring makes it easy to see "oh there's two birthdays in May, plan accordingly"
- **Gift idea capture:** the notes field is a year-round dumping ground for ideas — "she liked the puzzle book at Anna's house, would be a good 8th-birthday gift"
- **Extended-family awareness:** add aunts/uncles/cousins so the kids learn to remember them too

## What's not supported

- **Anniversaries** (wedding, etc.) — workaround: add as a birthday with a date, name them "Wedding anniversary"
- **Birthday cards / message generation** — out of scope

## Related

- [People-and-Devices](People-and-Devices) — link birthdays to family members for color matching
- [Calendar](Calendar) — birthdays also appear as all-day events on the calendar
- [Dashboard](Dashboard) — birthday widget
