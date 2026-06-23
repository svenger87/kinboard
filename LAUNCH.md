# Launch readiness checklist

Internal document — review before publishing the public repo. Delete or move to `docs/` after launch.

## Phase 0 — clean public repo (squash-import)

The plan is to publish via a **fresh public GitHub repo seeded from `HEAD` only**. The private GitLab repo stays as the historical home and never becomes public, so the secrets and personal-config bytes that live in committed history don't need to be rotated.

This works because the squash-import doesn't carry any history — only the current tree of `main` (or whichever release tag you cut). Done correctly, the GitHub repo's first commit is byte-identical to `git archive HEAD` extracted into an empty directory, with no `.git/objects/` remnants of anything that came before.

### Procedure

```bash
# 1. From a clean state on the private repo
git checkout main
git pull
# Confirm the working tree is clean
git status

# 2. Make a tarball of the tree at HEAD (no .git, no untracked, no gitignored)
TMPDIR=$(mktemp -d)
git archive HEAD | tar -x -C "$TMPDIR"

# 3. Initialize a new repo from that tarball
cd "$TMPDIR"
git init -b main
git add .
git commit -m "Initial public release"

# 4. Push to the new GitHub repo
git remote add origin git@github.com:svenger87/kinboard.git
git push -u origin main
```

After step 2, sanity-check:

```bash
# Should print zero hits not in the allowlist below
grep -rE 'svenger87|10\.10\.10\.|192\.168\.1\.[0-9]+|S8L4GQ|eyJhbGciOi' "$TMPDIR" \
  | grep -vE '(^|/)(README\.md|CONTRIBUTING\.md|SECURITY\.md|CODE_OF_CONDUCT\.md|CHANGELOG\.md|LAUNCH\.md|FUNDING\.yml|ISSUE_TEMPLATE/config\.yml|messages/(en|de)\.json|docs/wiki/.*\.md|docs/wiki/sync\.sh|docs/wiki/screenshots/scripts/1-clone-prod-db\.sh|\.github/workflows/docker\.yml|webapp/docker/docker-compose\.image\.yml):'
```

Anything left over after that filter is a real leak. The allowlist intentionally permits:

- **Public-repo GitHub URLs** anywhere in `docs/wiki/*.md` (e.g. `github.com/svenger87/kinboard/blob/main/...`) — these point at the project's own source
- **Maintainer contact emails** in CODE_OF_CONDUCT.md + SECURITY.md
- **Sponsor handle** in FUNDING.yml + README + Home.md + _Footer.md
- **Illustrative placeholder LAN IPs** (`192.168.1.100`) in `messages/{en,de}.json` (camera URL examples) and `docs/wiki/Cameras.md`
- **Maintainer GHCR namespace** (`ghcr.io/svenger87/kinboard`) in the Docker pipeline workflow + docker-compose.image.yml
- **NAS path** (`/mnt/user/appdata/kinboard`) in `migrate-prod.sh` as a documented default — overridable via `DATA_DIR=` env var

### What's already in `HEAD` and ready to import

The four `webapp/.env.local` secrets and the `.claude/settings.local.json` SSH path / kiosk password live only in the **private GitLab pack files**. They are not in the working tree at `HEAD`:

- `webapp/.env.local` is gitignored and untracked
- `.claude/settings.local.json` was untracked in the OSS-housekeeping commit and gitignored before
- Personal hostnames (`kinboard.svenger87.de`, `10.10.10.x`, `192.168.1.x`, `/mnt/user/appdata/kinboard`, the `S8L4GQ` family code) are scrubbed from every tracked file in the launch commit (`2286841c`)

So `git archive HEAD` produces a clean tarball. No filter-repo, no rotation, no history rewrite — just the squash import above.

---

## ✅ Phase 1 — pre-launch scrubbing (done in this work session)

### Removed personal hostnames from tracked files

`kinboard.svenger87.de`, `10.10.10.x`, `192.168.1.x`, `/mnt/user/appdata/kinboard` no longer appear in any tracked code path that ships. Files touched:

- `webapp/docker/kong.yml` — Traefik domain dropped from CORS origins (5 entries → comment)
- `webapp/docker/docker-compose.yml` — Traefik labels and bind paths fully templated (earlier work)
- `webapp/src/app/api/cameras/webrtc/route.ts` — fallback now `http://go2rtc:1984` (Docker-internal)
- `webapp/playwright.config.ts` — `process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000"`
- `webapp/e2e/visual-audit.spec.ts` — family code now from `FAMILY_CODE` env var, errors out if unset
- `webapp/test_screensaver_performance.py` — URL + family code now env-driven
- `webapp/deploy.ps1` — refactored like `deploy.sh`, sources `deploy-config.local.ps1`, requires explicit params
- `webapp/deploy.sh` — already refactored (sources `deploy-config.local.sh`)
- `kiosk/kiosk-{cage,gnome,gnome-setup,weston,x11,x11-fallback}.sh` — `${KINBOARD_URL:-http://localhost:3001/}` everywhere
- `kiosk/presence-sensor.py`, `presence-sensor.py`, `tools/notification-tester.py`, `run_simulator.bat` — env-var URL with localhost default
- `.claude/settings.local.json` — untracked + gitignored

