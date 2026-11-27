# App-store listings

Everything under `dist/<store>/` is **generated**. Don't edit it by hand: CI
fails when it differs from what the generator writes. Design: RFC-024 §5, §7
and §10 (`docs/rfc/024-all-in-one-and-stores.md`).

| Store | Generated here | Format |
|---|---|---|
| TrueNAS (24.10+) | `truenas/ix-dev/community/<app>/` | the apps catalog: `app.yaml`, `item.yaml`, `ix_values.yaml`, `questions.yaml`, `README.md`, a Jinja2 `templates/docker-compose.yaml` over TrueNAS's library, `templates/test_values/basic-values.yaml` |
| CasaOS / ZimaOS | `casaos/Apps/<Name>/docker-compose.yml` | compose with a top-level `x-casaos` block |
| Umbrel | `umbrel/<app>/` | `umbrel-app.yml`, `docker-compose.yml` with `app_proxy`, and the empty `data/<volume>/` folders |
| Portainer | `portainer/templates.json`, `portainer/compose.yml` | app templates, format 3; two type-3 templates (stable and release candidates) pointing at the stack file |

Unraid's template comes with the all-in-one image, in its own repository
(RFC-024 §11.9, phase 5). Nothing here is submitted anywhere: when and where
is the owner's decision (§11.1).

## How a listing is produced

Three inputs, each the only place its facts live:

- **`dist/kinboard.yaml`**, the metadata: the name, taglines and descriptions
  (English and German), the first-run hint, categories per store, icon,
  screenshots (from the wiki for now, §11.8), links, licence, maintainer,
  ports, where each store keeps the data, the variables a household may set,
  and the release the pinned listings point at.
