# AI assistants

Kinboard has a built-in [MCP](https://modelcontextprotocol.io) endpoint at
`/api/mcp`. Claude, ChatGPT and other MCP clients connect to it and can then,
depending on what you allow, read the family's day and keep its lists:
calendar, tasks, shopping list, notes, meal plan and recipes, timers,
birthdays, countdowns and screen messages. They can also read the energy
sensors and the cars' charge level, ask to book pocket money, and control the
Home Assistant devices you have put in Kinboard's device catalogue.

Anything that opens the house (a lock, an alarm, a garage door, a scene or a
script) and every pocket-money booking waits for a family member to allow it
on a Kinboard screen with the settings PIN. Anyone at a screen can deny it.

Nothing is reachable until you switch it on, and each connection gets only
the permissions you tick when you connect it.

## The guide

| Page | What's in it |
|---|---|
| **AI assistants** (this page) | Overview, quick start, forgotten PIN |
| [Connecting an assistant](AI-Assistants-Connecting) | ChatGPT, Claude (web, desktop, mobile), Claude Code, other MCP clients; the consent page step by step; the settings PIN; the switch |
| [What assistants can do](AI-Assistants-Capabilities) | Every tool, grouped by area, with the permission it needs and example requests in English and German |
| [Permissions and safety](AI-Assistants-Permissions-and-Safety) | Every permission, the PIN confirmation on the screens, the limits, what is hidden, what is never possible, revoking |
| [Troubleshooting](AI-Assistants-Troubleshooting) | A new permission never gets asked for, 404s, the page never loads, sign-in expired, "slow down", energy figures, devices the assistant can't see |
| [Self-hosting notes](AI-Assistants-Self-Hosting) | For whoever runs the server: public HTTPS, reverse proxies, the address Kinboard advertises, upgrading, the Integration API |

## Quick start

You need a Kinboard that is reachable **over HTTPS on a public hostname**
(through a reverse proxy, Cloudflare Tunnel or Tailscale Funnel). Claude and
ChatGPT connect from their own servers on the internet, not from your
network. Claude Code is the exception: it runs on your computer and can use
a LAN address. See [Self-hosting notes](AI-Assistants-Self-Hosting).

1. Open Kinboard **at its public address** on a device joined to your family,
   go to **Settings → Integration tokens** (the page is headed
   *Integrations*) and switch on **Allow AI assistants**.
2. Under **AI assistants** on the same page, copy the assistant address
   (**Copy the assistant address**). It looks like
   `https://kinboard.example.com/api/mcp`.
3. Add that address to your assistant as a custom connector. How, for each
   assistant: [Connecting an assistant](AI-Assistants-Connecting).
4. A Kinboard page opens: **Connect *Claude* to Kinboard**. Untick anything
   the assistant should not be allowed to do, enter your **Settings PIN** and
   select **Allow**. If your family has no settings PIN yet, you set one
   here.
5. Ask something. *"What's on the calendar tomorrow?"* or *"Was steht morgen
   im Kalender?"*

The connection now appears under **Settings → Integration tokens** with an
**Assistant** label, its name and its permissions. **Revoke** there
disconnects it.

You can connect more than one assistant, and more than one connection of the
same assistant (Claude on the web and Claude Code, say). Each one is its own
row, with its own permissions, revoked on its own.

## How it fits together

- **Assistants act through Kinboard, not around it.** Every tool calls the
  same [Integration API](AI-Assistants-Self-Hosting#the-integration-api) route
  Home Assistant uses, with the assistant's own token, so the permission
  checks, family scoping and limits are the same ones.
- **Home control stops at your catalogue.** An assistant sees and controls
  only the devices you added under **Settings → Things in your house**, and
  only a fixed set of actions per kind of device. There is no "run any Home
  Assistant service" tool. See [Permissions and safety](AI-Assistants-Permissions-and-Safety#home-assistant-devices).
- **Switching it off disconnects everyone.** Turning **Allow AI assistants**
  off revokes every assistant connection the family has. Tokens you created
  by hand for Home Assistant keep working; the Integration API is not behind
  this switch.

## Forgot the PIN?

The settings PIN protects the settings pages, connecting an assistant and
allowing an assistant's request on a screen. Kinboard checks it on the
server, so there is no way around it from a browser. If nobody remembers it,
remove it from the database on the machine running Kinboard (the container
is `kinboard-db` unless you changed `PROJECT_NAME`):

    docker exec -i kinboard-db psql -U postgres -d postgres -c "DELETE FROM integration_secrets WHERE key = 'settings_pin';"

That removes the PIN for every family on this Kinboard. Open **Settings** and
set a new one.

## Related

- [Home Assistant](Home-Assistant): the Integration API tokens Home Assistant
  uses, and the device catalogue's background
- [Security and threat model](Security-and-Threat-Model)
- [Pocket Money](Pocket-Money), [Vehicles](Vehicles), [Timers](Timers),
  [Messages](Messages), [Recycle bin](Recycle-Bin)
