# Windows (WSL) as a host

Running the Kinboard **server** on a Windows machine. This is a different
question from the one [Kiosk on Windows 11](Kiosk-Windows-11-Mele-4C) answers:
that page is about the **panel on the wall** — the Windows box that displays
Kinboard. It says nothing about where the server runs, and the two do not have
to be the same machine.

Most people who read that page and then try to install the server on the same
Windows box end up here, because the default install path assumes Linux
conventions throughout.

## Should you?

Honestly: Windows works, and it is not the easiest choice.

Kinboard is something a household leaves running. Windows reboots itself after
updates, sleeps unless told not to, and Docker Desktop wants a logged-in
session to keep containers alive. None of that is fatal, all of it is friction
you will meet again in six months.

If you have a Raspberry Pi, a NAS, an old laptop or any small Linux box that
stays awake, put the server there and let your Windows machine be the display.
That is the arrangement the [reference build](Reference-Build) actually uses.

If Windows is what you have, read on — it does work.

## What you need

- **Windows 10 (2004+) or Windows 11**
- **Virtualisation enabled in the BIOS/UEFI.** Usually called Intel VT-x, AMD-V
  or SVM. If WSL2 refuses to install, this is the first thing to check.
- **WSL2** — `wsl --install` from an admin PowerShell, then reboot.
- **Docker**, one of:
  - **Docker Desktop**, with *Settings → Resources → WSL integration* switched
    on for your distribution, or
  - **Docker Engine installed inside the WSL distribution** itself (no Docker
    Desktop). Works, and behaves differently on the network — see
    [Reaching it from other devices](#reaching-it-from-other-devices).

## The one rule that matters

**Install into the WSL filesystem — your Linux home — never into `/mnt/c/`.**

Everything under `/mnt/c`, `/mnt/d` and so on is a Windows drive mounted into
WSL. PostgreSQL cannot create its data directory there: the ownership and
permission model it requires does not exist on an NTFS mount. `initdb` fails,
the database container never becomes healthy, and every other service reports

```
Error dependency db failed to start — container kinboard-db is unhealthy
```

which says nothing about the real cause. `DATA_DIR` defaults to `./data`,
inside the project, so wherever you clone is where the database tries to live.

Since 1.11, `./start.sh up` checks this and refuses with an explanation rather
than letting you walk into it.

If you are unsure where you are, run `pwd` in the project directory. A path
starting `/mnt/c/` is the wrong place.

## Install

Open your WSL distribution — **not** PowerShell, and not a directory opened
from Windows Explorer.

```bash
cd ~
git clone https://github.com/svenger87/kinboard.git
cd kinboard
./setup.sh
cd webapp/docker
./start.sh up
```

`setup.sh` asks one question — the address you will open Kinboard at. **On
WSL, answer `http://localhost:8100`.** Recent versions suggest that by
themselves; older ones suggested your public IP, which does not work (see
below).

Then open **`http://localhost:3001`** in the Windows browser. WSL forwards
localhost from Windows into the VM, so it reaches the stack without further
configuration.

## The second address

This is the part that is easy to get wrong, and the error you get does not
point at it.

Kinboard uses two addresses. The **page** comes from wherever you typed —
`localhost:3001`. But everything the page does after that — loading your
family's data, saving, live updates — goes from the browser to a second,
fixed address: `API_EXTERNAL_URL` in `webapp/docker/.env`, which `setup.sh`
wrote. If that address is not reachable from your browser, the page loads,
the first step of setting up a family works (it goes through the page's own
address), and then:

- **"Kinboard-Server nicht erreichbar" / "Can't reach the Kinboard server"**
  after the family-name step, sometimes only after a couple of minutes, and
- **"Live-Updates pausiert" / "Live updates paused"** permanently at the bottom,
  and nothing you enter is saved.

Those minutes are timeouts. Check what is configured:

```bash
cd ~/kinboard/webapp/docker
grep -E "API_EXTERNAL_URL|SITE_URL" .env
```

For a server you use from the same Windows PC, it should read:

```
API_EXTERNAL_URL=http://localhost:8100
SITE_URL=http://localhost:3001
ADDITIONAL_REDIRECT_URLS=http://localhost:3001
```

If it does not, edit those three lines and run `./start.sh up` again. Running
`setup.sh` again will **not** fix it: once an address is written, setup keeps
it. If the browser still shows the old behaviour, clear the site data for
`localhost:3001` — Kinboard installs an offline cache that can remember the
page as it was.

Before 1.11, `setup.sh` suggested your **public** IP here on WSL — and on most
home servers — because it treated "public address differs from local address"
as a sign of a cloud server, when behind a home router the two always differ.
If you installed with an older version and pressed Enter, that is what you
have.

For everything after that — integrations, the family code, adding the wall
panel — follow [Quick start](Quick-start) from step 3.

## Reaching it from other devices

`localhost` only means *this* PC. A phone, a tablet or a separate wall panel
needs an address that works from the network, and then `API_EXTERNAL_URL`
has to be that address too — not localhost — or those devices get the "second
address" failure above.

How you get there depends on how Docker is installed:

- **Docker Desktop** publishes the stack's ports on the Windows machine
  itself. Give the PC a fixed IP on your LAN, allow ports 3001 and 8100
  through Windows Defender Firewall, and set `API_EXTERNAL_URL` to
  `http://<that IP>:8100` (and `SITE_URL` to `http://<that IP>:3001`).
- **Docker Engine inside WSL** is reachable from Windows through localhost
  forwarding and from nowhere else: WSL2 has its own NAT, and its internal
  address (`172.x`) is invisible to the LAN and changes on restart. On
  Windows 11 22H2 or later, switch WSL to mirrored networking so it shares
  the PC's LAN address — in `%UserProfile%\.wslconfig`:

  ```ini
  [wsl2]
  networkingMode=mirrored
  ```

  then `wsl --shutdown`, start the distribution again, and use the PC's LAN
  IP as above.

If the panel on the wall **is** this PC, as in the reference build, none of
this is needed — localhost is correct.

Or put a reverse proxy in front, as in [Self-hosting](Self-hosting).

## When it does not work

**`kinboard-db is unhealthy` / `dependency failed to start`** — almost always
the `/mnt/c` problem above. Check with `pwd`. The database itself will say so:

```bash
docker logs kinboard-db
```

**You do not need to install PostgreSQL.** It runs in a container, as do all
the other services. A PostgreSQL installed on Windows will not help, and if it
is listening on port 5432 it will collide with Kinboard's.

**`docker: command not found` inside WSL** — Docker Desktop's WSL integration
is off for this distribution. *Settings → Resources → WSL integration*.

**Containers stop when you close the terminal** — they do not, but WSL shuts
itself down when nothing is using it. With Docker Desktop, keep Desktop
running; it holds the distribution open. With Docker Engine inside WSL,
nothing does that for you: the stack stops when the WSL VM goes idle. Keep a
WSL window open, or on Windows 11 set `vmIdleTimeout=-1` under `[wsl2]` in
`.wslconfig`. Either way, do not run `wsl --shutdown` while Kinboard is meant
to be up.

**Everything dies after a Windows update** — expected. Docker Desktop has to be
running for the stack to come back. Set it to start with Windows, and set the
containers' restart policy to `unless-stopped`, which the shipped compose files
already do.

## Keeping it running

- Docker Desktop: *Settings → General → Start Docker Desktop when you log in*.
- Windows needs to log in for that to happen, so either enable automatic login
  on a dedicated machine, or accept that a reboot needs a person.
- Turn off sleep: *Settings → System → Power → Screen and sleep → Never*.

This is the part that makes a Pi or a NAS attractive: none of it applies there.