- **`compose.yml`**: the services, their commands, health checks, variables
  and mounts. A listing is compose.yml's services with the database on
  `kinboard-postgres` (stock PostgreSQL 17 with safeupdate, never a store's own
  postgres image, which can't load it, §4.2.1, §4.5), the Docker-socket
  updater left out (each store updates its own way, §4.7), and the variables
  resolved for a new install.
- **`.github/workflows/docker.yml`**: the image names (`IMAGE_NAME`,
  `POSTGRES_IMAGE_NAME`) and channel tags.

```bash
node scripts/stores/build-store-listings.mjs          # write dist/<store>/
node scripts/stores/build-store-listings.mjs --check  # what CI runs: up to date, and our checks
```

The checks (`scripts/stores/lib/checks.mjs`) read each listing back the way
its store would: the app's images are docker.yml's; the database is the stock
image with safeupdate; the pinned stores pin every image by the release's
digest; no secret value anywhere; every mount compose.yml has, from where
that store keeps data; every variable compose.yml sets; every text the
metadata's.

**Pinning a release.** TrueNAS, CasaOS and Umbrel run images pinned
`tag@sha256:<index digest>`. The metadata's `release:` block says which:

```bash
node scripts/stores/pin-release.mjs v1.18.0     # a release: 1.18.0, 17-1.18.0
node scripts/stores/pin-release.mjs --sha 2e83c9f --version 1.18.0-main.2e83c9f   # a build of main
node scripts/stores/build-store-listings.mjs
```

It resolves every image's multi-arch digest from the registry and refuses one
without `linux/amd64` and `linux/arm64`. Until 1.18 (the first release with
`kinboard-postgres` and the role bootstrap) the listings are pinned to a build
of main, so they can be validated and started against images that exist. Pin
the release before any submission. Portainer's templates follow the channel
tags instead (`latest`/`17`, `next`/`17-next`) and are not pinned.

## How a listing is validated

```bash
scripts/stores/validate-upstream.sh             # all four, or name some
KINBOARD_RIG=1 scripts/rigs/test-store-listings.sh   # start them (below)
```

`validate-upstream.sh` runs each store's own tooling at the commit pinned in
`scripts/stores/upstream.json`:

- **Umbrel**: `.tools/lint-apps.mjs --check-images` from getumbrel/umbrel-apps,
  with the app among the store's own (port conflicts), and every image checked
  in the registry for a tag, a digest, amd64 and arm64. Three warnings are
  deliberate: `init` and `db-init` keep `restart: "no"` (one-shots that
  refuse on purpose must not loop), and go2rtc's WebRTC port 8555/udp is also
  Frigate's.
- **CasaOS**: `validate_compose.py` from IceWhaleTech/CasaOS-AppStore, then
  `build_appstore.py` from build-appstore-action on a store holding only this
  app, which resolves each image per declared architecture and fetches the
  icon and screenshots.
- **TrueNAS**: `generate_metadata.py --no-bump` from truenas/apps renders the app
  with TrueNAS's library in its `apps_validation` image and rewrites the
  metadata it owns (capabilities, users, item.yaml, the README's warnings);
  any difference to what is committed fails. Then `ci.py --render-only`
  (rendered, then `docker compose config`).
- **Portainer**: `templates.json` against portainer/templates' `schema.json`
  (branch v3), and `docker compose config` on the stack file.

`scripts/rigs/test-store-listings.sh` starts the compose each store would run
as a throwaway project and checks health, the role bootstrap and safeupdate,
a family created and joined, the `rls-matrix` spec, and the secrets across a
restart. CasaOS, Umbrel (with umbrelOS's own changes: container names, a
shared network with a decoy answering to `db` and `rest`) and Portainer run
their files as listed; TrueNAS runs what its renderer renders. None of that is
the store system itself.

## Rehearsal on each store's own system (RFC-024 §10)

Before any listing is submitted, on that system (a VM where possible), from
the generated listing. Write down every place the store's UI needed
explanation: that goes into the metadata's texts or the wiki.

**Every store**

1. Install as a household would, through the store's own "custom
   catalog / third-party store / template URL" path.
2. Health, a family created, a second device joined, push notifications, the
   scheduled jobs running, the secrets kept across a restart (RFC-023 §8.1).
3. `e2e/rls-matrix.spec.ts` against the installed instance (mandatory: every
   listing runs stock PostgreSQL). A single readable row of another family
   stops the listing.
4. Update to a newer tag through the store's own update button: the version
   changes, the data fingerprint doesn't. Twice in a row: the first takes a
   verified backup and runs the migrations once, the second does nothing.
5. A broken build (an entrypoint that exits; a migration that fails halfway):
   the store shows the app unhealthy, and going back to the previous version
   brings the app back on the newer schema, with the notice in Settings.
6. A pinned version doesn't move. No network during an update: nothing
   half-applied.
7. Uninstall and reinstall with the data kept: the family is still there.

**TrueNAS** (a custom catalog holding `dist/truenas`)

- The three ix-volume datasets are created; with host paths instead, the app
  starts on folders owned by another user.
- The app's capabilities and "runs as root" notes, as the install screen
  shows them, match `app.yaml`.
- TrueNAS's `postgres-upgrade` image against `kinboard-postgres` before
  any PostgreSQL major change (RFC-024 §5.2).
- Open an issue on truenas/apps before the pull request (their process).

**CasaOS / ZimaOS** (a third-party store holding `dist/casaos`)

- Every variable is editable in the app's settings; the data lands in
  `/DATA/AppData/kinboard/`.
- The `before_install` tip shows, in English and German.

**Umbrel** (a community app store holding `dist/umbrel`, §11.10)

- The app opens through `app_proxy` behind Umbrel's login, and `/api/*`
  (the Home Assistant integration, calendar feeds) works without it.
- A wall display stays signed in to Umbrel after a reboot.
- `submission:` in `umbrel-app.yml` becomes the pull request's address.

**Portainer** (Settings → App Templates → this repository's raw
`dist/portainer/templates.json`)

- The stable template deploys from the template form, with the variables'
  defaults; "Pull and redeploy" updates it.
- The release-candidate template deploys `next` and `17-next`.
