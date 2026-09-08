# RFC-007 — The Automation screen, and one definition of a room

| | |
|---|---|
| **Status** | Draft |
| **Date** | 2026-09-08 |
| **Target release** | unscheduled |
| **Depends on** | RFC-006 (`catalogue_items`), the Home Assistant settings blob, `/api/homeassistant/services` |
| **Source** | Brainstorm 2026-09-08 — M1 of the RFC-006 delivery order |

---

## 1. What this is for

RFC-006 gave the household one list of the things in the house. This makes that
list worth looking at: the Automation screen rebuilt as somewhere you browse
your own home — by room, with the pictures and names you gave things — and
control what you find there.

It also closes a seam RFC-006 opened deliberately and named as a risk.

### 1.1 The redundancy, in the real data

A room can be edited in two places today, and editing one does not touch the
other:

| Surface | What it manages | Stored in |
|---|---|---|
| `/settings/homeassistant/rooms` (640 lines) | room name, icon, colour, order, **and which entities are in it** | `settings.home_assistant → rooms_config` |
| `floating-lights-fab.tsx` (618 lines) | reads those rooms and their entities | the same blob |
| `/settings/catalogue` (674 lines) | each device's **room**, as free text | `catalogue_items.room` |
| `/home-automation` (482 lines) | dashboards of cards — **no rooms at all** | `settings.home_assistant → dashboards` |

On the household this was measured against, the two have already diverged:

```
blob rooms:       Flur (icon book, colour #67f264, 2 entities)
                  Wohnzimmer (icon lamp, no colour, 4 entities)
catalogue rooms:  Carport (1), Flur (2), HWR (4), Wohnzimmer (4)
```

`Carport` and `HWR` exist only in the catalogue — they arrived through the Home
Assistant area import. `Flur` and `Wohnzimmer` exist in both, and only the blob
knows one of them is green. Nothing reconciles them, and nothing ever will,
because they are two independent stores that happen to hold strings that look
alike.

**So this RFC is not primarily a screen.** It is the decision that a room is one
thing, defined once, and the screen is what that makes possible.

---

## 2. Rooms become rows

```sql
CREATE TABLE public.rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  icon TEXT,
  color TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One room per name per household. Case-insensitive, because "Flur" and "flur"
-- are the same hallway and a household that types both wants one room.
CREATE UNIQUE INDEX rooms_family_name_idx
  ON public.rooms (family_id, lower(trim(name)));

ALTER TABLE public.catalogue_items
  ADD COLUMN room_id UUID REFERENCES public.rooms(id) ON DELETE SET NULL;

CREATE INDEX catalogue_items_room_idx ON public.catalogue_items (room_id);
```

**`icon` and `color` are plain text, not enums.** `RoomIcon` is a TypeScript
union of sixteen names (`home`, `sofa`, `utensils`, `washing-machine`…) and the
database has no business enforcing which lucide icons exist. The route validates
against the union; an icon the app no longer ships renders as the default rather
than breaking a row.

**`ON DELETE SET NULL`, not CASCADE.** Deleting a room must not delete the
lamps in it. A device with no room is a supported state — five of the eleven
were in exactly that state after RFC-006's migration — and it is the one the
screen already renders.

**`catalogue_items.room` (text) stays for one release**, unread, exactly as
`rooms_config` did. The same reasoning: a migration that is wrong about a
household's data needs somewhere to have been wrong *from*.

---

## 3. Reconciling two stores that already disagree

The migration runs once, in this order, and it is the only part of this RFC that
can lose something a person typed.

1. **Blob rooms first**, because only they carry icon, colour and order:
   every `rooms_config.rooms[]` entry becomes a `rooms` row, keeping `name`,
   `icon`, `color` and `position`.
2. **Then rooms that exist only as catalogue text** — `Carport`, `HWR` in the
   measured household — become rows with no icon, no colour, and a position
   after the blob's, matched case-insensitively and trimmed so `Flur` does not
   become a second `flur`.
3. **Then every `catalogue_items.room` is resolved to a `room_id`** by the same
   case-insensitive trimmed match. A row whose text matches nothing (it cannot,
   after step 2, but the migration does not assume its own correctness) keeps
   `room_id` null and its text.

`ON CONFLICT DO NOTHING` against the unique index throughout, because this
project applies every migration twice.

**What the blob's `entities[]` is not used for.** Room *membership* already
lives in `catalogue_items.room` — RFC-006 migrated it there from these very
arrays. Reading them again would re-add devices a household has since removed
from the catalogue. The blob's entity lists are ignored, deliberately, and the
catalogue is the only source of which device is in which room.

That is the whole redundancy, resolved in one direction: **the blob describes
rooms, the catalogue describes membership, and after this both live in tables
and the blob describes nothing.**

---

## 4. What retires, and what has to be rebuilt with it

Closing the seam means three existing surfaces change. None may be left reading
`rooms_config`.

- **`/settings/homeassistant/rooms`** is rewritten against the `rooms` table:
  add, rename, icon, colour, reorder, delete. It **loses** its entity-assignment
  UI — which device is in which room is the catalogue's job now, and having it
  in both places is the bug this RFC exists to fix. The page links to the
  catalogue for that.
