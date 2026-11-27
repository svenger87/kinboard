# App-store listings

Everything under `dist/<store>/` is **generated**. Don't edit it by hand: CI
fails when it differs from what the generator writes. Design: RFC-024 §5, §7
and §10 (`docs/rfc/024-all-in-one-and-stores.md`).

| Store | Generated here | Format |
|---|---|---|
| TrueNAS (24.10+) | `truenas/ix-dev/community/<app>/` | the apps catalog: `app.yaml`, `item.yaml`, `ix_values.yaml`, `questions.yaml`, `README.md`, a Jinja2 `templates/docker-compose.yaml` over TrueNAS's library, `templates/test_values/basic-values.yaml` |
| CasaOS / ZimaOS | `casaos/Apps/<Name>/docker-compose.yml` | compose with a top-level `x-casaos` block |
| Umbrel | `umbrel/<app>/` | `umbrel-app.yml`, `docker-compose.yml` with `app_proxy`, and the empty `data/<volume>/` folders |
| Portainer | `portainer/templates.json`, `portainer/compose.yml` | app templates, format 3; two type-3 templates (stable and release candidates) pointing at the stack file, with an *Automatic updates* switch, and a type-1 template for the all-in-one image |
| Unraid (Community Applications) | `unraid/` | the whole content of the template repository: `ca_profile.xml`, `templates/<app>.xml` (`<Container version="2">`), `templates/<app>-updater.xml` (the optional updater beside it), `README.md`; for the all-in-one image |

Nothing here is submitted anywhere: when and where is the owner's decision
(§11.1).

