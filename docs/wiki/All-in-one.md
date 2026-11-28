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
notices when there is more than one), `GO2RTC_URL` (below), and the
automatic backups' `KINBOARD_BACKUP_*` and a `/backups` folder ([Backups](#backups)).

The container speaks plain HTTP. Push notifications, the barcode scanner's
live camera and installing the app need an `https://` address in front of it:
[HTTPS](HTTPS) has the ways, shortest first.

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
folder `/mnt/user/appdata/kinboard-aio`, PUID 99 and PGID 100, and the stop
timeout above. (Installing from the template is still to be rehearsed on a real
Unraid 7 box.) The data folder is not `/mnt/user/appdata/kinboard`, where
[Self-hosting](Self-hosting) puts a git install: the image refuses a folder
holding another install's database, so a household with both keeps them apart.
For automatic updates, add the second template, `kinboard-updater`
([below](#automatic-updates)).

**HTTPS**: the template carries Unraid 7's **Use Tailscale** settings, preset
for Tailscale Serve and switched off. Switch it on for an
`https://kinboard.<your-tailnet>.ts.net` address: [HTTPS](HTTPS#unraid-7-use-tailscale).

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
| `backups/scheduled/` | the [automatic backups](#backups), when they are on and no other folder is mapped |

**Back it up whole.** Stop the container, copy the folder, start it again.
Whoever can read the folder can read everything, the secrets included: keep
the backups private. Or let Kinboard do it while it runs: [Backups](#backups).

## Backups

Kinboard can back itself up on a schedule. **Off until you switch it on.**
Each backup is one file holding everything a new install needs to carry on
where this one stopped: every table of every family, the uploaded photos, and
the keys that must travel (the key that signs logins, so screens stay signed
in; the push keys, so notifications keep working; the calendar-feed and
presence tokens other systems hold). It is the same archive
[`kinboard export`](#moving-between-the-compose-file-and-the-all-in-one-image)
writes, so a restore is `kinboard import`, which checks every table before it
keeps anything. The database password is not in it: a new install keeps its
own.

### Switch it on

- **In Settings → Data & safety → Automatic backups**, as the install's own
  family (the one that also sees update notices): daily or weekly, the time,
  the day for weekly, and how many to keep (7 unless you change it). Saving
  asks for the settings PIN; a family without one sets one first.
- **Or in the container's settings**, which then win and show in Settings as
  set by the server: `KINBOARD_BACKUP_SCHEDULE` (`off`, `daily` or
  `weekly`), `KINBOARD_BACKUP_TIME` (`HH:MM`, default `03:00`),
  `KINBOARD_BACKUP_DAY` (`mon` … `sun`, default `sun`) and
  `KINBOARD_BACKUP_KEEP` (default `7`). Empty means not set. A value
  Kinboard doesn't understand switches the backups off, and Settings says
  which one.

The time is the clock of `TZ` (Europe/Berlin unless you set it). Pick an hour
your server is on and idle; a backup reads the whole database and every
photo. If the container was stopped at that time, the backup runs within a
few minutes of the next start instead.

### Where they go, and why another disk

By default into `/data/backups/scheduled/`. That protects against a mistake
(a deleted family, an update you want to undo by moving to a fresh install)
but not against the disk itself: when the disk under `/data` fails, the
backups go with it. So give them a folder on **another disk**:

- **Unraid**: the template's *Backups (optional)* field, for example
  `/mnt/user/backups/kinboard` on a share that doesn't live on the same disk
  as `appdata` (or on another machine, mounted with Unassigned Devices). It is
  mounted at `/backups` in the container, and Kinboard uses it as soon as it
  is there.
- **`docker run`**: add `-v /mnt/other-disk/kinboard-backups:/backups`.
- Any other path inside the container: set `KINBOARD_BACKUP_PATH`.

The folder must be writable by `PUID`:`PGID` (on Unraid, 99:100, which a new
share already is). **Keep it private**: on Unraid 99 is the shared `nobody`
user, so the file modes don't keep out other containers running as it or a
share exported to guests: set the share's SMB export to *No* or *Private*.
**One folder per install**: two installs given the same folder remove each
other's backups. An empty folder that belongs to root (what Docker creates
for a path that didn't exist) is handed to `PUID`:`PGID` at the start;
anything else is left as you set it. Settings says where the backups go, and
warns when that is inside `/data` or on the same disk.

Each backup is written under a temporary dot-name, read back in full (every
table's rows, every photo's checksum, every key) and only then given its
name, `kinboard-backup-<date and time>-<version>-sha-<build>.tar.gz`,
readable by `PUID` only (mode 0600; a folder Kinboard creates is 0700). A
backup of an install with no family yet is refused, so a fresh install
sharing the folder never rotates a household's backups out. Only after that
are the oldest beyond the number to keep removed. A backup that fails (a full
disk, a folder it can't write to) removes only its own temporary file: the
last good backup always stays. A backup cut off by a restart or an update
leaves only that dot-file, which never counts and the next run removes.

### When one fails

Kinboard tries again an hour later, up to three times, then at the next
scheduled time. Settings shows the last good backup (when, how big), the next
run and the last error, and while the last backup failed, a notice at the top
of Settings says so to the install's own family. The container log has every
step: `docker logs kinboard 2>&1 | grep -E '\[(scheduled-)?backup\]'`.

**Back up now** in Settings starts one at once, and **Download** fetches the
newest through the browser (both ask for the settings PIN; the download link
works once, for two minutes). The file holds every family's data and keys:
keep it somewhere only you can read.

Backups and updates don't overlap: an update by
[kinboard-updater](#automatic-updates) waits for a running backup to finish
before it takes its own dump and replaces the container, and a scheduled
backup doesn't start while an update's dump runs.

### Restore a backup

A backup goes into a **fresh** install of **the same build**, before its
first family is created. The end of the file name says which: in
`kinboard-backup-20261128T030000Z-1.18.0-sha-abc1234.tar.gz` that is version
1.18.0, image tag `sha-abc1234` (every published all-in-one image has its
`sha-` tag; a release also has its version tag, `1.18.0`). If the install it
came from still runs, stop it first.

1. Move the old data folder aside (don't delete it until the restore works),
   or pick a new, empty one.
2. Start Kinboard on the empty folder **with the backup's build as the
   image tag**: `ghcr.io/svenger87/kinboard-aio:sha-abc1234` for the file
   above, and **on another port than the screens use** (and without its
   reverse-proxy settings). On Unraid, set *Repository* in the template to
   that tag and *Web UI* to another port, and *Apply*. Wait until it is
   healthy; don't open it in a browser to create a family. (A screen that
   reaches it while it is still empty forgets its sign-in, as
   [the move](#moving-between-the-compose-file-and-the-all-in-one-image)
   explains.)
3. Import the backup:

   ```bash
   docker exec -i kinboard kinboard import - < /mnt/other-disk/kinboard-backups/kinboard-backup-20261128T030000Z-1.18.0-sha-abc1234.tar.gz
   ```

   (On Unraid the container is called `Kinboard`; run it in Unraid's terminal
   with the backup's path on the server.) It checks every table's row count
   and checksum before it keeps anything, restores the photos and the keys,
   and restarts the app inside the container.
4. Give it the screens' port (and the proxy settings) back (on Unraid: edit
   the template, *Apply*). The families, the photos and the settings are
   back, and screens that were signed in stay signed in when they reach it
   under the same address. The automatic backups' schedule comes back with them; check
   that the backups folder is mapped again.
5. To get updates again, set the tag back to `next`.

A backup from an older build than the image you want: restore it on its own
build first, as above, then update. If the import says the archive is from
another version, the tag doesn't match the file name.

**Compose installs** (`compose.yml`, TrueNAS, CasaOS, Umbrel, Portainer
stacks) don't have this switch: their app container gets the config folder
read-only and has no folder of its own off the database's disk, and the
stores back up their app folders their own way. Back up the three folders, or
run `kinboard export` from a scheduled task on the host. A git install keeps
its own scripts ([Self-hosting](Self-hosting)).

## Updates

An update is a new container from a newer image, pulled by whatever runs it
(Unraid's *Apply Update*, Portainer's *Recreate*, `docker pull` and
`docker run` again, or [kinboard-updater](#automatic-updates) beside it). The
image never replaces itself. At every start it:

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
anyway. After the first healthy minute the upgrade is final: going back is
refused, because data has been written to the new one since; the checked dump
from before the upgrade stays in `/data/backups/`.

**The old database folder.** `/data/db.old` is a whole second copy of the
database, so it doubles the space the database takes until it is deleted.
Settings says so, under the version, to the install's own family (the one that
also sees the automatic updates' status):

- while the previous version could still go back to it (the first minute, or
  up to a day while the new version has not yet run healthy for a minute), it
  says the old database is kept, until when, and which version it is for;
  there is no Delete button then;
- after that, it says it can be deleted, with its size, both PostgreSQL
  versions and the date of the upgrade, and a **Delete** button. Deleting asks
  for the settings PIN (a family without one sets one first), removes
  `/data/db.old`, writes a line to the log and the notice goes away.

Delete refuses while an upgrade is running, and refuses anything at
`/data/db.old` that isn't the folder the upgrade left there (a link, another
database), without touching it. Deleting the folder by hand when the
container is stopped works too. Once it is gone, going back to the previous
version, even with `KINBOARD_PG_ROLLBACK=1`, is refused with a message saying
the old database was deleted, and nothing is changed; run the newer image
again.

`KINBOARD_PG_UPGRADE=off` stops the image from upgrading on its own; it then
refuses to start on the older database instead.

## Automatic updates

Off unless you turn it on: a second, small container, `kinboard-updater`,
started next to Kinboard. It is the same updater the compose file uses.

**What it does.** Two minutes after it starts, and then every 30 minutes, it
asks the registry whether the tag Kinboard runs (`next`, for now) has a newer
image. When it has:

1. it pulls the new image;
2. it takes Kinboard's own checked database dump, the one the image takes
   before any database change, into `/data/backups/` as
   `pre-update-<time>.sql.gz` (the last five are kept). No checked dump, no
   update;
3. it replaces the Kinboard container with one that has exactly the same
   settings (port, data folder, variables, network, labels, restart and stop
   settings) and only the new image. Nothing else on the machine is touched;
4. it waits up to 10 minutes for the new one to come up healthy and to pass a
   check of its database tables. If it doesn't, the container that ran before
   is put back, on the same data, and that release is skipped until a newer
   one is published. Settings then says *"The update to … didn't start, so
   Kinboard went back to …"*;
5. Settings shows *"Updated automatically to … on …"* under the version.

The uploaded files and the keys are not copied anywhere: an update doesn't
change them, and they stay in `/data`. Back up the whole folder as above.

**The first check only looks.** It notes what runs and changes nothing; the
one after it is the first that can update. **A version tag never moves**:
with `kinboard-aio:1.18.0` the updater never even asks the registry.

**A PostgreSQL major upgrade** (above) happens inside the new container at its
first start. The updater then waits up to an hour instead of 10 minutes
(`KINBOARD_PG_UPGRADE_TIMEOUT`, in seconds). If the new version fails before
it has run healthy for a minute, the previous container goes back and puts the
previous database back itself. If it fails later than that, the upgrade is
final and the previous version would refuse the database, so the updater keeps
the new version running instead of stopping Kinboard, and Settings says that
going back didn't work: the log has every step, and the dump from before the
upgrade is in `/data/backups/`.

**If the updater is stopped in the middle** of an update (a reboot, a
`docker stop`), it puts the previous container back at its next start, from
the record it keeps in its own folder.

### Turn it on

Whichever way, the updater gets Docker's socket, which it needs to pull and
replace containers. Whoever holds the socket controls the machine: the
updater is the only container that gets it, never Kinboard itself. It opens
no port and takes no requests. It needs a folder or volume of its own at
`/kinboard` for its log and its record of an update in progress; without one
it refuses to update.

**Unraid.** A second template, `kinboard-updater`, next to Kinboard's in the
same repository (`templates/kinboard-updater.xml`). Install it after Kinboard;
leave *Kinboard container* at the name you gave Kinboard (`Kinboard`). Its
folder is `/mnt/user/appdata/kinboard-updater`.

**Plain Docker.** With Kinboard started as above (`--name kinboard`):

```bash
docker run -d --name kinboard-updater --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v kinboard-updater:/kinboard \
  -e KINBOARD_UPDATER=1 -e KINBOARD_AIO_CONTAINER=kinboard \
  --entrypoint kinboard-updater \
  ghcr.io/svenger87/kinboard-updater:next
```

**Compose** (Portainer, Dockge, a terminal): next to the Kinboard service in
the same file.

```yaml
services:
  kinboard:
    image: ghcr.io/svenger87/kinboard-aio:next
    container_name: kinboard
    restart: unless-stopped
    stop_grace_period: 60s
    ports: ["3001:3000"]
    volumes: ["/srv/kinboard:/data"]
  kinboard-updater:
    image: ghcr.io/svenger87/kinboard-updater:next
    container_name: kinboard-updater
    restart: unless-stopped
    entrypoint: ["kinboard-updater"]
    environment:
      KINBOARD_UPDATER: "1"
      KINBOARD_AIO_CONTAINER: kinboard
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - kinboard-updater:/kinboard
volumes:
  kinboard-updater:
```

A later Up of that file finds Kinboard already on the image its tag names, and
leaves it alone.

`KINBOARD_AIO_CONTAINER` names the container to update. Without it the updater
looks for the one container on the machine that runs the all-in-one image,
and refuses when there are two: one updater for each, each with its name.

**Its log:** `docker logs kinboard-updater`, and `updater/update.log` in its
folder. **To check now** instead of waiting for the next half hour:

```bash
docker exec kinboard-updater kinboard-updater --check-now
```

That runs one check, the same one the loop runs and behind the same lock (if a
check is already running it says so and leaves it to finish), prints its log
and exits. `kinboard-updater --help` lists the options. Only the container's
own start runs the 30-minute loop: `kinboard-updater` run any other way
without an option, or with one it doesn't know, prints the usage and changes
nothing (before 1.18 every call started a second loop). **To pause it**, set `KINBOARD_UPDATE_TICK=off` on the updater and
recreate it; **to remove it**, remove its container. **Updating the updater
itself:** pull its image and recreate it (Unraid: *Apply Update* on it, or the
Auto Update plugin, which is fine for the updater). It never replaces its own
container.

### Unraid's own updates

Unraid itself never updates a container on its own. Its Docker page shows
*update ready* when the registry has a newer image under the template's tag,
and *Apply Update* recreates the container from the template. With the
updater:

- **After the updater's update**, it records the new image in Unraid's update
  status, the way *Apply Update* does, so the Docker page shows Kinboard up to
  date. Pressing *Apply Update* anyway is harmless: Unraid recreates the
  container on the image it already runs.
- **After a rollback**, the Docker page shows *update ready* for the release
  the updater skipped. Don't apply it by hand: it is the version that didn't
  start. The updater applies the next one by itself.
- **The Auto Update Applications plugin:** leave Kinboard out of it (set
  *Update All* to *No* and don't tick Kinboard). It updates on its own
  schedule with no backup and no way back, and it would apply a release the
  updater skipped. Ticking `kinboard-updater` there is fine.
- **The template's Repository** is what the updater follows: the tag in it
  (`:next`). Change it to a version (`:1.18.0`) and both Unraid and the
  updater stay on that version.

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

**Until the import is done, keep the new install where the screens can't
reach it.** A screen that loads a page from the new install while it is still
empty finds no family, forgets its sign-in and shows the join screen; it signs
itself in again only at its next page load after the import (a reload, not the
family's code), and a kitchen screen nobody reloads sits on the join screen
until someone does. So start the all-in-one image on another port than the old
install's, and behind a reverse proxy without its proxy settings (Traefik:
`traefik.enable=false`); import; stop the old install; then give the new one
the old port and the proxy settings (on Unraid: edit the template, Apply). The
import doesn't care about the port, and creating the container before you stop
the old install keeps its first start out of the time the screens are down.

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
