# RFC-024 — One container for the app stores, one compose file for everyone else

| | |
|---|---|
| **Status** | Accepted 2026-11-26. Decided: §11.3–5, 7–12, and automatic updates on every shape (§4.7). With the owner: §11.1, 2, 6 (submissions, license, forum thread). Open until phase 7: §11.13–14 |
| **Date** | 2026-11-26 |
| **Depends on** | [RFC-023](023-one-file-install.md) (#540): the secrets store and its init step, the base schema in the image, the job schedule in the image, `compose.yml`. This RFC adds nothing RFC-023 would have to change |
| **Discussion** | #539 |

## 1. Why

RFC-023 makes Kinboard one compose file that any Compose UI can run. The
owner's bar is higher: a professional setup that can be listed in the Unraid
Community Applications store and the other NAS app stores. Those stores are
how most households on those systems find and install software, and they come
with rules of their own.

Three facts shape this RFC, the first two from the stores' own documentation
(§5):

- **The stores split by shape.**
  - **One container per listing:** Unraid's classic CA template describes one
    container, and so does Portainer's "container" template.
  - **Compose with a PostgreSQL sidecar:** TrueNAS, CasaOS/ZimaOS and Umbrel.
    Umbrel says outright not to collapse sidecars into one container.

  Kinboard is five services plus two one-shots: PostgreSQL, PostgREST, the
  webapp, go2rtc, and the scheduler that RFC-023 moves into the webapp.
- **Unraid CA requires "an OSI-approved `LICENSE` file at the repository
  root"** (https://ca.unraid.net/submit/help). Kinboard's license is PolyForm
  Noncommercial 1.0.0 (`LICENSE`), which is not OSI-approved. As things stand,
  the store this request started from can't list Kinboard at all, whatever its
  shape (§5.1, §11.2).
- **Kinboard already has most of a professional image, unevenly.** Checked on
  the published `ghcr.io/svenger87/kinboard:1.17.0` (Appendix A):
  - It is multi-arch, built natively per platform (amd64 and arm64 runners,
    merged by digest; `.github/workflows/docker.yml:83-98, 160-175, 236-246`).
  - It carries OCI labels from `docker/metadata-action`, but
    `org.opencontainers.image.licenses` reads `NOASSERTION`.
  - It has provenance attestations in `mode=max` (the attestation carries
    `buildConfig`, which only max mode records), and no SBOM.
  - The image has no `HEALTHCHECK`; the compose file has one
    (`docker-compose.yml:267-272`).
  - The container starts as root, and the server drops to `nextjs`
    (`Dockerfile:249`, `webapp-entrypoint.sh:31-36`).

## 2. The rule: one build, two shapes

The all-in-one image and the compose file are two packagings of the same
build, not two products:

- the same webapp, migrations, secrets init step, base schema and scheduler;
- the same `/api/health`;
- the same three data directories (`db`, `storage`, `config`).

A fix lands once. A store listing never needs a feature the compose file lacks,
or the other way round.

**A household changes shape only on purpose,** through an export and import,
never by pointing one shape at the other's data (§4.4).

**The owner decides when to submit to any store.** Nothing in this plan waits
for a submission or depends on one (§9).

## 3. Goals and non-goals

**Goals**

- An all-in-one image, `ghcr.io/svenger87/kinboard-aio`, that runs the whole
  app in one container with one `/data` volume, no required environment, and
  secrets that create themselves.
- Both images meet the same professional bar (§6): OCI labels, a health check,
  non-root with PUID/PGID, logs to stdout, documented resources, an SBOM and
  provenance, release notes from the changelog, and a CI matrix that starts
  each shape fresh and upgrades it from the last release.
- Listings for Unraid CA, TrueNAS, CasaOS/ZimaOS, Umbrel and Portainer
  templates, plus a documented Synology path, all generated from **one
  metadata file** (§7).
- A first-run flow in the app that replaces `setup.sh`'s questions (§8).
- Finally, no Supabase left in the app: `postgrest-js` in place of `supabase-js`,
  neutral variable names with fallbacks, and a decision for each Supabase name
  inside the database (§4.6).

**Non-goals**

- Changing what the compose install is. RFC-023 stands as written, apart from
  one addition: its `kinboard-db-init` also creates the supabase roles and the
  publication when they are missing (§4.5). That is a no-op on
  `supabase/postgres`.
- A Kinboard-run store or update server.
- Shipping go2rtc inside the all-in-one image (§4.2).
- Submitting anywhere on a date this RFC sets.
- YunoHost (§5.7).

## 4. All-in-one or compose

### 4.1 The comparison

| | All-in-one image | Compose (RFC-023) |
|---|---|---|
| **Stores that take it** | Unraid CA (subject to its license rule, §5.1), Portainer container templates, and any Docker host by hand. Umbrel asks for the opposite; TrueNAS and CasaOS package databases as sidecars (§5) | TrueNAS, CasaOS/ZimaOS, Umbrel, Portainer stack templates, Synology projects, the Compose UIs of RFC-023. Unraid only through the Compose Manager plugin, until CA's compose packages (announced for Unraid 8, contract unpublished) can be used (§5.1) |
| **Robustness** | one supervisor decides start order and restarts (§4.2). A crash in one process is restarted inside the container; Docker sees one unhealthy container | Docker does the ordering (`depends_on` conditions) and the restarts. Each service is visible and restartable on its own |
| **Upgrade safety, PostgreSQL in particular** | the image pins the PostgreSQL major. A major bump must upgrade the data inside the container at start (§4.3), with a verified dump first. More logic in the image, but it runs the same way for every household | the database image is pinned in the compose file, so a major bump means a new `compose.yml` (RFC-023 §4.6, the revision notice) plus a dump and restore. Less logic, but more steps for the household |
| **Backup and restore** | one directory, `/data`. Stop the container, copy the directory: database files, uploads and secrets together. The app can offer a consistent dump, because the database runs beside it | three directories; the same contents (RFC-023 §6.5) |
| **Raspberry Pi** | one Node, one PostgreSQL, one PostgREST, the same processes as compose minus go2rtc. Image size is the main difference (§4.2): stock PostgreSQL in place of the 1.67 GB `supabase/postgres` | `supabase/postgres` is 1.67 GB on disk (measured); PostgREST 28 MB; go2rtc 362 MB; the webapp about 313 MB. Idle on the development machine: db 59 MiB, rest 48 MiB. The webapp's idle memory is still to be measured on a Pi |
| **Existing installs** | not affected. Moving from compose means export, then import (§4.4) | RFC-023 §5 |
| **Security** | fewer moving parts. No internal network, no ports between services, no Docker socket. One process compromised is one container compromised. In compose that is not much more contained either, because the webapp already holds the database password and the service-role key. Runs as PUID/PGID, not root (§6.3) | the same secrets; services separated by containers. Today the webapp container starts as root |

### 4.2 The all-in-one image

**Base.** The webapp's runner stage (`node:22-alpine`, `Dockerfile:101`). On
top of it:

- **PostgreSQL 17** from Alpine's packages. Not 15, which compose runs:
  the runner's base is Alpine 3.24, whose repository has `postgresql16`, `17`
  and `18` and no 15 (checked, Appendix A). A new all-in-one install has no
  data to carry, and moving from compose is logical anyway (§4.4), so a newer
  major costs nothing.
- **PostgREST**, copied from the pinned `postgrest/postgrest:v14.16` image
  for the same platform (`COPY --from`). On amd64 the binary is statically
  linked and needs nothing beside it. On arm64 it is not: upstream's arm64
  image of the 14.x line is an Ubuntu image with a binary linked against
  glibc, which exits 127 on Alpine's musl. So on arm64 the image also carries
  that binary's runtime, taken from the same upstream image: glibc's loader
  and the libraries `ldd` resolves (glibc, libpq, OpenSSL, Kerberos, OpenLDAP,
  SASL, GMP, zlib, zstd, keyutils, com_err) in `/usr/lib/aarch64-linux-gnu`,
  their copyright files in `/usr/share/licenses/postgrest-runtime/`, and a
  record of their Debian packages that the image's SBOM picks up (#575 and
  its follow-up). This is a workaround with one condition for removal:
  PostgREST publishes a static arm64 build from 16.x on, so when the pinned
  line has one, arm64 copies the binary alone, as amd64 does, and the runtime
  goes.
- **s6-overlay v3** as the supervisor, from Alpine's package
  (`s6-overlay-3.2.3.0`) or the upstream release tarball.

**Why stock PostgreSQL, not `supabase/postgres`.** Kinboard's isolation
between families is plain PostgreSQL row-level security. Nothing in it is
Supabase's.

