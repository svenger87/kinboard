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

`setup.sh` asks no questions about addresses. On WSL it suggests
`http://localhost:3001` and stores it as `SITE_URL`, which is only used for
links Kinboard hands to other apps (the calendar feed).

Then open **`http://localhost:3001`** in the Windows browser. WSL forwards
localhost from Windows into the VM, so it reaches the stack without further
configuration.

## One address

Kinboard answers on one port, `3001`: the page, your family's data, uploaded
pictures and live updates all come from the address you typed. There is no
second address to get right. (Until 1.15 there could be one — `API_EXTERNAL_URL`
on port 8100 — and a wrong value there loaded the page and then failed with
"Can't reach the Kinboard server". Since 1.15 that setting is ignored; a line
left in `.env` does no harm.)

If the browser still behaves like an older version after an upgrade, clear the
site data for `localhost:3001` — Kinboard installs an offline cache that can
remember the page as it was.

For everything after that — integrations, the family code, adding the wall
panel — follow [Quick start](Quick-start) from step 3.

## Reaching it from other devices

`localhost` only means *this* PC. For a phone, a tablet or a separate wall
panel, three things have to be true, and missing any one of them looks the
same from the phone — a timeout, or the page loading and then "can't reach
the Kinboard server".

**You do not need port forwarding on your router.** That is for reaching
Kinboard from the internet. The obstacle here is inside the Windows machine.

### 1. The stack has to be reachable on the PC's LAN address

- **Docker Desktop** publishes the stack's ports on the Windows machine
  itself. Nothing to do here.
- **Docker Engine inside WSL** is reachable from Windows through localhost
  forwarding and from nowhere else: WSL2 sits behind its own NAT, and its
  internal address (`172.x`) is invisible to the LAN and changes on restart.
  On Windows 11 22H2 or later, switch WSL to mirrored networking so it shares
  the PC's LAN address. In `C:\Users\<you>\.wslconfig`:

  ```ini
  [wsl2]
  networkingMode=mirrored
  ```

  then `wsl --shutdown` in PowerShell, open WSL again, and `./start.sh up`.

  On older Windows without mirrored mode, the fallback is a port proxy from
  the PC's address to WSL's — `netsh interface portproxy add v4tov4
  listenport=3001 listenaddress=0.0.0.0 connectport=3001
  connectaddress=<wsl-ip>` — with the catch that WSL's
  address changes on every restart and the rules have to follow it.

### 2. The firewall has to let it in

From an **administrator** PowerShell:

```powershell
New-NetFirewallRule -DisplayName "Kinboard" -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow -Profile Private
```

That rule only applies while your network is set to **Private** — check
*Settings → Network & internet → your Wi-Fi/Ethernet → Network profile type*.
A network Windows considers Public ignores it.

In mirrored mode Windows puts a second firewall in front of WSL, the Hyper-V
firewall. If the phone still times out after the rule above:

```powershell
New-NetFirewallHyperVRule -Name "Kinboard" -DisplayName "Kinboard" -Direction Inbound -VMCreatorId '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -Protocol TCP -LocalPorts 3001
```

(The GUID identifies WSL; it is the same on every machine.)

### 3. Open it at the PC's address

Open `http://<PC-IP>:3001` on the phone and join with the family code. Point
the panel at the same address rather than `localhost`. There is nothing to
configure in Kinboard for this: every device talks to it at the address it
opened it from.

If you want the links Kinboard hands to other apps (the calendar feed) to use
that address too, set it once from the project root, then restart:

```bash
cd ~/kinboard
./setup.sh --url http://<PC-IP>:3001

cd ~/kinboard/webapp/docker
./start.sh up
```

**The two scripts live in different directories** — `setup.sh` at the top of
the project, `start.sh` under `webapp/docker` — so each block here changes
directory before it calls one.

**Give the PC a fixed IP** — a DHCP reservation on your router. The phone
and the panel have the address bookmarked, and if the router hands out a
different one, every device stops finding it.

If the panel on the wall **is** this PC and nothing else needs to reach it,
none of this section applies — localhost is correct.

### Why this is so much work

All three steps exist only because the server runs inside WSL on Windows:
WSL's own network, the extra firewall, and an address that has to stay put. On a Raspberry Pi, a NAS or any small Linux machine the stack sits on
your home network directly, a phone reaches it without any of this, and
`setup.sh` suggests the right address by itself. If you have one, that is the
better host; the Windows PC can stay the display.

### Outside your home network

Kinboard is built for the home network, and this page stops there. Reaching
it from the internet — a domain, HTTPS, port forwarding on the router — is
covered for a Linux host in [Self-hosting](Self-hosting), and it is not worth
attempting on a WSL host without a strong reason.

The low-effort way to use it from outside is a VPN such as Tailscale on the
PC and the phone: no router changes, no domain, no certificate. Open Kinboard
on the phone at an address Tailscale can reach — the PC's Tailscale address,
or your LAN IP if you share your home network as a Tailscale **subnet route**
from a device that is always on (see Tailscale's documentation on subnet
routers).

## When it does not work

**`kinboard-db is unhealthy` / `dependency failed to start`** — almost always
the `/mnt/c` problem above. Check with `pwd`. The database itself will say so:

```bash
docker logs kinboard-db
```

**The phone times out on `http://<PC-IP>:3001`** — nothing on the LAN
address is answering: step 1 or 2 of
[Reaching it from other devices](#reaching-it-from-other-devices). With Docker
Engine inside WSL and no mirrored networking, this is guaranteed.

**The phone loads the page, then "can't reach the Kinboard server"** — on an
install older than 1.15, `API_EXTERNAL_URL` in `webapp/docker/.env` still says
`localhost`; upgrading takes that setting out of the picture. On 1.15 or later
the page and its data come from the same address, so clear the site data once
(the offline cache may hold an older page) and check
`docker logs kinboard-webapp`.

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
