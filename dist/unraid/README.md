# Kinboard for Unraid

The Unraid Community Applications template for Kinboard's all-in-one image, `ghcr.io/svenger87/kinboard-aio`.

Generated from https://github.com/svenger87/kinboard (`dist/kinboard.yaml`) by `scripts/stores/build-store-listings.mjs`. Don't edit anything here by hand:
change the metadata there, regenerate, and copy `dist/unraid/` here.

## Install without Community Applications

Add `https://github.com/svenger87/kinboard-unraid` to the Docker page's template repositories, or copy `templates/kinboard.xml` (from `https://raw.githubusercontent.com/svenger87/kinboard-unraid/main/templates/kinboard.xml`)
into `/boot/config/plugins/dockerMan/templates-user/` on the flash drive; then Docker → Add Container and pick the
template. (To be confirmed on a real Unraid 7 box before any submission: RFC-024 §10.)

Set the container's data folder (default `/mnt/user/appdata/kinboard`) to a folder on a disk or the cache, and PUID/PGID to the
owner of that folder (99:100, Unraid's nobody:users, by default). Moving an existing Kinboard install here:
`kinboard export` on the old one, `kinboard import` on this one (the wiki's All-in-one page).

## Automatic updates

`templates/kinboard-updater.xml` is a second, optional container, `kinboard-updater`, that keeps Kinboard up to date: it checks the
registry every 30 minutes, takes Kinboard's own checked database dump, replaces the container with the same settings and
the new image, and puts the previous one back when the new one does not come up healthy. It is the only container
that gets the Docker socket. Install it after Kinboard, leave its "Kinboard container" at the Name you gave Kinboard,
and leave Kinboard out of the Auto Update Applications plugin (no backup, no way back). Details: the wiki's All-in-one page.

Support: https://github.com/svenger87/kinboard/discussions. Documentation: https://github.com/svenger87/kinboard/wiki. Licence: PolyForm-Noncommercial-1.0.0.
