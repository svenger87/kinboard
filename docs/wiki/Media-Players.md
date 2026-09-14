# Media players

Kinboard can show and control speakers, televisions, and other media players
that are already connected to Home Assistant. The Media page gives each player
its own card, while the optional dashboard widget follows whatever is currently
playing.

## Before you start

Connect Kinboard to Home Assistant under **Settings → Home Assistant**. The
player must appear in Home Assistant as a `media_player` entity. Kinboard does
not connect directly to Sonos, Apple TV, Spotify, or a speaker vendor; Home
Assistant is the driver.

Enable the **Media** plugin under **Settings → Plugins**, then open
**Settings → Media players**:

1. Choose a Home Assistant media-player entity.
2. Select **Add a player**.
3. Repeat for each speaker or screen you want on the board.

The Media navigation item appears after the first player is added. Removing a
player from Kinboard does not remove or change the entity in Home Assistant.

## Controls

Open **Media** from the navigation bar to see every configured player. A card
can show artwork, title, artist, playback progress, volume, and the current
source. Controls appear only when the device tells Home Assistant it supports
them, so different players can have different buttons:

- power on or off;
- previous, play or pause, and next;
- mute and volume;
- source selection;
- **Browse**, for devices that expose a browsable media library.

Browse opens one folder or category at a time. Select an album, playlist,
station, or playable item to start it on that player. Library artwork is
proxied through Kinboard so the Home Assistant access token never reaches the
browser.

An unreachable player is dimmed and marked **Not reachable**. Kinboard does not
turn a temporarily slow device into a connection failure; a command that does
fail shows a small error on that player's card.

## Dashboard widget

Enable **Media** under **Settings → Widgets** to put the player card on the
dashboard. The widget stays out of the way when nothing is playing. If several
players are active, use the player names above the card to switch between them.

## Troubleshooting

| Problem | Check |
|---|---|
| No devices in **Add a player** | Confirm Home Assistant is connected and the device exists there as a `media_player` entity. |
| Media is absent from navigation | Enable the Media plugin and add at least one player. |
| A control is missing | Check the entity's supported features in Home Assistant. Kinboard hides controls the entity does not advertise. |
| Browse is missing or empty | The Home Assistant entity or its integration must support media browsing and return a library. |
| Artwork is blank | Confirm Home Assistant can load the entity picture and that Kinboard can reach the Home Assistant URL from the server. |
| Commands fail | Try the same command in Home Assistant, then check `docker logs kinboard-webapp`. |

See [Home Assistant](Home-Assistant) for connection setup and [Dashboard](Dashboard)
for arranging widgets.