**Unraid's template repository** (RFC-024 §5.1, §11.9). CA wants a repository
with `ca_profile.xml` at its root and the templates under `templates/`, so the
template lives in its own repository holding only `dist/unraid/` (the
metadata's `aio.unraid.repository`, `svenger87/kinboard-unraid`). The
maintainer creates it once, public, with two-factor authentication on the
account (CA's policy), and from then on copies `dist/unraid/` into it after
each regeneration; nothing pushes there automatically. The template's
`TemplateURL` points at that repository's raw file, so it answers only once
the repository exists. The image's tag follows docker.yml's `AIO_IMAGE_TAGS`:
`next` with `<Beta>true</Beta>` while there is no stable channel, `latest`
with `next` as a `<Branch>` once there is. CA itself is blocked by its
licence rule (an OSI-approved licence, §5.1, §11.2); installing by template
works without it.

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
  updater left out where the store updates its own way and kept, switched
  off, on Portainer (§4.7, below), and the variables resolved for a new
  install.
- **`.github/workflows/docker.yml`**: the image names (`IMAGE_NAME`,
  `POSTGRES_IMAGE_NAME`, `AIO_IMAGE_NAME`) and channel tags.

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

## How each listing updates

Automatic updates reach every install shape (RFC-024 §4.7), but not by the
same road. compose.yml's `updater` service (`kinboard-updater`, RFC-023
§4.11.3) needs the Docker socket, so it is in a listing only where nothing
else updates the app. The metadata's `omit_services.updater` says why for
each store that leaves it out; `opt_in.autoupdate` holds the Portainer
switch's texts. A service with a profile has to be settled for every store,
one way or the other, or the generator refuses.

| Store | Who updates | The updater |
|---|---|---|
| TrueNAS | the catalog: a new app version, offered in TrueNAS's UI | left out: TrueNAS replaces the app itself, and an updater recreating containers behind its back would fight it |
| CasaOS / ZimaOS | the store, when the listing's `version` changes | left out, for the same reason |
| Umbrel | the store, when the manifest's `version` changes | left out: Umbrel updates the app itself, and its rules forbid the Docker socket |
| Unraid | Unraid's Docker page shows "update ready", and *Apply Update* recreates the container from the template; nothing happens on its own without a plugin | **a second template, `kinboard-updater`, installed by choice.** It gets the Docker socket and a folder of its own (`/mnt/user/appdata/kinboard-updater`), names the container it looks after (`KINBOARD_AIO_CONTAINER`, the all-in-one template's Name) and runs `kinboard-updater`. It recreates that one container with its own settings and the new image, after the image's own verified dump, and puts the original back if the new one isn't healthy (RFC-024 §4.7; the wiki's All-in-one page). After an update it records the new digest in Unraid's update status, as *Apply Update* does, so the Docker page doesn't go on showing "update ready". The Auto Update Applications plugin should leave Kinboard out: it takes no backup and has no way back |
| Portainer | nothing of Portainer's own for a template's stack, beyond a redeploy by hand | **kept, off by default.** The template's *Automatic updates* field sets `COMPOSE_PROFILES` to `autoupdate`; only then does Compose start `kinboard-updater`, the one container with the socket. Portainer keeps the template's file in its own volume, out of the updater's reach, so it works in container mode: it recreates only `kinboard-init`, `kinboard-db-init` and `kinboard-webapp`, with their own settings and the new image, after a verified backup, and rolls back if the new one isn't healthy. The stack page keeps listing every container. Switching it off again and redeploying leaves the running updater in place (Compose doesn't remove a service whose profile is no longer active); the field's description says to remove `kinboard-updater` by hand, as the wiki says for `compose.yml` |

In all three pinned listings the image itself still takes a verified backup
before a migration and runs the migrations once (§4.7, "what the image
itself guarantees"). The checks hold the table: the updater and the socket
in no compose listing but Portainer's, there under the profile, the switch
off in both templates, and the socket in no other Portainer service. On
Unraid the socket is in the updater's template only: its paths are exactly
the socket and its own folder, with no port and no privileges, and the
all-in-one template must not mention the socket at all.

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
- **Unraid**: CA publishes no validator to run locally (its Validate and Scan
  run on ca.unraid.net at submission). `build-store-listings.mjs --check`
  reads the template back against CA's documented format instead: the field
  reference (https://ca.unraid.net/submit/help/xml-field-reference) and the
  starter template (unraid/unraid-community-apps-starter, `templates/example-app.xml`
  and `ca_profile.xml` at commit `01398ff8bd728ce92dd9595e33d8577299e0e971`),
  with every `Config` attribute in its allowed values. The updater's template
  gets the same reading, plus its own rules (lib/checks.mjs,
  `unraidUpdaterProblems`).
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

**Unraid** (the all-in-one image; the template from `dist/unraid/`, by hand
until CA can list it)

- The template installs from `/boot/config/plugins/dockerMan/templates-user/`
  and from the template repository added on the Docker page; the form shows
  the port, the data path (`/mnt/user/appdata/kinboard-aio`), PUID 99 and PGID
  100, the advanced variables, and `--stop-timeout=60` survives in Extra
  Parameters.
- *Use Tailscale* (Unraid 7) shows the template's presets (hostname
  `kinboard`, Serve on port 3000, state in `/data/tailscale`); switched on,
  the container log gives the sign-in link, Kinboard starts after it, and
  `https://kinboard.<tailnet>.ts.net` opens the app (wiki: HTTPS).
- *Apply Update* recreates the container from the template; the start
  guarantees hold (a verified dump before a pending migration).
- The rls-matrix spec against the installed instance.
- The updater's template installs beside it: its log names the Kinboard
  container, the first check records a baseline, and an update of `next`
  replaces the container (the Docker page keeps its icon, WebUI link and
  autostart), with `pre-update-….sql.gz` in the data folder's `backups`.
  Afterwards the Docker page shows Kinboard up to date (Unraid's
  `/var/lib/docker/unraid-update-status.json` holds the new digest) and
  *Apply Update* is not offered.
- In the updater: `docker exec kinboard-updater kinboard-updater --help`
  prints the usage and exits 0, `--check-now` runs one check and exits, and
  `docker top kinboard-updater` still shows a single loop afterwards.
- **A scripted rehearsal** that builds the `docker run` line with
  dockerMan's `xmlToCommand()` alone misses one thing *Apply* does: for a
  container with *Use Tailscale* on, `CreateDocker.php` adds
  `-e ORG_ENTRYPOINT=…`, the image's own entrypoint, which Unraid's Tailscale
  hook runs once Tailscale is up. Without it the hook has nothing to hand
  over to, so add `-e ORG_ENTRYPOINT="/init"` (the all-in-one image's
  entrypoint) to the generated command yourself.

**Portainer** (Settings → App Templates → this repository's raw
`dist/portainer/templates.json`)

- The stable template deploys from the template form, with the variables'
  defaults; "Pull and redeploy" updates it. No `kinboard-updater` and no
  socket mount while *Automatic updates* is off.
- With *Automatic updates* on: `kinboard-updater` runs, its log says
  "container mode", a newer image under the tag is applied with a backup,
  and the stack page still lists every container.
- The release-candidate template deploys `next` and `17-next`.
- The all-in-one template (type 1) deploys `kinboard-aio` with a `/data`
  volume; set the stop timeout to 60 s by hand where Portainer offers it.
