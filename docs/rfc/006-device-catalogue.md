# RFC-006 — Device catalogue

| | |
|---|---|
| **Status** | Draft |
| **Date** | 2026-09-08 |
| **Target release** | unscheduled |
| **Depends on** | the Home Assistant settings blob (`settings.home_assistant`), Supabase Storage, `lib/safe-image-search.ts` |
| **Source** | Brainstorm 2026-09-08, from the magicframe.dev competitive review |

---

## 1. What this is for

Getting "the front door is unlocked" or "the washing machine has finished" onto
the board currently means **writing a plugin**. Seven exist — vehicles, energy,
cameras, stonks, pocket money, photos, media — and each is a folder of code. A
household cannot point at a thing in their own house and say *show me that*.

This is the foundation for two surfaces that both need to: the Automation screen
rebuilt as something worth looking at, and status cards on the dashboard.

**Checked before writing this, and it changed the design.** The catalogue is not
missing. It exists twice, both inside `settings.home_assistant`:

| | shape | drives |
|---|---|---|
| `RoomConfig.entities` | `RoomEntity { entity_id, display_name?, position }` | the rooms settings page (640 lines) and the lights FAB (618 lines) |
| `Dashboard.cards` | `DashboardCard { entity_id, display_name?, card_type, position, size, show_graph?, graph_period? }` | the Automation screen (482 lines) |

Both are "an HA entity, a name, an order", written twice and kept in step by
hand. A dashboard card has no room; a room entity has no card type. Adding a
device to your house means adding it in two screens, and nothing stops the two
names disagreeing.

So this RFC does not invent a concept. It gives the one that already exists a
table, one definition per device, and the two things neither copy has: an image,
and a kind that is not necessarily a Home Assistant entity.

(RFC-003 opened by asserting a gap that turned out not to exist, and RFC-005
opened by proving one did. This one found the opposite of what it expected and
says so.)

---

## 2. What a catalogue row is

One **thing the household cares about**. Not one device — Home Assistant's
device and area registries are WebSocket-only, and Kinboard talks to
`/api/states`, which returns flat entities. Entities are what we can actually
read, so entities are what we model.

```sql
CREATE TABLE public.catalogue_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,

  -- What it points at. Exactly one of these is meaningful, per `kind`.
  kind TEXT NOT NULL CHECK (kind IN ('ha_entity', 'builtin')),
  entity_id TEXT,          -- kind = 'ha_entity'
  builtin_key TEXT,        -- kind = 'builtin'

  -- How it is presented. All of this is the household's, not Home Assistant's.
  name TEXT NOT NULL,
  room TEXT,
  image_url TEXT,
  position INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT catalogue_items_target CHECK (
    (kind = 'ha_entity' AND entity_id IS NOT NULL AND builtin_key IS NULL) OR
    (kind = 'builtin'   AND builtin_key IS NOT NULL AND entity_id IS NULL)
  )
);

CREATE UNIQUE INDEX catalogue_items_family_entity_idx
  ON public.catalogue_items (family_id, entity_id) WHERE entity_id IS NOT NULL;
CREATE UNIQUE INDEX catalogue_items_family_builtin_idx
  ON public.catalogue_items (family_id, builtin_key) WHERE builtin_key IS NOT NULL;
CREATE INDEX catalogue_items_family_position_idx
  ON public.catalogue_items (family_id, position);
```

**`kind` is what lets two surfaces share one table.** An `ha_entity` row points
at Home Assistant. A `builtin` row points at something Kinboard already knows —
the next bin collection, how many tasks are overdue, whose birthday is next.
Both get the same naming, the same room, the same image and the same picker, and
neither surface has to care which it is rendering. A third kind, a polled URL,
is M3 and deliberately not in this schema yet: adding a column later is cheaper
than designing auth and failure handling for it now.

**The unique indexes are the point of the table.** One row per entity per
family. Today the same entity can sit in a room under one name and on a
dashboard under another, and nothing notices.

**`name` is `NOT NULL`, unlike both structures it replaces.** `display_name` was
optional in each, so every consumer falls back to the entity's own friendly name
at render time, in its own way. Resolving it once on import means one name, and
a household that renames a device renames it everywhere.

**`room` is plain text, not a foreign key.** Rooms are a household's word for a
place, they are typed in a settings screen, and a `builtin` row can have one too
— "the bin" belongs in the hall as much as a lamp does. A table of rooms buys
referential integrity over a value that has no behaviour attached to it.

