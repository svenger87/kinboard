# Photos

Kinboard shows your photos in two places: the **Photos page**, where you browse
them on purpose, and the **screensaver**, which shows them when the display goes
idle. Both read the same source, so you connect a library once.

## Choosing a source

**Settings → Photos.** Pick one:

| Source | What it needs | Follows changes? |
| --- | --- | --- |
| **Immich** | Your own Immich server's URL and an API key | Yes |
| **DLNA media server** | The server's description URL — no account | Yes |
| **iCloud Shared Album** | The album's public link — no Apple ID | Yes |
| **Unsplash** | Nothing; curated stock photos that rotate monthly | n/a |

Google Photos is **not** available, and cannot be. Google removed the
`photoslibrary.readonly` scope on 31 March 2025 — third-party apps can no
longer read your library at all, only media they uploaded themselves. The
Picker API that replaced it lets you hand an app a one-off selection, which
would make an import rather than a photo source that stays current.

## DLNA media server

If a NAS in the house already shares photos — MiniDLNA, Jellyfin, Plex, a
Synology or QNAP media server — Kinboard can read it. No account, no API key,
nothing to install.

**Kinboard cannot find the server by itself.** Discovery works by shouting on a
multicast address, and Kinboard runs in a container that never receives that
traffic. So you paste the server's *device description URL*:

| Server | Usual address |
| --- | --- |
| MiniDLNA, most NAS boxes | `http://<ip>:8200/rootDesc.xml` |
| Jellyfin | `http://<ip>:8096/dlna/<id>/description.xml` |
| Plex | `http://<ip>:32469/DeviceDescription.xml` |

Then pick a folder. DLNA has no notion of an album — it publishes whatever
folder tree the server was configured with — so the picker walks it one level
at a time and shows how many photos are in the folder you are looking at.

Images are fetched through Kinboard rather than linked directly. A DLNA server
speaks plain HTTP, and a wall display served over HTTPS will silently refuse to
load an HTTP image.

## iCloud Shared Album

On an iPhone or iPad: open the album in Photos, tap the people icon, and turn
on **Public Website**. Copy the link it shows and paste it into Kinboard.

That is the whole setup. No Apple ID, no password, no two-factor prompt, and
nothing installed on the phone. Photos added to the album later appear in
Kinboard on their own.

If the album stops working, the usual cause is the Public Website switch having
been turned off — from outside, that looks the same as a wrong link, so
Kinboard says which it thinks it is.

Apple's image links expire after about an hour. Kinboard fetches fresh ones as
it goes; nothing is cached and nothing is copied off iCloud.

## The Photos page

A grid of everything in the current album, newest first. Tap one to open it
full-screen; arrow keys or swipe to move between them, Escape or the close
button to come back.

Where a source has albums — Immich's albums, a DLNA server's folders — they
appear above the photos, and a breadcrumb walks back out. An iCloud shared
album is a single album, so the page opens straight into the photos.

The Photos entry stays out of the navigation until a source is connected and
has something in it.

## Troubleshooting

**"Could not reach that server"** when connecting DLNA — check the address in a
browser on the same network. If the browser cannot load it either, the URL or
the port is wrong. If it loads for you but not for Kinboard, the container
cannot route to that address; a server bound to a Docker-internal address is
the usual cause.

**Photos appear in Settings but not on the screensaver** — the screensaver only
uses the source selected in Settings → Photos. Selecting a source and
connecting one are two different steps.

**A DLNA folder shows fewer photos than expected** — Kinboard reads only images
from the folder you picked, not from folders inside it. Pick the inner folder,
or point the server at a flatter directory.

**An iCloud album shows nothing** — re-check Public Website on the phone, then
reconnect. A link copied from a *private* shared album will never work.

See also: [Screensaver](Screensaver), [Immich](Immich).