- **The policies.** Every family policy compares a row's family with
  `public.current_family_id()`, defined in
  `migrations/049_row_level_security.sql:82`. The function reads
  `current_setting('request.jwt.claims', true)::jsonb ->> 'family_id'`, which
  PostgREST sets from the verified JWT on each request
  (https://docs.postgrest.org/en/v14/references/transactions.html).
  `049` creates the shared `FOR ALL` policy for every table in its
  `direct_tables` list (`:107-127`) and the family table's own policies
  (`:153-157`); later migrations add 17 more.
- **No Supabase functions.** No policy calls `auth.uid()` or `auth.jwt()`.
  `049:20` still says `auth.jwt()` in its prose, which is stale wording.
- **On the development database**, read-only, after the full migration run:
  - 64 tables in `public`, 57 with RLS enabled, none forced;
  - 57 policies on 53 tables, 54 of them keyed on `current_family_id()`;
  - the other three are `school_holidays`' `source = 'manual'` policies for
    `anon, authenticated`;
  - 0 policies reference `auth.`;
  - the seven tables without RLS (`domain_events`, `integration_clients`,
    `integration_idempotency`, `integration_tokens`,
    `oauth_authorization_requests`, `oauth_clients`, `system_heartbeats`) have
    no grant at all to `anon` or `authenticated`.

Beyond that, the schema needs very little of what the image adds (checked
against `init.sql` and all 88 migrations):

- the roles, with exactly the attributes in §4.2.1;
- the publication `supabase_realtime`, named 78 times in 20 files that add tables to it;
- `uuid-ossp`.

`pg_cron` is created (`init.sql:6`) but nothing schedules a job with it. No
schema object uses `pgcrypto` or `supabase_vault`; `gen_random_uuid()` is core
PostgreSQL. `init.sql`'s `CREATE EXTENSION pg_cron` becomes conditional on the
extension being available. Alpine does package it (`postgresql-pg_cron`), but
loading an unused extension through `shared_preload_libraries` buys nothing.
The legacy compose runs `init.sql` only on fresh databases, so the change
reaches nobody's existing data. That avoids a 1.67 GB Nix-built image inside
the container.

#### 4.2.1 What the role bootstrap must reproduce exactly

This is the part where a mistake is silent. Two examples:

- **A wrong `BYPASSRLS`.** If `service_role` lacks it, every API route sees
  nothing. If `authenticated` has it, every family sees everything.
- **A wrong `INHERIT`.** If `authenticator` inherits, its sessions carry its
  members' rights before PostgREST switches roles.

So the bootstrap copies the values read from `supabase/postgres:15.14.1.159`
on the development database (`pg_roles`, `pg_auth_members`,
`pg_db_role_setting`, `pg_default_acl`, `pg_namespace.nspacl`; read-only,
2026-11-26).

**Role attributes** (all with `rolconnlimit = -1`, none with `CREATEDB` or
`CREATEROLE` unless shown):

| Role | Superuser | Inherit | BypassRLS | Login | Other | Settings |
|---|---|---|---|---|---|---|
| `anon` | no | yes | no | no | — | `statement_timeout=3s` |
| `authenticated` | no | yes | no | no | — | `statement_timeout=8s` |
| `service_role` | no | yes | **yes** | no | — | — |
| `authenticator` | no | **no** | no | **yes** | — | `statement_timeout=8s`, `lock_timeout=8s`, `session_preload_libraries=supautils, safeupdate` |
| `postgres` | **no** | yes | **yes** | yes | `CREATEROLE`, `CREATEDB`, `REPLICATION` | `search_path="$user", public, extensions` |
| `supabase_admin` | **yes** | yes | yes | yes | all | — |

**Memberships**:

- `authenticator` is a member of `anon`, `authenticated` and `service_role`,
  without admin option. That is PostgREST's role switch
  (https://docs.postgrest.org/en/v14/references/auth.html).
- `postgres` is a member of `anon`, `authenticated`, `service_role`,
  `pg_monitor`, `pg_read_all_data` and `pg_signal_backend`, and of two
  Supabase-only roles (`supabase_privileged_role`, `supabase_realtime_admin`)
  that nothing of Kinboard's uses (inferred; the comparison in §6.5 confirms
  it or fails).

**Default privileges in `public`**, which make isolation rest on RLS plus
explicit `REVOKE`s:

- For objects created by `postgres` and by `supabase_admin`, every new table
  gets `arwdDxt`, every sequence `rwU` and every function `X`, granted to
  `anon`, `authenticated`, `service_role` and `postgres`.
- Kinboard's migrations rely on this. `camera-takeover-grants` and
  `school-holidays-grants` say so in their headers
  (`webapp/e2e/camera-takeover-grants.spec.ts:1-8`,
  `school-holidays-grants.spec.ts:1-8`).
- A bootstrap that forgets these doesn't open anything: every new table is
  simply closed to the browser. One that grants more than this opens tables
  that rely on a later `REVOKE`. Either way, the comparison in §6.5 catches it.

**Schema usage**: `USAGE` on `public` for `anon`, `authenticated` and
`service_role`; on `extensions` the same.

**On stock PostgreSQL, the bootstrap:**

- **The superuser.** The image's own superuser is created as `supabase_admin`
  (`POSTGRES_USER=supabase_admin`), so backups, restore and the slot cleanup
  connect as they do today (`kinboard-self-update.sh:137`,
  `scripts/rigs/test-backup-restore.sh:205`, `webapp-entrypoint.sh:120`).
- **The roles.** It creates `postgres` and the four API roles with the
  attributes, memberships, settings and default privileges above.
- **`supautils`.** Leaves it out, and that is no loss on stock PostgreSQL
  17. On `supabase/postgres` it is preloaded for `authenticator` too, and its
  settings there (read-only, 2026-11-26) do three things:
  - `supautils.reserved_roles` stops non-superusers from altering
    `anon`, `authenticated`, `service_role`, `authenticator` and Supabase's own
    roles;
  - `privileged_extensions` lets the non-superuser `postgres` create
    extensions such as `uuid-ossp` and `pg_cron`;
  - `policy_grants` covers the `auth`, `storage` and `realtime` schemas.

  None of this applies to API sessions, because `anon`, `authenticated` and
  `service_role` hold no `CREATEROLE`. Only `postgres`, the migration runner's
  role, has it. On PostgreSQL 16 and later, `CREATEROLE` alone no longer allows
  altering a role it doesn't hold `ADMIN OPTION` on
  (https://www.postgresql.org/docs/16/release-16.html, "Restrict the
  privileges of CREATEROLE"), and the bootstrap creates the API roles as
  `supabase_admin` without granting `postgres` that option. Stock 17 gives the
  `reserved_roles` protection by itself (inferred from the release notes; the
  role comparison in §6.5 also checks `pg_auth_members.admin_option`).
  Extensions are created by `db-init` as the superuser, so
  `privileged_extensions` has nothing to permit.

  Existing installs keep `supabase/postgres` and its `supautils` unchanged.
- **`safeupdate`, decided 2026-11-26: in the database and in the app** (§11.12).
  On `supabase/postgres` it makes every session through `authenticator` refuse
  an `UPDATE` or `DELETE` without a `WHERE` clause. Checked on the
  development database (`LOAD 'safeupdate'`, a temporary table, rolled back):
  - `DELETE FROM t` gives "DELETE requires a WHERE clause";
  - `UPDATE t SET …` gives "UPDATE requires a WHERE clause";
  - `WHERE true` passes. It checks that a clause exists, not that it narrows
    anything.

  That includes the service role, which bypasses RLS, so it is what stops a
  filterless server-side delete from emptying a table across all families. No
  shape may be weaker than that:
  - **In the database, on every shape that doesn't run `supabase/postgres`.**
    `pg-safeupdate` is built from source at a pinned release:
    - tag `1.7`, commit `37dbc9c4acf5e2504adf2b218e9c6b41751022f3`;
    - the GitHub tarball `archive/refs/tags/1.7.tar.gz` checked against
      sha256 `456aa0ceffc412292c41d88aad7c91ada33fb4af05f355ba78e5bcf2cdf56377`
      (computed 2026-11-26). The build fails on any mismatch.

    It is ISC-licensed and one C file (`safeupdate.c`). At least 1.6 is
    required, because 1.6 is the release that "Do[es] not block pg_upgrade"
    (its `NEWS`), which §4.3 needs. Existing installs run 1.4, inside
    `supabase/postgres`. The bootstrap sets
    `ALTER ROLE authenticator SET session_preload_libraries = 'safeupdate'`,
    the same as `supabase/postgres` does today, minus `supautils`. Where it
    is built:
    - **the all-in-one image:** a build stage compiles it against Alpine's
      `postgresql17-dev`, and the runner copies `safeupdate.so` into
      PostgreSQL's library directory;
    - **the stock-PostgreSQL compose shape** (new store installs, §4.5): a
      small database image of our own, `ghcr.io/svenger87/kinboard-postgres:17`.
      It is `postgres:17-alpine`, pinned by digest, plus that one file, built
      and published by the same `docker.yml` matrix with the same labels,
      SBOM and provenance (§6). A derived image was preferred over
      alternatives:
      - mounting the library from a volume would put a shared object on a
        user-writable path;
      - `LOAD` at session start can't be forced on PostgREST's connections;
      - relying on the app alone would be weaker than today for any request
        that reaches `/rest/v1` with a family token.
    - **TrueNAS** therefore lists this image as a plain service, not through
      `tpl.deps.postgres`, whose stock image can't load the library. Its data
      directory is stock PostgreSQL 17's plus one library, so TrueNAS's
      `postgres-upgrade` image still applies to it (inferred; rehearsed in §10
      before listing).
  - **In the app, before a request leaves.** Today's PostgREST client is the
    `supabase-js` builder, and the removal phase's is the `postgrest-js`
    wrapper (§4.6). Both go through the custom `fetch` of the two factories in
    `src/lib/supabase/client.ts:91` and `server.ts`. That `fetch` refuses
    any `PATCH` or `DELETE` to `/rest/v1/<table>` whose query string carries no
    filter. "Filter" means any parameter other than `select`, `order`,
    `limit`, `offset`, `columns` and `on_conflict`. It throws
    `UnfilteredWriteError` naming the table, before anything is sent. One
    place covers every call path: the browser's family client, the server's
    service-role client, the `x-kinboard-actor: integration` client and
    `.rpc()`, which is a `POST` and unaffected.

    The guard has no access to a function's SQL. A function called through
    `.rpc()` is still covered by `safeupdate` in the database, which hooks every
    statement of the session.

    **Deliberate whole-table writes opt out explicitly**, with
    `.allowUnfiltered("reason")`. That is a wrapper method that sets the header
    `x-kinboard-allow-unfiltered: <reason>`, which the `fetch` strips before
    sending. It is greppable, and a CI check lists every use, so each one is
    seen in review. It doesn't bypass `safeupdate`: a real whole-table write
    still has to say `WHERE true` (a filter like `id=not.is.null`) on purpose.
    **Today there are none.** A scan of `src` found 132 `update()` and 65
    `delete()` calls on `.from()` chains, every one with a filter; its single
    hit was `Set.delete`, not PostgREST.

  The CI checks in §6.5 prove both layers on every shape, and prove that each
  fails when its protection is removed.
- **The publication.** Creates `supabase_realtime`, empty, **owned by
  `postgres`**, as it is on `supabase/postgres`. Every
  `ALTER PUBLICATION … ADD TABLE` in `init.sql` and the migrations then
  succeeds. A publication without a subscriber holds no slot and costs
  nothing.
- **`uuid-ossp` in an `extensions` schema**, as `supabase/postgres` has it,
  with `USAGE` for the API roles and `postgres`'s
  `search_path="$user", public, extensions`. Created in `public` instead,
  the default privileges hand its 10 functions to `anon`, `authenticated` and
  `service_role`.

**Verified 2026-11-26** (Appendix A). On a throwaway `postgres:17-alpine`,
with a draft of this bootstrap, then `init.sql` under `--single-transaction`
(`pg_cron` conditional), then all 88 migrations as `postgres`, the §6.5
comparison was run against a throwaway `supabase/postgres:15.14.1.159` set up
the same way:

- **Identical:** 57 policies; the RLS flags of 63 tables; 906 table grants;
  the five roles' attributes; the 9 memberships; the per-role settings except
  the preload list; 88 migrations recorded.
- **Caught by the comparison:**
  - The first run of the draft failed at `001_base.sql` with "must be owner of
    publication supabase_realtime", which is why the owner line above exists.
  - Two differences remained:
    - 30 routine grants on `uuid-ossp`'s functions, which is the
      `extensions` line above;
    - `authenticator`'s `session_preload_libraries`, which is expected:
      `supautils` dropped, and `safeupdate` comes with `kinboard-postgres`.

  Both are now part of the contract, so the CI check starts from zero
  differences.

#### 4.2.2 Services, shutdown and health

**Services**, as s6-rc definitions with dependencies:

| s6 service | Type | Depends on | What |
|---|---|---|---|
| `init-perms` | oneshot | — | creates `/data/{db,storage,config}`; applies PUID/PGID (§6.3) |
| `init-secrets` | oneshot | `init-perms` | RFC-023's `kinboard-init`, unchanged: `.env`/environment, then file, then generate; the same guards |
| `postgres` | longrun | `init-secrets` | `initdb` on an empty `/data/db`, then the server on a Unix socket and 127.0.0.1 only |
| `db-ready` | oneshot | `postgres` | waits for `pg_isready`; runs the role bootstrap and RFC-023's `kinboard-db-init` (password alignment, `init.sql` on an empty schema) |
| `postgrest` | longrun | `db-ready` | on 127.0.0.1:3010; secrets by `@file` (verified, RFC-023 Appendix A) |
| `webapp` | longrun | `postgrest` | the entrypoint's migrations, then the server on :3000 with `KINBOARD_SCHEDULER=internal` |

**go2rtc stays out.** It is the heaviest image (362 MB with ffmpeg) for a
feature most households don't use, and it needs UDP 8555. Snapshot and MJPEG
cameras work without it. For RTSP, `GO2RTC_URL` points at a separate go2rtc
container. The listing says so in one line.

**Shutdown.** `docker stop` sends SIGTERM to s6, which stops the services in
reverse dependency order:

- the webapp first;
- then PostgREST;
- then PostgreSQL with a fast shutdown, a clean checkpoint and no recovery on
  the next start.

PostgreSQL's s6-rc service gets a `timeout-down` of 30 seconds, and
`S6_KILL_GRACETIME` is raised to match. Its default is 3 seconds, and
`S6_SERVICES_GRACETIME` applies only to legacy `services.d` services
(https://github.com/just-containers/s6-overlay).
Every listing sets the container's stop timeout above that: 60 seconds, through
`--stop-timeout` in Unraid's ExtraParams and `stop_grace_period` in compose
formats. Docker's default of 10 seconds would kill PostgreSQL mid-checkpoint.
That is safe, since WAL replays, but slow, and it is exactly what a
professional image shouldn't do.

**Health.** `HEALTHCHECK CMD curl -sf http://127.0.0.1:3000/api/health`.
`/api/health` already probes the database with a timeout
(`src/app/api/health/route.ts:35, 69`), so one probe covers all three
processes.

**Ports.** One: 3000 in the container, 3001 on the host by convention, as
`compose.yml`. PostgreSQL and PostgREST listen on loopback only.

### 4.3 PostgreSQL major upgrades in the all-in-one image

The image pins one major version. When a release moves it (17 to 18, say):

1. The image carries the previous major's binaries for the releases in
   between. Alpine packages several majors side by side (`postgresql16`,
   `postgresql17` and `postgresql18` in 3.24, checked).
2. At start, `PG_VERSION` in `/data/db` names the old major. `init` takes a
   verified dump into `/data/backups/` first, with the same checks as the
   self-update (`kinboard-self-update.sh:131-160`).
3. It runs `pg_upgrade` in copy mode, not `--link`, into `/data/db.new`, so
   the old cluster in `/data/db` stays untouched. It checks for free space for
   a second copy first and refuses, with a message, if there isn't any.
4. Only when the new server answers does a rename make `/data/db.new` the
   live `/data/db` and the old one `/data/db.old`. After the first healthy
   minute the app says once in Settings that `/data/db.old` can be deleted.
   Until that minute, a rollback (§4.7) renames them back.

A failed upgrade leaves `/data/db` untouched. The container stops with the
reason in its log. The previous image tag still runs on it.

### 4.4 Moving between the two shapes

**Not by sharing the data directory.**

- **Compose uses `supabase/postgres`**, built with Nix against glibc.
- **The all-in-one image uses Alpine's PostgreSQL**, built against musl.

They are also different majors (15 and 17, §4.2), and a data directory only
opens under the major that wrote it. Even at the same major it would not be
safe: a data directory carries its collation behaviour, and text indexes built
under one C library can be out of order under the other, which corrupts index
lookups silently.

The supported path is logical:

- `kinboard export` (in both images) writes one archive: a `pg_dump` of the
  `public` and `kinboard` schemas, `storage/`, and `config/secrets/`. The
  secrets carry the VAPID keys, so push keeps working across the move, and the
  JWT secret.
- `kinboard import` on a fresh install of the other shape restores it, before
  the first family is created. It refuses a non-empty database.

The commands build on the documented restore (`docs/wiki/Self-hosting.md:284-302`)
and the backup rig (`scripts/rigs/test-backup-restore.sh`), which already
proves that a dump from yesterday's version restores into today's. Later, the
same archive is what a "download a full backup" button in Settings produces
(RFC-023 §11.10).

**Decided (§11.4):** existing compose installs stay on `supabase/postgres` 15.
Moving them to stock PostgreSQL would make data directories portable, but at
the cost of one dump and restore each, so it is not done.

### 4.5 Recommendation

**Both, from one build, and the compose shape first.** Three of the four
stores with a real catalogue (TrueNAS, CasaOS/ZimaOS, Umbrel) take compose
with a database sidecar, and none of them asks for an all-in-one image. The
one store built around single containers, Unraid CA, can't list Kinboard under
its current license (§5.1). So:

- **The compose shape** (RFC-023's `compose.yml`, adapted per store by the
  generator in §7) is what the stores list. It comes first.
- **The all-in-one image** follows. It is still worth building, for three
  reasons:
  - Unraid households can add a template repository by URL without CA
    (§5.1);
  - Portainer's container templates and a plain `docker run` want one
    container;
  - CA becomes possible the day the license allows it.

  It is not on the critical path of any compose listing.
- **The legacy git install** stays as RFC-023 leaves it.

**The database in the store listings.** Every listing runs
`kinboard-postgres:17`, stock PostgreSQL 17 plus `safeupdate` (§4.2.1). That
includes TrueNAS, whose own helper builds a plain `postgres` sidecar that can't
load the library (§5.2). Stock PostgreSQL works if the
supabase roles and the `supabase_realtime` publication exist, so the role
bootstrap from §4.2 moves into RFC-023's `kinboard-db-init`, which runs from
the webapp image against any PostgreSQL. It creates the roles and the
publication only when they are missing, which makes it a no-op on
`supabase/postgres`.

That lets every new store install run stock PostgreSQL 17, the major the
all-in-one image uses, while existing compose installs keep `supabase/postgres`
15, with no forced dump and restore (decided, §11.4).

How they share code:

- **One Dockerfile with two final stages**, `runner` (today's image) and
  `aio` (runner plus PostgreSQL, PostgREST and s6), built by the same
  `docker.yml` job matrix. That gives four builds: two shapes on two platforms.
- **The secrets init step, the database init, the scheduler and the health
  route are the same files.** Only the s6 service definitions exist in the
  all-in-one stage alone.
- **Image names come from one place.** Every image this work publishes
  (`kinboard-updater` from RFC-023, `kinboard-postgres`, `kinboard-aio`) takes
  its name from one setting in `docker.yml`, shared with the metadata file
  (§7). Each can later be published under additional names, the same way the
  main image may be.
- **One version and one changelog.** Tags carry the same version:
  `kinboard:1.18.0` and `kinboard-aio:1.18.0`, with `latest` and `next`
  following the same rules (`docker.yml:133-158`).

### 4.6 The last phase: Supabase removed

Since 1.15 Kinboard runs no Supabase service. What is left is a client
library, some variable names, and names inside the database. This phase
removes the first two and decides each of the third, after stock PostgreSQL
(phase 3) and without changing anything for an existing install. Each step is
its own PR.

**What `supabase-js` still does for us.** It is imported in two files of the
app, `src/lib/supabase/client.ts:1` (`createBrowserClient` from
`@supabase/ssr`) and `src/lib/supabase/server.ts:1-2` (`createServerClient`,
`createClient`). Four e2e specs also import it: `event-series-live`,
`same-origin-api`, `creature-shop-live` and `point-rewards-live`. Through those
two factories, used from about 200 files, it does:

| Feature | Used | Evidence |
|---|---|---|
| PostgREST query builder (`from().select()…`, filters, `.rpc()`) | **yes**: the whole data layer, 31 `.rpc()` calls | this is `@supabase/postgrest-js` inside supabase-js |
| Default headers: `apikey` and `Authorization: Bearer <key>`, `X-Client-Info` | yes, implicitly | the browser's custom `fetch` replaces `Authorization` with the family token when there is one (`client.ts:91-109`) |
| Auth (GoTrue): sessions, refresh, `.auth.*` | **no**. 0 calls; the admin client turns it off (`server.ts:58-60`) | `grep '\.auth\.'`: 0 |
| Realtime (`.channel()`) | **no**, since 1.15 (`client.ts:69-71`) | `grep '\.channel('`: 0 |
| Storage (`.storage.from()`) | **no** | 0 |
| Cookie-bound server client (`@supabase/ssr` `createServerClient`) | **no**. `server.ts`'s `createClient` has 0 importers | `grep`: 0 |

**Replace it with `@supabase/postgrest-js`.** It is the same query builder
with the same `Database` generic, so the ~200 call sites don't change. It is
wrapped by two factories that keep today's names and behaviour:

- **The browser** gets the family-token `fetch` from `client.ts`.
- **The server** gets the service key and the `x-kinboard-actor` header
  (`server.ts:64`).

A thin client of our own was considered and not proposed. The query builder's
types are most of the value, and it would mean rewriting them.

**No anon key at all, which is better than renaming one.** PostgREST runs a
request with no `Authorization` header as its anon role
(`PGRST_DB_ANON_ROLE=anon`, `docker-compose.yml:149`). Checked on the
development stack: no header → 200, as `anon`, and `families` returns `[]`.
`supabase-js` insists on a key; `postgrest-js` doesn't.

Once the browser sends no key before it has a family token,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` has no reader. The trap that Next inlines
`NEXT_PUBLIC_*` values at build time, so a stray `.env.local` ends up in the
bundle (`webapp/docker/docker-compose.build.yml:8-11`), disappears with it: a
value baked into an old source build has nothing left to override.

**Variables, renamed with a fallback.** The repository's precedent for a
fallback is a second name read after the first: `JWT_SECRET ||
PGRST_JWT_SECRET` (`src/lib/family-jwt.ts:43`), `VAPID_PUBLIC_KEY ||
NEXT_PUBLIC_VAPID_PUBLIC_KEY` (`src/lib/push-sender.ts:67`). I found no
existing `KINBOARD_*` rename with a fallback; this phase adds one helper,
`env(newName, ...oldNames)`, which logs once at start when only an old name is
set.

| Today | After | Read by today | Fallback |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | `KINBOARD_SERVICE_ROLE_KEY` | `src/lib/supabase/server.ts:49-55`; CI (`e2e.yml:232-266`) | the old name, then derived from `JWT_SECRET` (RFC-023 §4.1) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | retired | `layout.tsx:81` → `window.__ENV`; `client.ts:22-28`; `rest/v1/[...path]/route.ts:35`; Dockerfile build arg (`:45-46, 72-77`); `docker-compose.build.yml` | still read for one release by the legacy Kong path only. Then the build arg and the `window.__ENV` key go. The client keeps accepting the old `window.__ENV` key for one more release, because a service worker can serve HTML rendered before the update |
| `NEXT_PUBLIC_SUPABASE_URL` | retired | `api-base.ts:31-38` (always `same-origin` since RFC-018), `client.ts:16-28` | the same |
| `SUPABASE_URL` | stays, read-only, as "the pre-1.15 Kong address" | `api-base.ts:54`, `rest/v1/[...path]/route.ts:69`, `storage/v1/object/public/[...path]/route.ts:59` | removed in the release after the last 1.14 install could plausibly still upgrade; the owner's call |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` in e2e (14 specs) | `KINBOARD_URL`, none | `e2e/secrets.spec.ts:47` and others | the old names, in the test helpers only |
| `ANON_KEY`, `SERVICE_ROLE_KEY` in `.env` | unchanged | compose interpolation | they are the `.env` names, not Supabase's; RFC-023 keeps reading them |

**Names inside the database, decided one by one:**

| Name | Decision | Why |
|---|---|---|
| Roles `anon`, `authenticated`, `service_role`, `authenticator` | **keep** | They are PostgREST's documented role pattern as much as Supabase's. 140, 135, 90 and 1 references across `init.sql` and the migrations. A rename on existing databases is `ALTER ROLE … RENAME`, but `migrate.sh` re-applies a changed migration and every one after it (`migrate.sh:84-96`), and those files name the old roles, so the next edited migration would fail on every renamed install |
| `supabase_admin` | **keep** | the operational superuser on both images (§4.2.1). Backups, restore, slot cleanup and `db-init` connect as it. A rename would split every script by shape for no household-visible gain |
| Publication `supabase_realtime` | **keep, stop adding to it** | Nothing has read it since 1.15 (live updates are a trigger, `084_change_feed.sql`), but 78 references in 20 files add tables to it, and re-applied migrations would fail on a renamed one. New migrations stop adding tables, and a CI check refuses new `ADD TABLE` lines. Dropping it is a later, separate migration once no re-applied file names it |
| `iss: "supabase"` in old installs' `ANON_KEY` and `SERVICE_ROLE_KEY` (`setup.sh:272`) | **no dual acceptance needed** | PostgREST v14 doesn't check `iss`. Checked on the development stack: tokens with `iss` `supabase`, `kinboard` and `something-else` all got 200; only a wrong signature got 401. Family tokens already say `kinboard` (`src/lib/family-jwt.ts:80`); derived keys (RFC-023) do too; old keys keep working until rotated |
| `auth`, `storage`, `realtime`, `_realtime`, `graphql_public` schemas on existing databases | **keep** | They belong to `supabase/postgres` and hold nothing of Kinboard's since 1.15. `PGRST_DB_SCHEMAS` still lists `graphql_public` (`docker-compose.yml:148`); stock installs create it empty, or the setting drops it in the same PR |
| The directory `src/lib/supabase/` | rename to `src/lib/db/` in the last PR | a mechanical import change across ~200 files, kept separate from any behaviour change |

**`db:generate`.** The script (`package.json:18`) runs `supabase gen types
typescript --local > src/lib/database.types.ts`. It is already dead:

- the types live in `src/types/database.ts` (1,924 lines, imported from 111
  files, last edited by hand in #485);
- `src/lib/database.types.ts` doesn't exist;
- the Supabase CLI is not a dependency.

**Proposal:** run the same generator against the migrated database by URL,
`npx supabase@<pinned> gen types typescript --db-url …`, as a dev-only tool.
Its output is exactly the `Database` shape `postgrest-js` is typed by. CI
regenerates the file from a fresh migration run and fails on a difference, so
the hand edits stop.

The alternative, a generator of our own over `information_schema`, is about
200 lines. It is worth writing only if the CLI ever stops supporting
`--db-url`. Open (§11.13), for when phase 7 starts.

**Order, one PR each, nothing changing for an existing install:**

1. the `env()` helper and `KINBOARD_SERVICE_ROLE_KEY` with fallback;
2. `@supabase/postgrest-js` in place of `supabase-js` and `@supabase/ssr` in
   the two factories, plus the four e2e specs;
3. the browser stops sending a key before the family token; the anon key's
   readers retire, with the one-release `window.__ENV` overlap;
4. `db:generate` replaced and the drift check added;
5. the publication guard (no new `ADD TABLE`);
6. `src/lib/supabase/` renamed;
7. one release later, the legacy `SUPABASE_URL` and anon-key paths removed.

### 4.7 Updates for the all-in-one image and the store installs

RFC-023 §4.11 states the auto-update contract and its two git/compose shapes:

1. the update arrives without the household doing anything;
2. a verified backup comes first;
3. migrations run once;
4. only what changed is recreated;
5. the jobs stay current;
6. the log is clear;
7. a failed update recovers on its own.

This section applies the contract to the all-in-one image and to installs made
from a store.

**An all-in-one update is a new container.** The image never replaces itself
from inside. A process that pulls its own successor and stops itself has no
one left to roll back when the successor fails. The container is replaced from
outside, by one of these, per platform:

| Platform | Who replaces the container | What we provide | Contract items covered by us, not the platform |
|---|---|---|---|
| **Plain Docker / any Compose UI** | `kinboard-updater` in **container mode** (RFC-023 §4.11.3), opted in with a second container started next to it. Watchtower is not recommended: it was archived upstream in 2024 (`docker-compose.diun.yml:2-5`) and has no backup or health rollback | the updater | all seven |
| **Unraid** (template by URL; CA when §11.2 allows) | Unraid's Docker page shows "update ready" when the registry digest of the template's tag differs from the local image, and **Apply Update** recreates it from the template (inferred, Unraid's standard behaviour; to confirm in §10). Fully automatic only with the community "Auto Update Applications" plugin, also inferred. Or `kinboard-updater` in container mode | the template's `Repository` tag; `Changes` from `CHANGELOG.md` (§5.1) | backup (2), migrations once (3, in the image), health and rollback (7), by the image's own start checks below; with Unraid's own mechanism, the rollback is the household's (the previous tag in the template) |
| **TrueNAS** | the catalog: Renovate bumps our app's image versions (§5.2), and TrueNAS offers the app update in its UI | a release with a semver tag and a stable image digest; migrations safe to run unattended (they are: the entrypoint runs them once, `webapp-entrypoint.sh:69-87`); the compose shape, not the all-in-one | 2, 3, 7 by the image; TrueNAS's app upgrade can snapshot its ix-volumes first (inferred, to confirm) |
| **CasaOS / ZimaOS** | the store, when our listing's `version` changes (§5.3) | the listing regenerated from `dist/kinboard.yaml` with the new version and digest (§7) | 2, 3, 7 by the image |
| **Umbrel** | a changed manifest `version` offers the update (§5.4, read) | the manifest and compose regenerated per release, images pinned by digest | 2, 3, 7 by the image |

**What the image itself guarantees at every start**, whatever replaced it.
This is what makes a store's own update button safe:

- **A verified backup before any migration that will run.** The entrypoint
  asks `migrate.sh` which files are pending, a dry run of the checksum logic
  at `migrate.sh:76-96`. If any are, it first writes a verified dump to
  `/data/backups/` (all-in-one) or the config volume's `backups/` (compose),
  with the self-update's checks (`kinboard-self-update.sh:131-160`), keeping
  five. No verified dump, no migration, no start. The log says why.
- **Migrations once**, as today.
- **A health check** in the image (§6), so every platform's own health display
  is truthful.
- **A previous-version record.** The image writes its version and digest to
  `/data/config/updater/last-good` after its first healthy minute. On a start
  whose migrations fail, the log and the status record (RFC-023 §4.11.4) name
  the version to go back to. Settings shows the RFC-023 rollback notice as soon
  as the previous image runs again.

**PostgreSQL major upgrades in the all-in-one image are never automatic
without a verified dump** (§4.3). The order:

1. the dump is verified;
2. `pg_upgrade` writes the new cluster into `/data/db.new`, leaving `/data/db`
   untouched;
3. the switch is a rename, done only after the new server answers, keeping
   the old cluster as `/data/db.old`;
4. if the first healthy minute doesn't come, the previous image's start
   renames them back (§4.3 step 4).

A failure at any step leaves `/data/db` as the previous image needs it, so
rolling back to the previous tag works. Verified in §10.

**How our tags map to the stores' channels**
(`.github/workflows/docker.yml:133-158`):

| Store | Stable | Release candidates | Pinned | Updates automatically? |
|---|---|---|---|---|
| Unraid (template) | `latest` (the default) | `next`, offered through CA's `Branch` element as a second tag (field reference, §5.1) | a version tag entered by the household | no; "update ready", then Apply. Yes with the Auto Update plugin or the updater |
| TrueNAS | the catalog's version, a pinned `X.Y.Z@sha256` (§5.2) | not offered: the community train lists releases only | the catalog pins anyway | asks the household (inferred) |
| CasaOS / ZimaOS | the listing's `version`, pinned | not offered | — | asks the household (inferred) |
| Umbrel | the manifest's `version`, digest-pinned (§5.4) | not offered in the main store; possible in a community store (§11.10) | — | as Umbrel's settings say (inferred) |
| Portainer templates | `latest` | a second template on `next` | — | no; the updater in container mode |
| `compose.yml` / plain Docker | `latest` | `next` | `X.Y.Z` | with the updater, yes |

Pinned tags never move, through any of these.

## 5. The stores

What each store requires, as its own documentation says on 2026-11-26.

- **Marking.** "Read" marks what the page says. "Inferred" marks a conclusion
  the page doesn't state.
- **Multi-arch.** Kinboard already publishes `linux/amd64` and `linux/arm64`
  for every tag (Appendix A), which covers every store's architecture rules
  below.

### 5.1 Unraid Community Applications

Sources:

- https://ca.unraid.net/submit/help
- https://ca.unraid.net/submit/help/xml-field-reference
- https://ca.unraid.net/submit/help/repository-xml
- the starter template,
  https://raw.githubusercontent.com/unraid/unraid-community-apps-starter/main/templates/example-app.xml
- the policies, https://forums.unraid.net/topic/87144-ca-application-policies/

| | Requirement | Kinboard |
|---|---|---|
| **License** | "an OSI-approved `LICENSE` file at the repository root" (read, submit/help) | **not met**: PolyForm Noncommercial. §11.2 |
| Shape | one XML file per app, one container per template (`<Container version="2">`, one `Repository`) (read). A compose package type (`AppTemplateType=compose`, `ComposeProjectPath`, `ComposeSourceRepository`, `ComposeSourceCommit` as a full 40-character SHA) is in the field reference "for Unraid 8"; its contract page answered 404 (read; contract unverified) | the all-in-one image (§4.2). The compose type once its contract is published |
| Repository | a public, active GitHub repository with `ca_profile.xml` at the root (a non-empty `<Profile>`), templates under `templates/`; submitted at https://ca.unraid.net/submit (validate, scan, duplicate sweep, review); "Approved apps appear after the next catalog build" (read) | a new repository, `kinboard-unraid`, holding only generated files (§7), so the main repository needs no CA-specific layout. Decided (§11.9): the separate repository, created only when phase 5 needs it |
| Fields | minimum `Name`, `Repository`; recommended `Category`, `Icon`, `Overview`, `Project`, `Support`, `TemplateURL`; then `Registry`, `WebUI` (`http://[IP]:[PORT:3000]`, always the container port), `Config` entries (`Type="Port|Path|Variable"`, `Target`, `Default`, `Mode`, `Display="always|advanced"`, `Required`, `Mask`), `ExtraParams`, `Requires`, `Beta`, `Changes`, `Screenshot`, `ReadMe` (read) | all generated. `Mask="true"` for any secret a household sets by hand. `ExtraParams` carries `--stop-timeout=60` (§4.2), which CA may "rewrite or reject" (read), to be confirmed at review |
| Paths, user | `/mnt/user/appdata/<app>`; `PUID` 99, `PGID` 100 in the starter (read) | `/data` → `/mnt/user/appdata/kinboard`; `PUID=99`, `PGID=100` (§6.3) |
| Icon, screenshots | an icon URL, no animated icons, the placeholder is rejected; no published size (read) | `assets/logos/kinboard-logo-icon-512.png` from raw.githubusercontent; screenshots optional |
| Support | `Support` or `Project` is required (read). A forum thread per app is the community norm, not a written rule (inferred from the docs expecting developers to answer in their threads) | GitHub Discussions as `Support`; a forum thread is §11.6 |
| Policies | two-factor authentication on GitHub and the registry; no templates that are "obvious CA conversions from a dockerHub search"; a security violation (commands chained after `docker run`) blacklists "an author's entire template repository"; abandoned apps may be removed (read) | 2FA to confirm on the publishing account |
| Databases | `Requires` is free text. Immich's Unraid page sends households to install PostgreSQL and Redis as separate CA containers first (read, https://raw.githubusercontent.com/immich-app/immich/main/docs/docs/install/unraid.md) | why the all-in-one image matters here: a second container to set up by hand is the friction CA households complain about (inferred) |
| Updates | the household pulls the template's tag; `Changes` shows the changelog (read) | `latest`; `Changes` from `CHANGELOG.md` |

**Without CA.** Unraid's Docker page can take a template by URL, or a
template repository added by hand (inferred from how CA templates are
distributed; to confirm on a real Unraid 7 box in §10). The generated template
is usable that way from phase 5, whatever the license.

### 5.2 TrueNAS (24.10 and later)

Source: https://github.com/truenas/apps/blob/master/CONTRIBUTIONS.md (read;
the README's link to `CONTRIBUTING.md` is a 404).

| | Requirement | Kinboard |
|---|---|---|
| Shape | Docker Compose, rendered from Jinja2 with TrueNAS's Python library: `ix-dev/community/<app>/` with `app.yaml`, `ix_values.yaml`, `questions.yaml`, `README.md`, `templates/docker-compose.yaml`, `templates/test_values/basic-values.yaml` (required) (read) | the compose shape. PostgreSQL as its own service from `kinboard-postgres:17`. Other apps use `tpl.deps.postgres(…)` (`paperless-ngx`, `mealie`, `immich`, read), but its stock image can't load `safeupdate` (§4.2.1) |
| Train | new apps go to `community`; `stable` and `enterprise` are iXsystems' (read) | `community` |
| Images | pinned `tag@sha256`; keys in `ix_values.yaml` end in `image` (read) | the generator pins the index digest of each release |
| User | `run_as_context` declares uid/gid 568 ("apps"), as metadata (read) | the webapp image honours `PUID`/`PGID` (§6.3); PostgreSQL through TrueNAS's helper |
| Storage | `ix_volume` by default, `host_path` as an alternative (read) | three volumes, as in RFC-023 |
| Health | `app.healthcheck.set_test(…)`; best practice, not stated as required (read) | `/api/health` |
| Icon, screenshots | `icon` and `screenshots` in `app.yaml`; the reviewer uploads them to TrueNAS's CDN (read) | from §7 |
| PostgreSQL majors | apps ship TrueNAS's `postgres-upgrade` image for major upgrades (read, `paperless-ngx/ix_values.yaml`) | `kinboard-postgres:17` as a plain service rather than `tpl.deps.postgres`, because the stock sidecar can't load `safeupdate` (§4.2.1); TrueNAS's `postgres-upgrade` image to be rehearsed against it before listing |
| Process | open an issue before the pull request; CI tests, then human review; inclusion at their discretion; apps that use the TrueNAS host API are refused (read) | an issue first, in phase 6 |
| Updates | "updates are picked up automatically" by their Renovate bot; no version-bump PRs; bump `version` for packaging changes (read) | nothing to do per release. The compose revision (RFC-023 §4.6) becomes a packaging change |

### 5.3 CasaOS / ZimaOS

Source: https://github.com/IceWhaleTech/CasaOS-AppStore, its `CONTRIBUTING.md`,
`docs/specs/compose-and-x-casaos.md`, `docs/specs/assets-and-i18n.md` and
`docs/faq/overview.md` (read). The repository now serves ZimaOS too, and
third-party stores are supported (`docs/guides/third-party-store-guide.md`,
read).

| | Requirement | Kinboard |
|---|---|---|
| Shape | `Apps/<folder>/docker-compose.yml` with an `x-casaos` block; multi-container allowed (Immich ships server, ML, Valkey and PostgreSQL, read) | the compose shape |
| Required `x-casaos` | `id` (reverse domain), `main` (the UI service, not the database), `port_map` (a quoted string), `icon`, `title` (per locale), `category`, `version` (semver) (read) | all from §7; `main: webapp` |
| Recommended | `index`, `tagline`, `description`, `author`, `developer`, `architectures`; optional `screenshot_link`, `thumbnail`, `tips`, `release_notes`, `website`, `repo`, `support` (read) | all from §7; `tips` carries the first-run hint (§8) |
| Categories | a fixed list: Media, Productivity, Home, Networking, AI, Finance, Social, Developer, Others (read) | Home |
| Architectures | declared values are checked against the image; a mismatch fails the build (read) | `amd64`, `arm64` |
| Validation | `docker compose config -q` must pass (read) | in CI (§6.5) |
| Paths, user | `/DATA/AppData/<app>/…` (read, in the Immich app); no PUID/PGID rule (inferred: per app) | `/DATA/AppData/kinboard/{db,storage,config}` |
| Icon | svg, png, jpg or webp; `icon.svg` preferred (read) | `webapp/public/icons/icon-512.svg` |

A store listing is a curated compose file, so RFC-023's finding that CasaOS's
*custom import* drops `${VAR:-default}` doesn't apply here. The generator
writes literal values (§7).

### 5.4 Umbrel

Sources: https://github.com/getumbrel/umbrel-apps (the README and its
packaging guide under `.agents/skills/umbrel-package-app/`) and
https://github.com/getumbrel/umbrel-community-app-store (read).

| | Requirement | Kinboard |
|---|---|---|
| Shape | an `umbrel-app.yml` manifest and a `docker-compose.yml` with Umbrel's `app_proxy` service; sidecars expected: "do not collapse them into one container" (read) | the compose shape. The all-in-one image is explicitly not what Umbrel wants |
| Manifest | `manifestVersion`, `id`, `category`, `name`, `version` (the upstream version, never `latest`), `tagline`, `description`, `releaseNotes`, `developer`, `website`, `dependencies` (other Umbrel apps only, not one's own PostgreSQL), `repo`, `support`, `port` (unique across the store), `gallery` (left empty; Umbrel's team adds the images), `path`, `defaultUsername`/`defaultPassword`, `submitter`, `submission` (read) | from §7. No default credentials: a family is created at first start |
| Images | `linux/amd64` **and** `linux/arm64` required; every image pinned `repo:tag@sha256:<index digest>`; no `build:` (read) | met; the generator pins digests |
| Docker socket | not allowed (read) | none in the compose shape (RFC-023 §6.6) |
| Data, user | bind mounts under `${APP_DATA_DIR}/data/…`, never named volumes; directories owned 1000:1000, `user: "1000:1000"` where the image allows it (read) | three bind mounts; `PUID`/`PGID` 1000 (§6.3). PostgreSQL and PostgREST keep their own users, to check against Umbrel's review |
| Secrets | `derive_entropy` gives per-app secrets (read) | can feed RFC-023's precedence as environment values, which then win. Or leave it to the init step |
| UI | must open to a browser UI through `app_proxy` (`APP_HOST=<app-id>_<service>_1`, `APP_PORT`) (read) | `webapp`:3000 |
| Updates | a changed manifest `version` offers the update (read) | one manifest per release, generated |
| Alternative | a community app store: a GitHub repository households add by URL; app IDs prefixed with the store's ID (read) | possible from phase 4, without review |

### 5.5 Portainer app templates

Sources: https://docs.portainer.io/advanced/app-templates/format,
https://docs.portainer.io/admin/settings/general,
https://github.com/portainer/templates (read).

- **Formats.**
  - Type 1 is a single container; type 3 is a compose stack.
  - A type 3 template points at a compose file in a public Git repository
    (`repository: {url, stackfile}`).
  - Optional fields: `env[]` (name, label, default, preset, select),
    `volumes`, `ports`, `categories`, `logo`, `platform`.
  - Version 3 of the format (with a numeric `id`) is on the `v3` branch of
    portainer/templates; the docs still describe version 2 (read).
- **Distribution.** A household adds a template URL under Settings → App
  Templates (read). The built-in list is Portainer's own; there is no public
  submission store (inferred).
- **Kinboard.** One generated `portainer-templates.json` with both: type 3
  pointing at `compose.yml` in the main repository, and type 1 for the
  all-in-one image once it exists. Published with the release; the URL goes
  into the Compose UIs page.

### 5.6 Synology Container Manager

- **Projects are compose files** with a name and a working directory (read,
  from a search summary of
  https://kb.synology.com/en-global/DSM/help/ContainerManager/docker_project?version=7;
  the page itself is rendered by JavaScript and couldn't be fetched).
- **There is no container store to submit to.** Package Center takes SPK
  packages (inferred; the publishing page answered 403).
- **An SPK can wrap a compose project** through the Docker Project worker,
  from Container Manager 1432 (DSM 7.2.1)
  (https://help.synology.com/developer-guide/resource_acquisition/docker-project.html,
  read). That is a packaging project of its own and not proposed.
- **The convention** is `/volume1/docker/<app>`, with PUID/PGID read with `id`
  over SSH (inferred, a community convention).
- **Kinboard:** a Synology section on the Compose UIs page (RFC-023 §4.10),
  with the three directories under `/volume1/docker/kinboard`.

### 5.7 YunoHost: not realistic

- **YunoHost packages install apps natively.** Its manifest v2 provides a
  PostgreSQL database and a system user, and sources may be extracted from a
  Docker image, but the app then runs under systemd, not Docker
  (https://doc.yunohost.org/dev/packaging/resources, read).
- **Docker integration is discouraged** as "a hell of development work"
  (https://forum.yunohost.org/t/yunohost-docker-containerized-app-packaging/27900,
  read).
- **Free licenses are the rule**, and non-free apps are taken case by case
  (https://doc.yunohost.org/dev/packaging/policy, read).
- **The verdict.** Kinboard would need a native port: Node under systemd, a
  YunoHost-managed PostgreSQL with the role bootstrap, the PostgREST binary
  and an nginx configuration. That is a separate product effort (inferred).
  Not proposed.

### 5.8 Precedents for PostgreSQL in the app's own container

- **Nextcloud AIO** is not one container. Its "mastercontainer" starts the
  others through the Docker socket (https://github.com/nextcloud/all-in-one,
  read). That is the pattern Umbrel forbids, and §4.2 does not copy it.
- **GitLab's Omnibus image** bundles PostgreSQL and runs `pg-upgrade` on
  package upgrades, with an opt-out (`GITLAB_SKIP_PG_UPGRADE=true`)
  (https://docs.gitlab.com/omnibus/settings/database/, read). That is the
  closest model for §4.3.
- **`pgautoupgrade`** detects the data directory's major and runs
  `pg_upgrade --link` after a backup
  (https://github.com/pgautoupgrade/docker-pgautoupgrade, read). §4.3 uses copy
  mode instead, so a failure leaves the old cluster untouched, at the cost of
  disk space.
- **s6-overlay v3**
  (https://github.com/just-containers/s6-overlay, read):
  - services live in `/etc/s6-overlay/s6-rc.d/<svc>/` with `type`, `run` or
    `up`, and `dependencies.d/`, enabled through `user/contents.d`;
  - `S6_CMD_WAIT_FOR_SERVICES_MAXTIME` defaults to 0 (wait forever);
  - running the whole tree under `USER` is supported with limits and "not
    advised" for more than a few services, which is why §6.3 starts as root and
    drops privileges per service.

## 6. What makes it professional

Both images, the same rules.

| Item | Today (1.17.0, checked) | Proposal |
|---|---|---|
| Multi-arch | amd64 and arm64, built natively, merged by digest | unchanged; the all-in-one image the same way |
| Versioned tags | `X.Y.Z`, `X.Y`, `X`, `latest` (stable), `next` (release candidates), `sha-<short>` (`docker.yml:133-158`) | unchanged; the same for `kinboard-aio` |
| OCI labels | title, description, url, source, version, revision, created; **`licenses: NOASSERTION`** | set `org.opencontainers.image.licenses=PolyForm-Noncommercial-1.0.0` explicitly. GitHub reports the repository's license as `other` (`gh repo view --json licenseInfo`), which `metadata-action` turns into `NOASSERTION`. Add `documentation` (the wiki) and `vendor`. Also as **index annotations**, since the merged manifest list has none (`docker buildx imagetools create --annotation`), so registries that read the index show them (https://github.com/opencontainers/image-spec/blob/main/annotations.md) |
| Health check | in compose only | `HEALTHCHECK` in both images (§4.2) |
| User | starts as root; the server drops to `nextjs` (uid 1001) | §6.3 |
| No required environment | compose: RFC-023; all-in-one: the same init step | nothing must be set to start |
| Logs | stdout | stdout. In the all-in-one image s6 forwards each service's output with a prefix (`[postgres]`, `[rest]`, `[webapp]`) |
| Resources | undocumented | measured and published (§6.4) |
| SBOM | none | `sbom: true` on `docker/build-push-action`. The per-platform attestations already survive the digest merge: the 1.17.0 index lists an `attestation-manifest` for each platform. Whether the SBOM rides along the same way is to be verified in the PR (https://docs.docker.com/build/ci/github-actions/attestations/) |
| Provenance | present, `mode=max`: `docker/build-push-action` uses max for public repositories (https://docs.docker.com/build/ci/github-actions/attestations/) | unchanged; say so explicitly in the workflow, so a change of default can't lower it |
| Release notes | stable: by hand, the `CHANGELOG.md` section (`RELEASE.md:214-217`); release candidates: GitHub's generated notes (`docker.yml`, release-prerelease job) | both from `CHANGELOG.md` in the workflow, with the same `awk` extraction, so the notes are the changelog, reproducibly. The store listings link to them (§7) |

### 6.3 Non-root and PUID/PGID

NAS shares are owned by a household's user. Unraid's convention is
`nobody:users`, 99:100; most other systems use 1000:1000. Files written as
root are a nuisance there, and some shares refuse them.

- **All-in-one image.** Only s6's `init-perms` step runs as root. It creates a
  user and group with `PUID` and `PGID` (default 1000:1000; Unraid's template
  sets 99:100), `chown`s `/data` once when the owner differs, and sets `UMASK`
  (default 022, secrets 077). Every long-running process then runs as that
  user, PostgreSQL included: it needs only a non-root owner of its data
  directory with mode 0700. With one user owning everything, the secrets are
  `0600`, tighter than RFC-023's `0640 root:0`, which exists only for
  PostgREST's fixed uid in its own image.
- **Compose.** The webapp image gains `PUID`/`PGID` too: the entrypoint
  `chown`s the storage directory to them instead of to `nextjs` (today
  `webapp-entrypoint.sh:152-153, 205`) and starts the server as that user.
  Unset, nothing changes: `nextjs`, as today. PostgreSQL and PostgREST keep
  their images' users.

### 6.4 Resource needs, documented

Published in the wiki and in every listing:

| | |
|---|---|
| Disk, images | compose about 2.4 GB with go2rtc (measured locally: `supabase/postgres` 1.67 GB, go2rtc 362 MB, webapp about 313 MB, PostgREST 28 MB). All-in-one: to be measured; the estimate is under 500 MB |
| Disk, data | the database is 24 MB on the development machine (`pg_database_size`, 1 family); uploads are what grows |
| Memory, idle | db 59 MiB and PostgREST 48 MiB measured on the development machine; the webapp to be measured. Both shapes to be measured on a Raspberry Pi 4 (4 GB) and a Pi 5 before the first listing |
| CPU | to be measured on the same Pis, idle and during a calendar sync |

### 6.5 The CI matrix

A new workflow, `images.yml`, on pull requests that touch the Dockerfile,
`webapp/docker/**` or the store metadata, and on every tag:

| Job | amd64 | arm64 |
|---|---|---|
| Start `compose.yml` fresh; wait for `/api/health` 200 with `db:true`, with a timeout; create a family over the API; check the secrets' modes | ✓ | ✓ |
| Start the all-in-one image fresh, the same checks; plus `docker stop` takes under 60 s and the next start logs no WAL recovery | ✓ | ✓ |
| Upgrade the previous release's image of each shape to this one on the same data; data fingerprint unchanged (the `test-upgrade.sh` fingerprint) | ✓ | ✓ |
| Export from compose, import into all-in-one, and back; data, files and VAPID public key unchanged | ✓ | — |
| Render every store listing from the metadata file (§7) and validate it: XML schema for CA, `docker compose config` for the compose-based stores, the store's own linter where one exists | ✓ | — |
| **RLS on stock PostgreSQL, mandatory.** A database set up fresh on `postgres:17` with the bootstrap (§4.2.1) and the full migration run, then: every spec that uses the database helper (`e2e/whole-database.ts`; 59 specs, among them `families-grants`, `camera-takeover-grants`, `pocket-money-grants`, `school-holidays-grants`, `layouts-db`, `family-delete-db`), pointed at it with `KINBOARD_DB_CONTAINER`; the static RLS specs (`rls-coverage`, `family-scope`); and a new `rls-matrix` spec over `/rest/v1` for **every** table with RLS. Through `/rest/v1`, the `rls-matrix` spec checks that family A's token reads none of family B's rows, can't insert a row for B, and changes 0 of B's rows on update or delete; that the bare anon role (no `Authorization`) reads 0 rows from every family table; and that the service role reads exactly the row counts a superuser `count(*)` gives, as today | ✓ | ✓ |
| **Identical policies.** After the full migration run on `supabase/postgres:15.14.1.159`, on `postgres:15` and on `postgres:17`, dump and compare: `pg_policies` (table, name, permissive, roles, command, `qual`, `with_check`); `relrowsecurity`/`relforcerowsecurity` for every `public` table; `information_schema.role_table_grants` and `routine_privileges` for `anon`, `authenticated` and `service_role`; `pg_roles` attributes, `pg_auth_members` and `pg_db_role_setting` for the roles of §4.2.1; `pg_default_acl`. Any difference fails. Two comparisons: the first pair isolates the image's differences from the version's, the second the version's. A deparse difference between majors in a `qual` is reviewed once and then fails like any other | ✓ | — |
| **Filterless writes refused, in the database.** On `supabase/postgres` 15 (today's compose), `kinboard-postgres:17` (the stock compose) and the all-in-one image: as `authenticator` switched to `service_role` and to `authenticated`, an `UPDATE` and a `DELETE` without `WHERE` fail with safeupdate's message, and the row count is unchanged. Sent straight to PostgREST inside the stack, bypassing the app's guard, so the database layer is what's tested. **Proven to fail:** the same job runs once with `session_preload_libraries` reset on `authenticator`, and must then see the rows gone | ✓ | ✓ |
| **Updates, every shape.** RFC-023 §8.4's two-updates-in-a-row run for the all-in-one image under `kinboard-updater` in container mode: first update backs up and recreates; second does nothing; a broken build rolls back with the notice; a pinned tag stays; offline is skipped and retried. Plus the all-in-one image's own start checks: a pending migration without a verifiable dump refuses to start, and the major-upgrade failure leaves `/data/db` untouched | ✓ | ✓ |
| **Filterless writes refused, in the app.** A unit test (`unit` project) calls `update()` and `delete()` without a filter on the browser and the server client with a stub `fetch`: `UnfilteredWriteError`, and the stub is never called. With `.allowUnfiltered("test")` the request goes out without the marker header. **Proven to fail:** the test also runs against a client built with the guard disabled (a test-only flag) and asserts the stub *was* called, so a guard that never fires can't pass. A second check lists every `allowUnfiltered(` in `src`; the list is a committed file, and a new use without updating it fails | ✓ | — |

The arm64 jobs run on the `ubuntu-24.04-arm` runners the build already uses
(`docker.yml:98`).

## 7. One metadata file for every listing

The product name, texts, icons, screenshots, ports, paths and support links
live in **one file**, `dist/kinboard.yaml`. Each store's listing is generated
from it by `scripts/build-store-listings.mjs` into `dist/<store>/`. CI fails
when a generated file is out of date, the same pattern as the migration-order
check (`webapp/docker/check-migration-order.mjs`). A wording change is one
edit, and every store shows the same thing.

**`dist/kinboard.yaml` holds:**

| Key | Content | Used by |
|---|---|---|
| `name`, `id` | Kinboard; `app.kinboard` | all; the reverse-domain id for CasaOS |
| `tagline` | "Your family's day, on one screen" (the README's heading) | CasaOS, Umbrel, the CA overview's first line |
| `description.short` | the repository description (under 512 characters, GHCR's limit for the description annotation) | OCI labels and annotations, Portainer, CA |
| `description.long` | per language: `en`, `de` to start (CasaOS's `title` and `description` are per locale) | CasaOS, Umbrel, TrueNAS README, CA `Overview` |
| `categories` | one internal list, mapped per store: CasaOS `Home`, CA `Productivity:` and `HomeAutomation:` (to confirm against CA's list), Umbrel and TrueNAS their nearest | all |
| `icon` | `assets/logos/kinboard-logo-icon-512.png` and `webapp/public/icons/icon-512.svg` | CA (PNG URL), CasaOS (SVG preferred), TrueNAS, Portainer `logo` |
| `screenshots` | a fixed set of 4–6 from the screen matrix: Home portrait and landscape, calendar, shopping, the screensaver; light | CasaOS, TrueNAS, CA `Screenshot`; Umbrel takes images in review |
| `links` | website `https://kinboard.app`, source, docs (the wiki), support (GitHub Discussions; the Unraid forum thread if §11.6 says so), changelog (the release page) | all |
| `license` | `PolyForm-Noncommercial-1.0.0` (SPDX) | OCI `licenses`, CA, TrueNAS |
| `maintainer` | the GitHub account and the security contact in `SECURITY.md`. No personal email in any listing | all |
| `ports` | `3000/tcp`, web UI, default host port 3001 | all |
| `volumes` | `db`, `storage`, `config`, each with a per-store default path: Unraid `/mnt/user/appdata/kinboard/…`, CasaOS `/DATA/AppData/kinboard/…`, Umbrel `${APP_DATA_DIR}/data/…`, Synology `/volume1/docker/kinboard/…`; the all-in-one image's single `/data` | all |
| `env` | the optional variables of RFC-023 §4.6, with labels and which are advanced. `PUID`/`PGID` with per-store defaults | CA `Config`, TrueNAS `questions.yaml`, Portainer `env` |
| `images` | the image names, the one source `docker.yml` also reads (§4.5), and at release time each image's index digest | Umbrel and TrueNAS pins; the workflow's image names |

**Generated, never edited by hand:**

- `dist/unraid/kinboard.xml` and `ca_profile.xml`;
- `dist/truenas/ix-dev/community/kinboard/…`;
- `dist/casaos/Apps/Kinboard/docker-compose.yml`;
- `dist/umbrel/kinboard/{umbrel-app.yml,docker-compose.yml}`;
- `dist/portainer/templates.json`;
- the OCI labels and annotations in `docker.yml`, through `metadata-action`'s
  label and annotation inputs.

The store repositories (CA's, TrueNAS's, CasaOS's, Umbrel's) receive copies
through pull requests the maintainer opens in phase 6. Nothing pushes to them
automatically.

**Assets.** Today's icons are 192 and 512 px PNG plus SVG
(`assets/logos/`, `webapp/public/icons/`). The wiki has 83 screenshots
(`docs/wiki/images/`), light and dark, at wiki sizes. No store found here
publishes required pixel sizes; Umbrel and TrueNAS take images in review.
Decided (§11.8): a dedicated set generated from the screen matrix later; the
wiki images meanwhile.

## 8. First run in the app, instead of `setup.sh`'s questions

`setup.sh` asks the household for six things:

- the address (`:102-182`);
- a maintainer email for push (`:374-390`);
- an OpenWeatherMap key (`:392`);
- the Google client (`:402-403`);
- under `--advanced`, Immich and Bring!, which nothing reads (RFC-023 §4.4),
  and camera hosts.

A store install answers none of them. The app already has a first-run flow,
creating or joining a family at `/join` (`webapp/src/app/join`, wiki
`Onboarding.md`). After a family is created, it gains a short, skippable
"Set up this install" sequence, shown once, to whoever created the first
family:

1. **Address.** "Kinboard will put this address in calendar links: `<the
   address this page was opened at>`. Change it?" That writes `SITE_URL`'s
   replacement, an instance setting. The variable still wins when set.
2. **Notifications.** Push works already, because the VAPID keys exist (RFC-023
   §4.1). Optionally, an email address for push services (`VAPID_SUBJECT`),
   which today defaults to `mailto:admin@example.com`
   (`src/lib/push-sender.ts:66-71`).
3. **Weather.** The OpenWeatherMap key, with the sign-up link. The same field
   as Settings → Weather (RFC-023 §4.4).
4. **Google Calendar.** Skippable, with a link to the walkthrough; the same
   fields as Settings.
5. **Settings PIN.** The existing PIN, offered here because a wall screen
   needs it before anything else.

Every step can be skipped and found again in Settings. None of them is
required for Kinboard to work.

## 9. Phases

Each phase ships on its own. None depends on a store accepting anything.
Phase 7 doesn't wait for phase 6: it needs only phase 3.

| Phase | What | Needs |
|---|---|---|
| 0 | RFC-023, built and rehearsed | — |
| 1a | **The app-side guard against filterless writes** (§4.2.1): the `fetch` check, `allowUnfiltered`, the unit test. It lands **first and alone**, on today's `supabase-js` clients, and is independent of every other phase: a cheap second safety net for today's installs, which already have `safeupdate` in `supabase/postgres` | — |
| 1 | **The professional bar on today's image:** labels and annotations, `HEALTHCHECK`, SBOM, release notes from the changelog, PUID/PGID in the compose image, the resource measurements | — (independent of 0) |
| 2 | **The first-run sequence** (§8) | RFC-023's keys in Settings |
| 3 | **Stock PostgreSQL for new installs:** the role bootstrap in `kinboard-db-init`; the fresh-install rig run against `postgres:17`; the RLS, policy-comparison and filterless-write checks of §6.5 green, which is the gate for any stock-PostgreSQL install | 0 |
| 4 | **The metadata file and the compose listings** for TrueNAS, CasaOS/ZimaOS, Umbrel and Portainer, generated and validated in CI, each installed by hand on that system (§10) | 0, 3 |
| 5 | **The all-in-one image** as `kinboard-aio:next`: the second Dockerfile stage, s6, `kinboard export`/`import`, its CI jobs (§6.5); then two release cycles on `next`, the Pi measurements, a rehearsed PostgreSQL major upgrade on a copy of real data, then `latest`. Plus the Unraid template, installable by template URL | 3 |
| 6 | **Submissions**, one store at a time, **when the owner decides** (§11.1). Each has its own checklist in §5. A submission that is refused or delayed blocks nothing else. Unraid CA also needs §11.2 resolved | 4 (compose stores), 5 (Unraid) |
| 7 | **Supabase removed** (§4.6): seven PRs in the order given there. Existing installs unaffected; each step keeps the old name working for at least one release | 3 |

## 10. Rehearsal before any listing

For each store, on that system (a VM where possible: TrueNAS, CasaOS/ZimaOS,
Umbrel and Unraid all run as VMs; Synology DSM only on hardware or its own
virtual DSM):

1. Install from the generated listing, as a household would, through the
   store's own "install from custom template / repository" path.
2. The A1 checks from RFC-023 §8.1: health, family, join, push, the scheduler
   running, secrets kept across a restart.
3. Update to a newer tag through the store's own update button. The version
   changes; the data fingerprint doesn't.
4. Uninstall and reinstall with the data kept. The family is still there.
5. Write down every place the store's UI needed explanation; that goes into
   the listing text or the wiki.
6. **For any listing on stock PostgreSQL, mandatory:** on that installed
   instance, the `rls-matrix` spec (§6.5) runs against its address. Two
   families are created, and each one's token is tried against the other's
   rows on every table, plus the bare anon role and a filterless delete. A
   single readable row from another family stops the listing.
7. **Two updates in a row through the store's own mechanism** (§4.7), from a
   local copy of the listing: TrueNAS with a custom catalog, CasaOS/ZimaOS and
   Umbrel with a third-party/community store, Unraid with a template by URL.
   - **The first update:** a verified backup appears, and migrations run once.
   - **The second:** nothing to do.
   - **A broken build** (an entrypoint that exits, and a migration that fails
     halfway): the store shows the container unhealthy. Going back to the
     previous version, through the store or by tag, brings the app back on the
     newer schema, and Settings shows the notice.
   - **A pinned version** doesn't move.
   - **No network** during the update: nothing half-applied.
   - **For the all-in-one image only:** a PostgreSQL major upgrade forced to
     fail after the dump. `/data/db` is untouched, and the previous tag starts
     on it.

## 11. Decided (2026-11-26), and what stays with the owner

The owner approved the RFC on 2026-11-26. Three questions stay with the
owner; nothing in this work waits on them.

1. **Stays with the owner: when to submit, and to which stores first.** No
   submission is part of this work. Phase 6 starts when the owner says so (§9).
2. **Stays with the owner: the license.** Unraid CA requires an OSI-approved
   license (§5.1); PolyForm Noncommercial is not one. Listings are prepared
   (phases 4 and 5) whatever the outcome.
3. **Decided: a separate image, `kinboard-aio`**, with the same version and
   channel tags as `kinboard` (§4.5).
4. **Decided: existing compose installs stay on `supabase/postgres` 15.**
   Stock PostgreSQL (`kinboard-postgres:17`) is for new installs only, with no
   forced dump and restore (§4.4, §4.5).
5. **Decided: go2rtc stays out of the all-in-one image** (§4.2).
6. **Stays with the owner: the Unraid forum support thread.** GitHub
   Discussions is the support link until then (§5.1).
7. **Decided: PUID/PGID default 1000:1000 in the images; the Unraid template
   sets 99:100** (§6.3).
8. **Decided: screenshots come from a dedicated set** generated from the
   screen matrix later; the wiki's images serve meanwhile (§7).
9. **Decided: the Unraid template lives in a separate, generated
   `kinboard-unraid` repository**, created only when phase 5 needs it (§5.1).
10. **Decided: Umbrel's community app store comes later, at submission time**
    (§5.4), not ahead of it.
11. **Decided with 4:** new store installs, TrueNAS's included, run
    `kinboard-postgres:17` (§4.5, §5.2).
12. **Decided: `safeupdate` in both, the database and the app.**
    `pg-safeupdate` 1.7 is built into the all-in-one image and into
    `kinboard-postgres:17` for the stock compose shape, and preloaded for
    `authenticator`. The app's PostgREST client refuses an unfiltered
    `update()`/`delete()` before sending, with an explicit, reviewed
    `allowUnfiltered`. No shape is weaker than `supabase/postgres` today
    (§4.2.1, §6.5).
13. **Open until phase 7 starts: `db:generate`** (§4.6). The Supabase CLI as a
    pinned dev-only generator is proposed.
14. **Open until phase 7's last step: when the legacy `SUPABASE_URL` path
    goes** (§4.6 step 7).

## 12. Not in this RFC

Everything RFC-023 decides. A Kubernetes chart. Store-specific features
(Umbrel's app proxy auth, TrueNAS's ix volumes) beyond what a listing needs to
work. Paid or hosted distribution. A rename of anything.

## Appendix A — What was verified, and how

On 2026-11-26, read-only, against the registry and images already on the
development machine.

| Claim | How | Result |
|---|---|---|
| The published image's platforms, labels and attestations | `docker buildx imagetools inspect ghcr.io/svenger87/kinboard:1.17.0`, also `--format '{{json .Image}}'`, `'{{json .SBOM}}'` and `'{{json .Provenance}}'` | linux/amd64 and linux/arm64, each with an attestation manifest; OCI labels as in §6, `licenses: NOASSERTION`; user `root`; no health check; provenance present (SLSA); SBOM empty |
| Image sizes | `docker image ls` | `supabase/postgres:15.14.1.159` 1.67 GB, `alexxit/go2rtc:1.9.14` 362 MB, the webapp (`:latest` on this machine) 313 MB, `postgrest/postgrest:v14.16` 28 MB, ofelia 39 MB |
| Idle memory | `docker stats --no-stream` on the development stack | db 58.97 MiB, rest 48.47 MiB |
| PostgreSQL majors and packages in Alpine | `apk search` in `alpine:3` (3.24.3); `node:22-alpine` is Alpine 3.24.4 | `postgresql16`, `postgresql17`, `postgresql18`; no `postgresql15`; `postgresql-pg_cron-1.6.7`; `s6-overlay-3.2.3.0`, `s6-rc-0.6.1.1` |
| `safeupdate` behaviour, release and source | `LOAD 'safeupdate'` in a `psql` session on the development database, against a temporary table inside a rolled-back transaction; `gh api repos/eradman/pg-safeupdate/tags`; the 1.7 tarball downloaded, `sha256sum`, `NEWS` read, then deleted | filterless `DELETE`/`UPDATE` refused, `WHERE true` passes; latest tag 1.7 at `37dbc9c4…`; sha256 `456aa0ce…56377`; 1.6 "Do not block pg_upgrade"; ISC license |
| `supautils` settings | `pg_settings` on the development database | `reserved_roles` includes the four API roles; `privileged_extensions` includes `uuid-ossp`, `pg_cron`; `superuser = supabase_admin` |
| Unfiltered writes in the app | a scan of every `.from(…)…update(`/`.delete(` chain in `src` for a filter method before the statement ends | 132 `update`, 65 `delete`; none unfiltered (one false positive, `Set.delete`) |
| Role attributes, memberships, settings, default privileges, policies | `docker exec -i kbfresh-db psql -U supabase_admin` with `SELECT … FROM pg_roles`, `pg_auth_members`, `pg_db_role_setting`, `pg_default_acl`, `pg_namespace`, `pg_policies`, `pg_class`, `information_schema.role_table_grants`, read-only | as in §4.2.1: 64 tables, 57 with RLS, 0 forced; 57 policies on 53 tables, 54 on `current_family_id()`, 0 on `auth.`; the 7 non-RLS tables have no `anon`/`authenticated` grant; `safeupdate` and `supautils` preloaded for `authenticator` |
| PostgREST and `iss`; requests without a key | tokens signed with the development stack's secret, sent to its PostgREST on loopback (the secret never printed) | `iss` `supabase`, `kinboard`, `something-else`: 200; wrong signature: 401; no `Authorization`: 200 as `anon`, `families` → `[]` |
| Where supabase-js is used | `grep` over `src`, `e2e`, `scripts` | imports in `src/lib/supabase/client.ts:1`, `server.ts:1-2` and four e2e specs; 0 `.auth.`, `.channel(`, `.storage.from(`; 31 `.rpc(`; `server.ts`'s `createClient` has 0 importers; `db:generate` writes a file nothing imports |
| The bootstrap on stock PostgreSQL 17, and RLS identical | throwaway `supabase/postgres:15.14.1.159` and `postgres:17-alpine` (pulled for the check, removed afterwards). The latter with `POSTGRES_USER=supabase_admin` and a draft bootstrap. On both: `init.sql` under `--single-transaction` (failure injected once, then for real), `migrate.sh` as `postgres`, then the §6.5 dump compared with `diff` | both: 88 migrations applied; an injected failure left no tables, no extension, no publication members. Identical: 57 policies, 63 RLS flags, 906 table grants, 5 roles, 9 memberships. The draft first failed at `001` ("must be owner of publication"); after the fix, 32 diff lines remained: 30 `uuid-ossp` routine grants and the preload list (§4.2.1) |
| What the schema needs from the database image | `grep` over `init.sql` and `migrations/*.sql`; `pg_extension` on the development database | extensions created: `uuid-ossp`, `pg_cron`; no `cron.schedule`; supabase roles referenced: anon (140), authenticated (135), service_role (90), supabase_admin (3), authenticator (1); `supabase_realtime` 78 times; `auth.jwt` once, in a comment; no `pgcrypto` or `vault` use |

**Assumed, not verified:**

- the s6-overlay behaviour, which comes from its documentation (§5.8 sources);
- that Alpine's PostgreSQL 17 runs the schema, written against 15, with the
  bootstrap;
- the all-in-one image size;
- the SBOM surviving the digest merge;
- that the role bootstrap on stock PostgreSQL reproduces §4.2.1 exactly (the
  comparison in §6.5 proves or refutes it);
- that the two Supabase-only memberships of `postgres` matter to nothing;
- that an Unraid household can install a template by URL without CA (§5.1);
- Synology's project page and publishing rules, which couldn't be fetched
  (§5.6);
- CA's compose package contract, whose page answered 404 (§5.1);
- everything about the stores beyond what their documentation says (§5), each
  marked "read" or "inferred" where it is stated.

Each is a check in §6.5 or §10.