### Personal references that are intentional and should stay

These are reasonable for a project authored by you, not a leak:

| File | What | Why it's fine |
| --- | --- | --- |
| `README.md` | clone URL, sponsor link | The project's home |
| `CONTRIBUTING.md` | clone URL | Same |
| `.github/FUNDING.yml` | `github: svenger87` | The sponsor handle |
| `.github/ISSUE_TEMPLATE/config.yml` | discussions + security URLs | Project links |
| `CODE_OF_CONDUCT.md` | `conduct@svenger87.de` | Maintainer contact |
| `SECURITY.md` | `security@svenger87.de` | Maintainer contact |
| `webapp/messages/{en,de}.json` | `192.168.1.100` placeholders | Camera form input examples — illustrate the LAN URL format, not real IPs |
| `webapp/docker/.env.example` | `/mnt/user/appdata/kinboard` | Mentioned only as an example NAS path in a comment |

---

## ✅ Phase 2 — automated launch-readiness checks

These all pass on `HEAD` right now:

```
$ npm run lint                          # webapp/
0 errors (only pre-existing <img> warnings)

$ JSON parse + en/de parity check
2292 keys (incl. new energy namespace), no drift

$ bash -n on shipped scripts
setup.sh, webapp/deploy.sh, webapp/docker/start.sh,
kiosk/kiosk-*.sh — all parse
```

`.github/workflows/ci.yml` runs all of those on every PR.
`.github/workflows/docker.yml` builds + pushes multi-arch (amd64 +
arm64) images to `ghcr.io/svenger87/kinboard` on every push to
main and on tagged releases.

---

## 🟡 Phase 3 — manual verification (you, before launch)

Each item below maps to one of the readiness checks the plan called out. Tick them when done.