**No cached state, ever.** The catalogue stores a pointer and a presentation.
What a lamp is doing right now comes from `/api/states` at render time, as it
does today. A stale copy of a lock's state on a wall display is worse than no
lock on the wall display.

### 2.1 Two things that will silently break this

- `'catalogue_items'` must be added to the hardcoded `direct_tables` array in
  `webapp/docker/migration_zz_row_level_security.sql`. A table missing from that
  array gets **no policy at all**, and the anon key reads every family's rows.
  This has shipped here before.
- The migration must add the table to the `supabase_realtime` publication,
  idempotently and qualified with `schemaname='public'`. A subscription to an
  unpublished table is silent, not an error — `timers` shipped that way, working
  on one machine and dead everywhere else. `e2e/realtime-publication.spec.ts`
  now fails when a subscribed table is not published.

---

## 3. Migrating what already exists

Real households have rooms and dashboards configured in that blob, and 1,740
lines of UI read them. Nothing may be lost.

### 3.1 One direction, once, idempotent

A migration runs over each family's `settings.home_assistant` and writes
`catalogue_items`:

- every `RoomConfig.entities[]` entry → a row, `kind='ha_entity'`, `room` set to
  that room's `name`, `name` from `display_name` or the entity id's friendly
  part, `position` carried across;
- every `Dashboard.cards[]` entry whose `entity_id` is **not** already a row →
  a row with no `room`;
- a card whose entity already has a row from a room → **not** a second row. The
  room's name wins, because the rooms page is where a household names things
  deliberately and the dashboard is where they get added in a hurry.

`ON CONFLICT DO NOTHING` against the unique indexes makes a second pass a no-op,
which matters because this project applies every migration twice by design.

**It is a SQL migration, not application code.** Migrations here are `.sql`
files applied by the webapp container's entrypoint in filename sort order; there
is no TypeScript migration runner to borrow. The blob is `jsonb`, so the
transformation is `jsonb_array_elements` over `rooms_config -> 'rooms'` and then
over each room's `entities`, and again over `dashboards -> 'cards'`. That is
ordinary SQL, and it keeps this change inside the one mechanism that already
reaches every installation.

**Ordering across two sources needs a rule, or it is arbitrary.** Room entries
keep their `position`. A dashboard-only entry is appended after the highest
position already written for that family, in its own card order. Interleaving
two independent sequences that both start at zero would scramble both.

### 3.2 What the blob keeps, and what it loses

The blob keeps `url`, `access_token`, `last_connected`, `energy_config`,
`tesla_config` — none of that is a catalogue.

`rooms_config` and `dashboards` stay in place, read by nothing, for one release.
Deleting a household's configuration in the same change that migrates it leaves
no way back if the migration is wrong about their data, and we will not know
that until it has run on somebody's real house. A later release drops them.

**Room ordering, icons and colours are not in `catalogue_items`.** `RoomConfig`
carries `icon`, `color` and `position` per room, and a text column on an item
cannot hold them. They stay in `rooms_config` for now and get their own table
when the rooms UI is rebuilt — this RFC deliberately does not rebuild it. The
consequence is honest and worth stating: after this lands, room *presentation*
still comes from the blob while room *membership* comes from the table.

### 3.3 Rooms can be pre-filled from Home Assistant

Nothing calls HA's template API today, but we hold a URL and a long-lived token,
so one `POST /api/template` rendering `areas()`, `area_name()` and
`area_entities()` returns the household's areas and their entities in a single
request — no WebSocket client, no new credential.

This is an **import convenience, offered once**, not a sync. Kinboard's room is
the household's word, and a household that renames a room here must not have it
renamed back. If the call fails, nothing breaks: rooms are typed, as they are
today.

---

## 4. Images

Search-first, the same flow as shopping item photos: type what the thing is,
pick from results. It is the fastest way to populate a whole house, which is the
point of the screen this feeds.

**With upload and paste behind it, always.** `lib/safe-image-search.ts` carries
its own post-mortem: the scrapers it used to call rotted upstream and began
serving results unrelated to the query. A wall display showing a confident photo
of somebody else's washing machine is worse than one showing no photo, and
"searching for a Hue bulb" is a different query shape from "searching for milk",
which is what that module was tuned for. The escape hatch is not hedging against
the choice; it is the thing that makes the choice safe to make.