- **`floating-lights-fab.tsx`** reads rooms from the table and membership from
  the catalogue. Its behaviour does not change; its source does.
- **`/home-automation`** is the rebuild described in §5.

**`rooms_config` and `dashboards` are then read by nothing** and can be dropped
from the blob in a later release, together with `dashboard_cards` — one deletion
covering everything RFC-006 and this RFC displaced.

---

## 5. The screen

Browse the house the way it is laid out.

**Rooms are the top level**, in the household's order, each with its icon and
colour. A room shows its devices as tiles: the picture from the catalogue, the
name the household gave it, and the current state underneath. Devices with no
room fall into a final group; a household that never sets a room gets one flat
list and nothing looks broken.

**A tile is a control where the domain has an obvious one.** `light`, `switch`,
`input_boolean`, `fan` toggle. `lock` locks and unlocks. `cover` opens and
closes. `media_player`, `climate`, `vacuum` open a detail sheet rather than
guessing which of their many actions a tap meant. Everything else — `sensor`,
`binary_sensor`, `person`, `weather` — renders as a reading and is not tappable.
The domain comes from the entity id's prefix, which is the one thing about a
Home Assistant entity that never lies.

**Control goes through `/api/homeassistant/services`**, which already exists and
already takes `{ domain, service, entity_id }`. This RFC adds no new way to
reach Home Assistant.

**Optimism has a limit.** A tap flips the tile immediately, then reconciles
against the next state poll. If the service call fails, the tile goes back and
says so. A wall panel that shows a light as on when it is off is worse than one
that takes a second to catch up.

**What the dashboards concept becomes.** Nothing. Hand-built dashboards of cards
are replaced by the room layout, and `dashboards` retires with `rooms_config`.
A household that arranged one loses that arrangement — which is the cost of the
option chosen, and is stated here rather than discovered.

---

## 6. Failure handling

| What fails | What happens |
|---|---|
| Home Assistant unreachable | Rooms, devices, names and pictures all still render — they are ours. Every state shows as unavailable and controls are disabled. The list is ours; the values are theirs. |
| A service call fails or times out | The optimistic flip reverts and the tile says it did not go through. Nothing is retried automatically: a lock that silently retries is worse than one that reports failure. |
| An entity is in the catalogue but gone from Home Assistant | Renders as unavailable, stays in its room. RFC-006 §6 already fixes this: a device unplugged for a week must not need re-adding. |
| A room is deleted | Its devices lose `room_id` and appear in the unroomed group. Nothing is deleted with it. |
| Two rooms differing only in case or spacing | Impossible after the unique index; the migration folds them and the route rejects the second. |
| The migration meets a blob room with no name | Skipped. A room with no name is not a room, and the CHECK would abort the statement for every household — the failure mode RFC-006 §6 was taught by. |

---

## 7. Testing

**The migration, against a seeded database**, as in RFC-006 §7 — it is SQL and
is tested where it runs. The cases that decide whether a household's rooms
survive: a blob room with icon and colour; a catalogue room that exists only as
text; the same name in both, differing in case; the same name differing in
trailing whitespace; a blob room with no name; a catalogue room matching
nothing; and **two families in one run where one has a poisoned blob** — the
property whose absence takes the container down, learned from RFC-006.

**Applying it twice changes nothing**, proven with `ON_ERROR_STOP` so a second
pass that errors fails loudly rather than rolling back quietly and looking
identical to a no-op.

**A browser guard** that the Automation screen renders a room, its devices, and
a working toggle — and that a device with no room still appears. A screen that
renders nothing passes every test that only asserts absence.

**Every assertion proven to fail.** On this project a guard shipped whose
"prove it fails" step exercised a different assertion; a sabotage behind a
condition false in the test never runs; a time-based sabotage of a component
that has stopped re-rendering never fires. All three happened. Check the
sabotage reached the code before believing a green run.

---

## 8. Out of scope

- **Any new way to talk to Home Assistant.** Service calls go through the route
  that exists.
- **Scenes, scripts and automations as first-class things.** They are entities
  and will render as such; orchestrating them is not this.
- **Grouping devices below a room** ("the lamps by the sofa").
- **Dropping `rooms_config`, `dashboards` and `dashboard_cards` from the blob** —
  one release later, all together.
- **Status cards on the dashboard** — M2, unchanged by this.

---

## 9. Open risks

- **This deletes a concept a household is using.** Hand-built dashboards go
  away. On the measured household there are two, and their cards were already
  migrated into the catalogue by RFC-006, so no device is lost — but the
  arrangement is.
- **The rooms page loses entity assignment**, which is where a household
  currently does that job. If the catalogue is not obviously the place for it,
  this reads as a feature removal rather than a consolidation. The rooms page
  linking to it is the whole mitigation, and it is thin.
- **Optimistic control on a shared board.** Two people tapping the same lamp
  from two screens will briefly disagree. The state poll settles it, and the
  window is about a second, but on a wall panel a second of wrong is visible.
