# RFC-001 — Kinboard Integration API v1

| | |
|---|---|
| **Status** | Draft — not yet published |
| **Date** | 2026-08-08 |
| **Target release** | v1.9 (“Kinboard for Home Assistant”) |
| **Depends on** | v1.8 Reliability Foundation |
| **Source** | *Produktvision und Implementierungsplan 2026*, §3, §6, §9 |

---

## 1. What this is for

The 2026 plan makes Kinboard a **Family Context Layer**: it should answer “what
must our family know or do now?”, and connect that to the state of the house.
Building block A is a bidirectional Home Assistant integration in which Kinboard
is not only a consumer of HA entities but a **supplier of data, services and
events** to HA.

Everything downstream needs the same foundation: the Heute-Motor (building
block B) consumes the same normalised signals, and the Bridge (building block C)
speaks the same contract from outside the house. So this API is built once, for
three consumers.

This RFC fixes the contract. It does not implement it.

---

## 2. The constraint that shapes the whole design

**Kinboard has no single write path.** This was measured against `main` at
`04cf1ea`, not assumed:

| Write path | Files | What lives there |
|---|---:|---|
| Browser → PostgREST directly (`@/lib/supabase/client`, `"use client"`) | **20** | birthdays, calendar, shopping, meals, notes, recipes — the core family features |
| Server-side (`@/lib/supabase/server`) | 48 | API routes, cron jobs, integrations |

The plan (§6.4) says writes should produce domain events through a transactional
outbox. Read literally as “the API layer writes an outbox row”, that design
**would miss most of the events it exists to produce**. `kinboard_shopping_item_added`,
`kinboard_task_completed` and `kinboard_family_event_created` are precisely the
actions performed by those 20 browser-side components. A parent ticking off a
task on the kitchen tablet does not traverse a Next.js route handler.

Rewriting seventeen-to-twenty call sites onto a server API purely to gain events
would be a large, risky refactor of the most-used code in the product, and it
would have to stay rewritten forever.

### 2.1 Decision: events are produced by the database

`domain_events` is populated by **`AFTER INSERT/UPDATE/DELETE` triggers**, not by
application code. The database is the only layer every write passes through, so
it is the only place a guarantee can be made.

This is not a novel bet. The recycle bin (v1.8) reached the same conclusion for
the same reason and is running in production today: a `BEFORE DELETE` trigger
plus an RLS predicate, with **no call site changed**. That work also surfaced the
traps this design inherits, and they are handled in §6.3.

**Consequences, stated honestly:**

- Event payloads are built in PL/pgSQL, not TypeScript. Less pleasant to write,
  and it needs its own tests.
- `actor_id` is not naturally available to a trigger. See §6.4.
- Business-level events that are not a row change (“announcement acknowledged”)
  still need an explicit emit path. A `kinboard.emit_event()` function is
  provided for those, so there is exactly one writer either way.

---

## 3. Surface

All external surface lives under **`/api/integration/v1`** as Next.js route
handlers in the existing webapp. No new deployable in v1 — the Bridge is a
separate process later, and it will speak this same API.

Principles (§6.2), with the reasoning that matters:

- **Strict schemas, explicit version in the path.** `v1` never changes shape.
- **Cursor-based sync**, not repeated full queries. Consumers pass the last
  `event_id` they processed.
- **Idempotency-Key required on every write.** HA automations retry; a retried
  “add milk” must not add milk twice.
- **`ETag` / `updated_at` for conflict detection** on updates.
- **No external dependency on internal Supabase tables.** Today a consumer would
  have to know the schema; after this, the API is the contract and the schema is
  free to move.
- **WebSocket/SSE for live connections**, webhooks optional and local-only.

---

## 4. Authentication

A dedicated **integration token**, distinct from the join code, the settings PIN
and any device session — those are family-member credentials and must not be
reusable as machine credentials.

- Generated in Settings, shown **once**, stored only as a hash.
- Carries explicit scopes: `family:read`, `shopping:write`, `tasks:write`,
  `notes:write`, `announcements:write`, `events:read`.
- Individually revocable and rotatable, with `last_used_at` so a stale token is
  visible before it is revoked.
- Scope enforcement is **one shared server function**, not a check per route.
  Per-route checks drift; this one gets negative tests (§10).

---

## 5. The frozen contract

Week 1 of the plan requires the names to be settled before code exists, because
they become public API the moment someone writes an automation against them.
These are fixed by this RFC.

### 5.1 Entities Kinboard publishes to HA