Uploads follow the existing pattern exactly — `POST` to an upload route, into a
Supabase Storage bucket, returning a URL built by `publicStorageUrl` rather than
`getPublicUrl` (which derives a `kong:8000` base the browser cannot resolve).
Buckets today are `recipe-images`, `vehicle-images` and `goal-images`; this adds
`device-images`.

`image_url` is nullable and every surface must render without one. Most
households will image the handful of devices they look at and leave the rest.

---

## 5. What this deliberately is not

- **Not a rules engine.** No thresholds, no "red below 20%". Anything that needs
  to interrupt belongs to the attention engine, which raises hints and can
  explain why it raised them. Two parallel answers to "why is the board showing
  me this" is the outcome worth avoiding.
- **Not control.** The catalogue says what exists and what it is called. Turning
  a lamp off is the Automation screen's job (M1).
- **Not a mirror of Home Assistant.** No cached states, no device registry, no
  attempt to be a second source of truth about the house.
- **Not the rooms rebuild.** Room icons, colours and ordering stay where they
  are; see §3.2.

---

## 6. Failure handling

| What fails | What happens |
|---|---|
| Home Assistant unreachable | The catalogue still lists every device with its name, room and image; states render as unknown. The list is ours, the values are theirs. |
| The `areas()` template call fails or the token lacks scope | Rooms are typed by hand, exactly as today. The import is a convenience, never a dependency. |
| An entity disappears from Home Assistant | The row stays. A device unplugged for a week should not need re-adding, and silently deleting a household's naming and image because an integration blinked is not recoverable. The surfaces show it as unavailable. |
| Image search returns nothing, or nonsense | Upload and paste are always present; `image_url` stays null and every surface renders without it. |
| The migration runs twice | `ON CONFLICT DO NOTHING` against the unique indexes. Required, not defensive: migrations are applied twice here by design. |
| A household edits `rooms_config` after migrating | Their edit is invisible, because nothing reads it any more. This is the sharpest edge in the change and the reason the blob is kept for a release rather than deleted. |

---

## 7. Testing

**The migration, against a seeded database.** It is SQL (§3.1), so it is tested
where it runs: insert a `settings.home_assistant` blob, apply the migration,
assert the rows. The cases that decide whether somebody's house survives the
upgrade are all here, and each is one seeded blob:

- a room entity with a `display_name`, and one without;
- a dashboard card for an entity **already** in a room — one row, and the room's
  name is the one that survives;
- a dashboard card for an entity in no room, appended after the room entries
  rather than interleaved;
- an empty blob, a blob with no `rooms_config`, a blob with no `dashboards`;
- a family with no `home_assistant` settings row at all;
- the same blob applied twice, producing identical rows.

Seeding a blob and reading back rows is a `psql` heredoc — note the `-i` on
`docker exec`, without which the heredoc goes nowhere and the silence is
indistinguishable from success.

**RLS, proven two-sided.** The anon key reads the row through Kong before the
policy exists and `[]` after, with the row still present. Not inspected — run.

**Every assertion proven to fail.** Not one representative of them. On this
project a browser guard shipped whose "prove it fails" step exercised a
different assertion in the same test; a sabotage placed behind a condition that
is false in the test never runs; and a time-based sabotage of a component that
has stopped re-rendering never fires. All three happened. Check the sabotage
reached the code before believing a green run.

---

## 8. Out of scope, and the milestones after this

- **M1 — the Automation screen**, rebuilt over the catalogue: browse by room,
  device images, control. The screen this foundation exists to make possible.
- **M2 — status cards** on the dashboard: tiles over the same catalogue, plus
  `builtin` rows for Kinboard's own values. At-a-glance only, per §5.
- **M3 — polled endpoints** as a third `kind`. Its own auth, formats and failure
  modes; deliberately not designed here.
- **The rooms rebuild** — icons, colours and ordering out of the blob and into
  their own table.
- **Dropping `rooms_config` and `dashboards`** from the blob, one release after
  this.

---

## 9. Open risks

- **The migration runs on real houses.** It is the only part of this that can
  lose something a person typed. It is one-way, it is idempotent, and the source
  data is left in place for a release — but it will still meet blobs shaped in
  ways this RFC has not seen, and the pure tests in §7 are the defence.
- **Two names for one place, for a while.** Room membership moves to the table
  while room presentation stays in the blob (§3.2). That seam is temporary by
  intent and confusing while it lasts.
- **Search quality is not ours.** Device image search leans on a module whose
  own comment documents it rotting once. If it rots again the feature degrades
  to upload-only, which is why upload is not optional.