- [/] **Fresh-machine test.** In progress on Hetzner CX23 (Ubuntu 24.04, 4 GB RAM). Real bugs caught + fixed in this session:
  1. `.gitattibutes` typo (missing `r`) → git ignored it, scripts shipped with CRLF, bash refused them. Renamed + added `*.sh text eol=lf` etc.
  2. `setup.sh` required Node.js (undocumented) → now degrades gracefully; VAPID becomes opt-in until node is installed
  3. `setup.sh` punted Supabase ANON_KEY/SERVICE_ROLE_KEY to a "go to supabase.com" link → now mints them locally as JWTs signed with the local JWT_SECRET
  4. `.env.example` shipped with CRLF → added `.env*` patterns to gitattributes
  5. `setup.sh` mistook `\r`-trailing values as "already set" and skipped key generation → strip `\r` in the existence check
  6. `README.md` quick-start told user to `cd webapp/docker` then `./setup.sh`, but setup.sh is at the repo root → fixed path + added Docker install one-liner + Node.js note
  7. RAM requirement undocumented; Next.js build peaks ~4 GB; small-RAM VPS fail silently → README note + swap workaround + ghcr.io image alternative
  8. Build OOM'd at type-check phase under default V8 heap (~2 GB), produced no `.next/standalone`, runner stage's COPY failed with a misleading "not found" → bumped `NODE_OPTIONS=--max-old-space-size=4096` in the builder stage + `set -e` + explicit `test -d .next/standalone` so a future regression fails loudly at the right step
  9. Stray root `package.json` (4 lines, only ws as dep) was creating orphan `node_modules/` + `package-lock.json` → untracked + gitignored
  10. `node_modules/` not in root .gitignore → added (with the screenshot toolchain's mock node_modules separately gitignored locally)
  11. Empty `ADDITIONAL_REDIRECT_URLS=` in .env.example crashed gotrue at startup with a nil-pointer panic in URL parsing → defaulted to SITE_URL
  12. `init.sql` mounted at `/docker-entrypoint-initdb.d/init.sql` ran BEFORE supabase's `migrate.sh` in lexical order → CREATE EXTENSION's default-privileges grant against the not-yet-created `supabase_admin` role failed with ON_ERROR_STOP=1, killed entrypoint, all supabase service roles never got created → renamed mount target to `zz-init.sql`
  13. `POSTGRES_PASSWORD = openssl rand -base64 32` produced `/+=` characters → unescaped `/` in `postgres://supabase_auth_admin:Fm/z2yIL...@db:5432/postgres` was parsed as path separator, gotrue panicked with nil-pointer URL → switched POSTGRES_PASSWORD + SECRET_KEY_BASE + CRON_SECRET to `openssl rand -hex` (alphanumeric-only)
  14. supabase image's `migrate.sh` only sets supabase_admin's password, not authenticator/supabase_auth_admin/supabase_storage_admin → `start.sh up` now post-init ALTERs them via `psql -U supabase_admin` (the only role allowed to modify reserved roles)
  15. realtime expects `_realtime` schema some image versions don't auto-create → `start.sh up` post-init `CREATE SCHEMA IF NOT EXISTS _realtime`
  16. "Family Calendar" branding still in 15 user-facing surfaces (sw.js push title, en.json/de.json title, deploy headers, etc.) → bulk rename to "Kinboard"
  - **Pending after current redeploy**: VAPID/notification end-to-end verification + the localhost-baked-in NEXT_PUBLIC_SUPABASE_URL gap
- [ ] **Locale switch.** Boot the app, set locale to English in `/settings/theme` (or your locale picker), open every page in `NAV_ITEMS`. Every visible string is English. Repeat with German. Note any orphan strings.
- [ ] **Plugin disable.** Tesla and Zendure are still in-tree as components today — confirm they're hidden when the corresponding HA entities aren't configured. (The actual plugin extraction is a v1.1 workstream per the plan.)
- [ ] **Onboarding paths.**
  - [ ] First-run with empty DB → `/join` shows the "Welcome — let's set things up" card and Create-only mode.
  - [ ] Join from a second device with the 6-char code.
  - [ ] Add a Google calendar from `/settings/google` end-to-end.
  - [ ] Connect Home Assistant from `/settings/homeassistant`.
  - [ ] Add a shopping list item, see it on a second device in <2s.
- [ ] **Public repo created.** `setup.sh --force` on a fresh clone bootstraps cleanly.
- [x] **Screenshots / hero shot.** ✅ 50 screenshots captured (13 routes × 2 themes × 2 viewports) via the toolchain in `docs/wiki/screenshots/`. README + 14 wiki pages now embed real shots.
- [x] **Schema-drift cleanup.** ✅ Init.sql missing `people.is_child`, `events.person_id`, `birthdays.person_id` — patched. Two new `migration_*.sql` files cover existing-install upgrades. RLS disabled in init.sql to match prod.
- [x] **Build/deploy reliability.** ✅ `deploy.sh` now chains compose overlays so Traefik labels survive recreates. Dockerfile takes optional `NEXT_PUBLIC_SUPABASE_URL` build args (back-compat preserved).
- [x] **CHANGELOG.md.** ✅ Created with `[Unreleased]` section ready to cut into `[1.0.0]` on first tag.

### Notes about Phase 0 secrets

Per the squash-import strategy, **rotation isn't required** as long as
the public repo's first commit is byte-identical to `git archive HEAD`.
The private repo never becomes public, so any historical secrets stay
in the private GitLab pack files. Skip the rotation step unless you
want to anyway as defense-in-depth.

---

## 🚀 Launch sequencing

The plan ordered launch venues by likely traction. When ready:

1. **Home Assistant Community Forum** (`community.home-assistant.io`) — your audience. Open a "Share your projects" thread with screenshots leading the post.
2. **r/selfhosted** — link to the README, lead with the dashboard screenshot.
3. **r/homeautomation** — emphasize the HA integration angle.
4. **Hacker News "Show HN"** — only if README + screenshots are excellent. One shot.
5. **awesome-selfhosted PR** — usually accepted within a week.

### Lead with

- The dashboard aesthetic and monthly themes (visual hook)
- Multi-integration breadth (calendar / weather / photos / shopping / smart home / cameras in one screen)
- Self-hosted, no SaaS dependency
- Real-time sync across devices

### Don't lead with

- The Tesla / Zendure / Immich / Bring! integrations specifically — they're niche. List them in the integrations table; let interested folks self-select.
- Ambition about plugin architectures that don't exist yet. Underpromise on v1.0.

---

## Follow-ups (post-launch, deferred from this audit)

- Plugin extraction (Tesla + Zendure into `webapp/src/plugins/`) — workstream 4 in the plan; deferred to v1.1.
- `init.sql` could ship with structured migrations instead of one monolith — schema change tracking would be cleaner.
- Decide what to do about the duplicate `presence-sensor.py` (root + `kiosk/`). They differ; both are scrubbed; pick one and delete the other.
- The personal personal `.deploy-config.local.sh` doesn't exist yet — make one for your own deploy after rotation, gitignored already.
- README mentions `docs/screenshots/dashboard.png`; add the actual file.
- Country-aware holidays (`getGermanHolidays` is hardcoded to Niedersachsen) — workstream 3 follow-up.