| Entity | Carries |
|---|---|
| `sensor.kinboard_next_family_event` | title, start, person, location, minutes remaining |
| `sensor.kinboard_events_today` | count + compact attribute list |
| `sensor.kinboard_shopping_items` | open item count |
| `sensor.kinboard_meal_today` | planned meal + recipe reference |
| `sensor.kinboard_tasks_due` | open and overdue counts |
| `sensor.kinboard_school_tomorrow` | affected children, first lesson |
| `sensor.kinboard_birthdays_upcoming` | next birthday, days remaining |
| `sensor.kinboard_display_mode` | active Kinboard context |
| `binary_sensor.kinboard_attention_required` | at least one active attention item |
| `calendar.kinboard_family` | consolidated family calendar |

**Attributes stay small and stable.** Large lists belong behind an endpoint, not
in entity attributes — HA writes every state change to its recorder database,
and a fat attribute set is copied on every update.

### 5.2 Services HA can call

```
kinboard.add_shopping_item(name, quantity?, category?)
kinboard.create_task(title, person_id?, due_at?, priority?)
kinboard.create_note(text, expires_at?, color?)
kinboard.show_announcement(title, message, severity, duration, target_devices?)
kinboard.activate_context(context_id, duration?)
kinboard.dismiss_attention(attention_id)
kinboard.add_pocket_money(person_id, amount, reason)
kinboard.refresh_integration(integration_id)
```

### 5.3 Events Kinboard emits

```
kinboard_task_completed
kinboard_shopping_item_added
kinboard_family_event_created
kinboard_announcement_acknowledged
kinboard_saving_goal_reached
kinboard_device_joined
kinboard_context_changed
```

Every event carries `event_id`, `family_id`, `occurred_at`, `source`, `actor_id`
and a **versioned payload**.

---

## 6. Data model

### 6.1 New tables

```sql
integration_tokens   (id, family_id, name, token_hash, scopes[],
                      expires_at, last_used_at, revoked_at, created_at)
integration_clients  (id, family_id, client_type, client_version,
                      capabilities, last_seen_at)
domain_events        (id BIGSERIAL, family_id, event_type, payload_version,
                      payload JSONB, actor_id, source, occurred_at)
```

`attention_items`, `context_rules` and `context_state` are specified by RFC-002
(Heute-Motor); `bridge_devices` / `bridge_policy` by RFC-003. They are named here
only so the numbering does not shift later.

### 6.2 Why `BIGSERIAL` for `domain_events.id`

The cursor must be **monotonic and gapless-enough to compare**. A UUID cannot be
ordered; `occurred_at` collides under concurrency. A consumer stores “I have
processed up to 4711” and asks for everything above it.

### 6.3 Ordering trap, inherited from the recycle bin

`migration_zz_row_level_security.sql` **recreates every family-scope policy on
each boot.** Anything amending those policies must sort after it. The soft-delete
work learned this by having its predicate silently wiped on the next restart, and
the file is named `migration_zzz_soft_delete.sql` for that reason alone.

Migrations from this RFC that touch RLS must therefore sort after `zz`, and the
upgrade rig (`webapp/docker/test-upgrade.sh`) already asserts this class of
regression — it checks that the soft-delete predicate is still present after an
upgrade. An equivalent assertion is required for `domain_events`.

### 6.4 `actor_id` in a trigger

A trigger does not know which family member acted. Two options:

1. **`SET LOCAL kinboard.actor_id`** per transaction, read by the trigger via
   `current_setting('kinboard.actor_id', true)`. The soft-delete work already
   uses exactly this mechanism for `kinboard.hard_delete`, so the pattern is
   proven here.
2. Derive from the JWT claims PostgREST exposes.

**Recommendation: (1)**, with `NULL` allowed. An event with an unknown actor is
still useful; a missing event is not. Requiring the setting would mean any write
that forgot it fails — trading a complete event log for broken writes.

---

## 7. Delivery to Home Assistant

1. A write fires its trigger; a `domain_events` row is inserted in the **same
   transaction** as the data change. Either both land or neither does.
2. A worker reads events after a consumer’s cursor and delivers them.
3. The HA coordinator holds a WebSocket/SSE connection and stores the last
   `event_id` it processed.
4. On reconnect it resumes from its cursor. **Nothing is lost across a restart of
   either system** — an explicit acceptance criterion (§3.6 of the plan).
5. Duplicate suppression is the consumer’s job, keyed on `event_id`, which is why
   the id is stable and monotonic.

