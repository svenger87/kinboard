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
- **Docker Desktop**, with *Settings → Resources → WSL integration* switched on
  for your distribution.

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
COMPOSE_FILES="-f docker-compose.yml -f docker-compose.image.yml" ./start.sh up
```

Then open `http://localhost:3000` in Windows — WSL forwards localhost, so the
browser on the Windows side reaches it without any extra configuration.

For everything after that — integrations, the family code, adding the wall
panel — follow [Quick start](Quick-start) from step 3.

## Reaching it from the wall panel

The panel needs a hostname or IP that works from another machine, and
`localhost` will not do. Two options:

- **Give the Windows host a fixed IP** on your LAN and use that. You may need
  to allow the port through Windows Defender Firewall.
- **Put a reverse proxy in front**, as in [Self-hosting](Self-hosting).

WSL2 runs its own virtual network, so a port published by Docker Desktop is
forwarded from Windows automatically. You do not need to forward anything
inside WSL by hand.

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
itself down when nothing is using it. Keep Docker Desktop running; it holds the
distribution open. Do not run `wsl --shutdown` while Kinboard is meant to be
up.

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
