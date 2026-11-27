# All-in-one image

> **Release candidates only, for now.** The all-in-one image is published as
> `ghcr.io/svenger87/kinboard-aio:next` (and `:main`, `:sha-…`, and each
> version's own tag). It gets `latest` after two release cycles on `next`,
> measurements on a Raspberry Pi and a rehearsed PostgreSQL upgrade on a copy
> of real data. Until then, a household's everyday screen is better served by
> [the compose file](Compose-UIs).

Kinboard in **one container** with **one folder** for its data: the app, its
PostgreSQL 17 database, PostgREST and the scheduled jobs, started in order and
stopped safely by one supervisor. It is the same build as the compose file's
image, with the database inside. Nothing must be set to start it: the
passwords and keys create themselves on the first start.

It is meant for systems that install one container per app (Unraid's Docker
page, Portainer's container templates, a plain `docker run`). Where your
system takes a compose file (TrueNAS, CasaOS/ZimaOS, Umbrel, Portainer stacks,
Synology), use [the compose file](Compose-UIs) instead.

## Start it

```bash
docker run -d --name kinboard \
  --restart unless-stopped --stop-timeout 60 \
  -p 3001:3000 \
  -v /srv/kinboard:/data \
  -e TZ=Europe/Berlin \
  ghcr.io/svenger87/kinboard-aio:next
```

Then open `http://<this machine>:3001` and create your family; every other
device joins with the family's code.

- **`--stop-timeout 60`**: the database gets up to 30 seconds to shut down
  cleanly inside the container. Docker's default of 10 seconds would cut it
  off; that is safe (PostgreSQL recovers), but slow on the next start.
- **`/data`**: one folder on a real disk. Not a USB stick (FAT), not a Windows
  share or drive, not a RAM disk: the container refuses those and says why.
- **`PUID` and `PGID`** (default `1000`): the user and group that run
  everything inside, PostgreSQL included, and own every file in `/data`. Set
  them to the owner of your folder (`id -u`, `id -g`); on Unraid 99 and 100.
  `0` is refused: PostgreSQL does not run as root.

Optional settings: `TZ`, `SITE_URL` (the address other apps get in links, such
as the calendar feed), `INSTANCE_ADMIN_FAMILY_ID` (the family that sees update
notices when there is more than one), `GO2RTC_URL` (below).

Health: `docker ps` shows the container healthy once `/api/health` answers,
which checks the database too. A first start (creating the database and every
table) takes about half a minute on a PC, longer on a Raspberry Pi.

### Unraid

The template is generated with the image and lives in its own repository,
`svenger87/kinboard-unraid` (copied from this repository's `dist/unraid/`).
Until it is in Community Applications, add it by hand: put
`templates/kinboard.xml` from that repository into
`/boot/config/plugins/dockerMan/templates-user/` on the flash drive, then
Docker → Add Container → pick *Kinboard*. Its defaults are Unraid's: the data
folder `/mnt/user/appdata/kinboard`, PUID 99 and PGID 100, and the stop timeout
above. (Installing from the template is still to be rehearsed on a real Unraid
7 box.)

### Cameras

go2rtc is not inside. Snapshot and MJPEG cameras work without it. For RTSP
cameras, run go2rtc as its own container and set `GO2RTC_URL` to its address
(for example `http://192.168.1.10:1984`).

## What is in /data

| Folder | What |
|---|---|
| `db/` | the PostgreSQL 17 database (mode 0700) |
| `storage/files/` | uploaded files: family photos, recipe pictures, vehicle images |
| `config/secrets/` | the database password, the key that signs logins, the push keys (0600) |
| `config/updater/` | the start records: the last version that ran healthy, a failed start, a database upgrade |
| `backups/` | the checked dumps taken before migrations and database upgrades (five of each kept) |

**Back it up whole.** Stop the container, copy the folder, start it again.
Whoever can read the folder can read everything, the secrets included: keep
the backups private.

## Updates

An update is a new container from a newer image, pulled by whatever runs it
(Unraid's *Apply Update*, Portainer's *Recreate*, `docker pull` and
`docker run` again, or [kinboard-updater](Compose-UIs#automatic-updates) in
container mode). The image never replaces itself. At every start it:

1. takes a **checked database dump** into `/data/backups/` before any database
   change that will run. No checked dump, no change and no start; the log says
   why;
2. applies the database changes once;
3. after its first healthy minute, records its version in
   `config/updater/last-good`.

If a new version's database change fails, the container stops, and the log
names the last version that ran healthy on this data: set the image tag back
to it. Database changes only ever add, so the older version runs on the newer
database, and Settings then shows that the update was rolled back.

### PostgreSQL major upgrades

The image pins PostgreSQL 17. When a later release moves to a newer major,
that image also carries 17's programs, and on its first start it:

1. takes a **checked dump** of the whole database first; without one it does
   nothing;
2. builds the upgraded database in `/data/db.new` with `pg_upgrade` (copy
   mode: `/data/db` is not touched), and checks free space for that copy
   first;
3. starts it, checks it holds the same tables, families, recorded changes and
   database roles, and that it can load the safeguard against unfiltered
   writes, rebuilds its indexes, and only then swaps the folders by renaming:
   the old database becomes `/data/db.old`.

Any failure leaves `/data/db` as it was, and the container stops with the
reason: run the previous image tag again and it starts as before. If the new
version does not run healthy for a minute and you go back to the previous tag
within a day, that one puts the old database back by itself (the new one is
kept aside as `db.failed-pg…`, with anything written to it). Later than a day
it doesn't, because the new version may have been in use all that time: set
`KINBOARD_PG_ROLLBACK=1` on the previous tag to put the old database back
anyway. After the first healthy minute the upgrade is final: the log
says `/data/db.old` can be deleted, and going back is refused, because data has
been written to the new one since; the checked dump from before the upgrade
stays in `/data/backups/`.

`KINBOARD_PG_UPGRADE=off` stops the image from upgrading on its own; it then
refuses to start on the older database instead.

## Moving between the compose file and the all-in-one image

Only by export and import, never by pointing one at the other's folders: the
compose file's database is PostgreSQL 15 built for another C library, and a
database folder from one is not safe under the other. Both images have the same
two commands.

**Use the same Kinboard version on both sides**; the import refuses an archive
from another version. `kinboard export` exists from 1.18 on (and in the `next`
and `main` images before that): on 1.17 and older, `docker exec … kinboard`
answers *executable file not found*. So first put the old install on the tag
the all-in-one image runs, `next` here:

- **git install** (`webapp/docker/docker-compose.yml`): in
  `webapp/docker/.env`, set `KINBOARD_TAG=next`, then

  ```bash
  git pull
  cd webapp/docker && ./start.sh up
  ```

  `git pull` and `./start.sh up` alone keep the tag `.env` names (`latest`
  when it names none), so without the line above the webapp stays on the
  version it had.
- **one-file install** (`compose.yml`): set the variable `KINBOARD_TAG` to
  `next` in your Compose UI (or `.env` beside the file), then Pull and Up.

The webapp container is `kinboard-webapp` (a git install with another
`PROJECT_NAME` in `.env` calls it `<PROJECT_NAME>-webapp`; `docker ps` lists it).

From a compose install to the all-in-one image:

```bash
# on the compose install: one archive with the database, the files and the keys
# (umask 077: the archive holds the keys that sign every login; only you may read it)
(umask 077; docker exec kinboard-webapp kinboard export - > kinboard-export.tar.gz)
# start the all-in-one image on an empty folder, wait until it is healthy, then
docker exec -i kinboard kinboard import - < kinboard-export.tar.gz
```

The import goes into a fresh install only, before the first family is
created. It checks every table's row count and checksum before it keeps
anything, and on any difference keeps nothing. It brings the uploaded files
and the keys that must travel (the login key, so screens stay signed in; the
push keys, so notifications keep working), then restarts the app inside the
container. Screens that were signed in stay signed in when they reach the new
install under the same host name or IP address as before (the port may
differ: a sign-in does not depend on it). A screen sent to another machine's
address starts at the join screen: join it again with the family's code,
which is the same as before.

**Cameras** that stream through go2rtc (RTSP) need it after the move too:
the all-in-one image has no go2rtc inside, so the camera page reports a
WebRTC error until `GO2RTC_URL` points at a go2rtc container of its own (see
[Cameras](#cameras) above). Snapshot and MJPEG cameras work as they did.

The export changes nothing on the old install: it keeps running, and is your
way back until the new one works. Then **stop it** (`docker compose stop` in
its folder, or Stop in your Compose UI): two installs with the same data both
send every reminder and notification, and both sync the calendars.

Back, from the all-in-one image to a fresh compose install:

```bash
(umask 077; docker exec kinboard kinboard export - > kinboard-export.tar.gz)
# compose.yml's webapp has the config volume read-only, so the import runs in
# a one-off container with the stack's network and volumes:
NET=$(docker inspect -f '{{range $net, $_ := .NetworkSettings.Networks}}{{$net}}{{end}}' kinboard-db)
docker run --rm -i --network "$NET" \
  -e POSTGRES_HOST=db -e FILES_DIR=/var/lib/storage/files \
  -v kinboard-config:/kinboard -v kinboard-storage:/var/lib/storage \
  ghcr.io/svenger87/kinboard:next kinboard import - < kinboard-export.tar.gz
docker compose restart rest webapp
```

(`NET` is the stack's network, `<the compose project>_kinboard`; the line
above reads it off the database container. Use the image tag the all-in-one
image had. With `KINBOARD_CONFIG_DIR` and `KINBOARD_STORAGE_DIR` set to
folders, mount those instead of the two volumes. Run the last line in the
folder with `compose.yml`.)

The archive holds every family's data and the keys that sign their logins:
keep it private, and delete it once it is imported. The database password is
not in it; each install keeps its own.

**Room it needs.** The import unpacks the archive in the container's own
temporary folder (on Docker's disk), then needs room in `/data` for the
uploaded files and about three times the database's data. It checks both
first and refuses, changing nothing, with how much it needs and how much is
free.

**If an import is cut off** (the container stopped or killed, the power
gone) before it finished, nothing of it is kept: the all-in-one image takes
out the files and keys it had put in place at its next start, before the app
runs, and says so in its log. Run the import again. On a compose install,
the next `kinboard import` does the same.

## When it refuses to start

| The log says | What to do |
|---|---|
| *holds a PostgreSQL … cluster that this image did not create* | the folder is from another image (a compose install's database). Move with export and import instead |
| *is PostgreSQL 18, newer than this image's 17* | you went back to an older tag after a database upgrade that has been in use since. Run the newer tag again; the dump from before the upgrade is named in the log |
| *REFUSING to migrate without a verified backup* | free space in `/data/backups`, then start again |
| *PUID and PGID must not be 0* | set them to the folder owner's ids |
| *not writable* | mount `/data` read-write |

## Third-party licences

The image's licence label names Kinboard's own licence and those of the
software it is built around: PostgreSQL, PostgREST (MIT), pg-safeupdate and
s6-overlay (ISC).

On **arm64** the image also carries the runtime libraries PostgREST's arm64
build is linked against, taken unchanged from the official PostgREST image:
glibc, libpq, OpenSSL, Kerberos, OpenLDAP, Cyrus SASL, GMP, zlib, zstd,
keyutils and com_err. They are under the LGPL (some parts also offered under
the GPL), the Apache License 2.0, the PostgreSQL licence, and BSD-, MIT- and
zlib-style licences. Each package's copyright file is in
`/usr/share/licenses/postgrest-runtime/`, named after the Debian package, and
the image's SBOM lists them with their versions:

```bash
docker run --rm --entrypoint ls ghcr.io/svenger87/kinboard-aio:next /usr/share/licenses/postgrest-runtime
docker buildx imagetools inspect ghcr.io/svenger87/kinboard-aio:next --format '{{ json (index .SBOM "linux/arm64") }}'
```

The amd64 image needs none of them: PostgREST is a single static binary there.

## Resources

Measured on the development machine (amd64); the Raspberry Pi measurements
are still to come.

| | |
|---|---|
| Image | about 560 MB on disk, 129 MB to download (amd64); the webapp image alone is 481 MB and 108 MB |
| Memory, idle | about 140 MiB for the whole container with one family (`docker stats`, 90 s after the last request) |
| Data | the database is about 25 MB for one family; uploads are what grows |
