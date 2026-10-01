# AI assistants

Kinboard has a built-in MCP endpoint at `/api/mcp`. Claude and ChatGPT use it
to read the family's calendar, tasks, notes and shopping list and to add to
them. They cannot control Home Assistant devices.

## Connect Claude or ChatGPT

1. Make Kinboard reachable over HTTPS on a public hostname (a reverse proxy,
   Cloudflare Tunnel or Tailscale Funnel). Claude and ChatGPT connect from the
   internet, not from your network.
2. In Claude: **Settings → Connectors → Add custom connector**. In ChatGPT:
   add a custom connector (developer mode). Enter
   `https://<your-kinboard>/api/mcp`.
3. A Kinboard page opens. If this browser isn't joined to your family yet,
   join first. Choose what the assistant may do, enter your settings PIN and
   select **Allow**. If your family has no PIN yet, you set one here (4 digits,
   entered twice) — it then also protects the settings pages.

Approve in the browser tab the assistant opened. The request is tied to that
browser, so a link copied to another device shows as expired — start the
connection again there instead.

The connection appears under **Settings → Integrations** with an "Assistant"
label. Revoke it there to disconnect.

## Claude Code on your own network

Claude Code runs on your computer, so a LAN address works:

    claude mcp add --transport http kinboard http://kinboard.local:3000/api/mcp

It signs in through the same Kinboard page — with the same settings PIN. Or create a token under
**Settings → Integrations** and pass it as a header:

    claude mcp add --transport http kinboard http://kinboard.local:3000/api/mcp \
      --header "Authorization: Bearer kbi_…"

## Permissions

| Permission | Lets the assistant |
|---|---|
| `family:read` | read the summary, calendar, tasks and shopping list |
| `notes:read` | read notes |
| `calendar:write` | add calendar events |
| `tasks:write` | add tasks |
| `shopping:write` | add shopping items |
| `notes:write` | add notes |
| `energy:read` | read the solar sensors set up under Energy |

Twenty wrong PINs within an hour lock PIN entry for the rest of that hour.

## Forgot the PIN?

The PIN protects the settings pages and approving assistants, and Kinboard
checks it on the server — there is no way around it from a browser. If nobody
remembers it, remove it from the database on the machine running Kinboard
(the container is `kinboard-db` unless you changed `PROJECT_NAME`):

    docker exec -i kinboard-db psql -U postgres -d postgres -c "DELETE FROM integration_secrets WHERE key = 'settings_pin';"

That removes the PIN for every family on this Kinboard. Open **Settings** and
set a new one.
