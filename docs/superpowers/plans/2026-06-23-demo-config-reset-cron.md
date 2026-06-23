# Demo Config-Reset Cron Implementation Plan

> **For agentic workers:** small infra change — execute inline. No app code; verification is `docker compose config` validation + a live demo-box check. No unit tests in this repo.

**Goal:** Periodically reset the public demo (demo.kinboard.app) to a pristine state on a schedule, so visitor-made config changes — a settings PIN, disconnected/edited integrations, added/deleted items — are wiped automatically instead of persisting for everyone on the shared demo family.

**Approach:** Re-run the existing `seed-demo.sql` on an Ofelia cron schedule. That script is already a full reset — it opens `DELETE FROM public.families WHERE id = '00000000-…-0001'` (cascades through every child table, including `settings` → the `settings_pin`), then re-inserts the seed (people, calendars, items, notes, birthdays, and the mock-integration `settings` rows), wrapped in `BEGIN…COMMIT`. So a single re-run restores the demo exactly.

**Tech:** Ofelia (`mcuadros/ofelia`, the `kinboard-cron` container) reads jobs from a mounted `ofelia.ini`; Supabase Postgres (`kinboard-db`) has `psql` natively.

## Global Constraints

- **SAFETY — demo-only, never on a real install (load-bearing):** the reset job MUST be gated to the demo overlay. It must NOT go into the shared `webapp/docker/ofelia.ini` (which every deployment mounts) — a real self-hoster running the cron must never get it. Defense in depth: (a) the job lives only in a demo-overlay-mounted config; (b) the SQL only ever touches the fixed demo family UUID `00000000-0000-0000-0000-000000000001`, which a real household never has. Both must hold.
- No app/runtime code changes; no image rebuild required (Ofelia reads the mounted config file at container start). Applying it = updating the demo host's overlay files + recreating the `cron` container.
- Conventional commit, **no `Co-Authored-By: Claude` trailer.**
- Keep the existing base cron jobs intact — the demo cron config is a SUPERSET of `ofelia.ini` (base jobs + the reset), so the demo box still runs google-sync, reminders, etc.

### Grounding (verified)
- `ofelia.ini` job format: `[job-exec "name"]` with `schedule`, `container`, `command`, `no-overlap = true`. Existing jobs exec scripts in `kinboard-webapp`.
- `cron` service (`docker-compose.yml:402`) mounts `./ofelia.ini:/etc/ofelia/config.ini:ro` and runs `daemon --config=/etc/ofelia/config.ini`.
- `seed-demo.sql` is a transactional wipe-and-reseed scoped to the demo UUID (re-runnable). Not currently mounted into `kinboard-db`.
- Demo deployments use `docker-compose.demo.yml` (from the `.example`) layered via `COMPOSE_FILES`; real self-hosters do NOT use it.

---

### Task 1: Demo cron config (base jobs + reset)

**Files:** Create `webapp/docker/ofelia.demo.ini`

- [ ] Copy the entire contents of `webapp/docker/ofelia.ini` verbatim, then append the reset job:
```ini

# ── DEMO ONLY ─────────────────────────────────────────────────────────────
# Re-applies seed-demo.sql on a schedule so visitor changes (settings PIN,
# integration edits, added/deleted items) don't persist on the shared public
# demo family. seed-demo.sql is a transactional wipe-and-reseed scoped to the
# demo family UUID. This config is mounted ONLY by docker-compose.demo.yml —
# it must never reach a real self-hoster's cron.
[job-exec "demo-config-reset"]
schedule = @every 1h
container = kinboard-db
command = psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /demo-reset/seed-demo.sql
no-overlap = true
```
- [ ] Add a header comment at the top of the file noting it's the demo superset of `ofelia.ini` and the two must be kept in sync.
- [ ] Commit: `feat(demo): demo-only Ofelia config with hourly config-reset job`

### Task 2: Wire the reset into the demo overlay

**Files:** Modify `webapp/docker/docker-compose.demo.yml.example`

- [ ] Add a `db` service override that mounts the seed read-only into the container at the path the job uses:
```yaml
  # Demo reset source — the hourly demo-config-reset Ofelia job (see
  # ofelia.demo.ini) runs `psql -f /demo-reset/seed-demo.sql`.
  db:
    volumes:
      - ./seed-demo.sql:/demo-reset/seed-demo.sql:ro
```
- [ ] Add a `cron` service override that swaps the mounted config to the demo superset (so the reset job exists ONLY when the demo overlay is active):
```yaml
  # Demo cron = base jobs + the hourly config-reset (ofelia.demo.ini).
  cron:
    volumes:
      - ./ofelia.demo.ini:/etc/ofelia/config.ini:ro
```
- [ ] Update the overlay's header-comment usage block to mention the hourly reset and that `@every 1h` in `ofelia.demo.ini` is the knob to tune.
- [ ] Commit: `feat(demo): mount seed for reset + demo cron config in the demo overlay`

### Task 3: Verify

- [ ] `cd webapp/docker && docker compose -f docker-compose.yml -f docker-compose.image.yml -f docker-compose.demo.yml config >/dev/null` — Expected: valid (no YAML/compose errors), and the `cron` service shows `ofelia.demo.ini` mounted, `db` shows the seed mounted.
- [ ] Confirm the base `ofelia.ini` is UNCHANGED (the reset job is absent there) — `grep -c demo-config-reset webapp/docker/ofelia.ini` → 0.
- [ ] Deployment note (demo host, manual): `git pull` the demo box, then `COMPOSE_FILES="… -f docker-compose.demo.yml" ./start.sh up` (or `docker compose … up -d cron db`) to recreate `cron` with the new config and mount the seed. Live check after one cycle: a visitor-set `settings_pin` row is gone within the hour, and `/settings` opens without a PIN.

---

## Self-Review

- **Spec coverage:** "config reset on demo as a cron job" → Task 1 (job) + Task 2 (demo-only wiring) + Task 3 (verify/deploy). Recurrence prevention → the hourly reset wipes any PIN/integration tampering.
- **Safety:** the reset job is only in `ofelia.demo.ini` (mounted exclusively by the demo overlay), and the SQL is scoped to the fixed demo UUID — two independent guards so a real household is never reset. `ofelia.ini` stays untouched (verified in Task 3).
- **No placeholders:** exact files, exact INI/YAML blocks, exact verify commands.
- **Tradeoffs:** `@every 1h` is a balance (fresh vs. not yanking config mid-visit) and is one-line tunable. Alternative considered — gating the PIN UI in demo mode — is narrower (only the PIN) and left as an optional follow-up; the scheduled reset supersedes it by wiping *all* visitor changes.
- **Out of scope:** automating the demo-host deploy (no demo SSH on hand) — the deploy step is documented for the operator.