Retention: `domain_events` is pruned on a schedule. The nightly
`purge-recycle-bin` Ofelia job is the precedent for where that belongs.

---

## 8. Explicitly not in v1

- No generic HA proxy, no Lovelace passthrough, no camera streaming, no remote
  terminal (§5.4).
- No visual rule builder — v1 ships curated rules only (§4.5).
- No Cloud. The Bridge is an architecture and security RFC until the demand
  gates in §5.5 are met.
- No write access to anything not named in §5.2. Default deny.

---

## 9. Migration and compatibility

Every component here is **optional**. With no integration token issued and no HA
component installed, Kinboard behaves exactly as it does today. All schema steps
are additive; old clients must ignore unknown fields (§6.5 of the plan).

The upgrade rig gates this: `1.7.0 → HEAD` and `1.6.10 → HEAD` must continue to
pass, including the assertion that seeded data survives.

---

## 10. Acceptance criteria

Adapted from §3.6 of the plan, plus what this RFC adds:

- [ ] Setup completes entirely through the HA config flow — no YAML.
- [ ] Connection failures and token expiry are legible in the UI.
- [ ] At least six entities, four services and three events work end to end.
- [ ] Changes appear in HA within five seconds.
- [ ] Duplicate events are impossible via idempotent `event_id`.
- [ ] The integration survives a restart of **either** system unaided.
- [ ] Example automations import and run unmodified.
- [ ] **Every endpoint has scope, family-isolation and negative tests.** A token
      scoped `shopping:write` must be *proved* unable to create a task.
- [ ] **No external client needs direct Supabase access.**
- [ ] Token values appear exactly once and are stored only hashed.
- [ ] An event is emitted for a write made from a browser client component —
      i.e. the §2.1 decision is verified, not assumed.

---

## 11. Decisions taken

### 11.1 The HA component ships from its own repository

**`svenger87/kinboard-homeassistant`**, containing `custom_components/kinboard/`,
`hacs.json` and the `home-assistant/brands` submission.

The deciding factor is **release cadence**, measured rather than assumed: this
repository cut **31 releases in the 30 days to 2026-08-08** — 15 stable, 16
prerelease. HACS presents GitHub releases as available versions, so shipping the
component from here would show every HACS user roughly one integration update
per day for a component that changed on a handful of those days. Users learn to
ignore update badges, which is the worst possible habit for the component
holding their integration token.

The two sides want opposite rhythms. This repository is deliberately tuned for
fast releases — `docker.yml` publishes `next` on every prerelease tag and
Diun-following instances auto-update. An HA integration wants infrequent,
semver-meaningful releases that mean “something changed for you”.

Supporting reasons:

- **The official-integration path** (§3.1 of the plan) copies the component into
  `home-assistant/core`. A standalone Python package with its own hassfest and
  pytest CI extracts cleanly; one embedded in a Next.js monorepo does not.
- **Toolchain separation.** CI here is Node-shaped. Adding Python CI means more
  conditional path filtering, and `docker.yml` already carries a warning that a
  paths filter on a combined `branches` + `tags` trigger can wrongly skip the
  release build.

**The counter-argument, and why it does not win.** Two repositories can drift
apart on the contract in §5. But co-location does not actually solve that,
because there will be **three** consumers of this API — the HA component, the
Bridge, and later Cloud. The Bridge cannot live in both repositories. The
contract must stand alone regardless, which is why `/api/integration/v1` carries
its version in the path. Co-locating one consumer would undercut that and make
the three asymmetric.

Drift is instead handled by the mechanism Phase 1 already requires:

1. The OpenAPI spec is published as a release artifact from this repository.
2. The component's CI validates against a pinned spec version, so drift fails a
   build rather than a household.
3. `manifest.json` declares a minimum Kinboard version; the config flow checks it
   and fails legibly, which §10 already demands.
4. **This RFC stays here** as the source of truth for the frozen names.

Note the clean split this produces: `webapp/src/app/api/homeassistant/` is
*Kinboard consuming HA* and stays put; the new repository is *HA consuming
Kinboard*. Opposite directions, opposite release rhythms.

## 12. Open questions

1. **How much history does `domain_events` keep?** Long enough for a Bridge that
   was offline for a week to catch up, short enough not to grow forever.
2. **Do we emit events for imported calendar data?** A CalDAV sync pulling 200
   events should probably not produce 200 `kinboard_family_event_created`
   events. Suggest suppressing events where `source = 'sync'`.
3. **Rate limits per token or per family?** Per family is friendlier; per token
   is what protects the database.
