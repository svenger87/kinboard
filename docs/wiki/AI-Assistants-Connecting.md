# Connecting an assistant

Part of the [AI assistants](AI-Assistants) guide.

Every assistant connects to the same address, your Kinboard followed by
`/api/mcp`:

    https://kinboard.example.com/api/mcp

Most assistants then sign in through a Kinboard page where you choose what
the assistant may do and confirm with the settings PIN. Claude Code can also
use a token you create by hand.

## Before you start

1. **Kinboard must be reachable over HTTPS on a public hostname.** ChatGPT
   and Claude (on the web, the desktop app and the mobile apps) call Kinboard
   from their own servers on the internet. A LAN address such as
   `http://192.168.1.50:3001` cannot work for them. Claude Code is the
   exception, because it runs on your own computer. Operators:
   [Self-hosting notes](AI-Assistants-Self-Hosting).
2. **Switch on "Allow AI assistants".** Go to **Settings → Integration
   tokens** (the page is headed *Integrations*). Under **AI assistants**,
   turn on **Allow AI assistants**. If your family has a settings PIN, you
   are asked for it first. Until the switch is on, the assistant address
   answers *not found* (404), as if it didn't exist.
3. **Copy the address from the public hostname.** With the switch on, the
   page shows the assistant address and a **Copy the assistant address**
   button. It copies the address *of the page you are on*, so open Settings
   at `https://kinboard.example.com`, not at the LAN address, before copying
   it for ChatGPT or Claude.
4. **Have a joined browser to hand.** The consent page only opens in a
   browser that is joined to your family. If it isn't, Kinboard asks for the
   family's join code first and then takes you back to the consent page.

## ChatGPT

1. In ChatGPT, add a custom connector (this needs developer mode) and enter
   `https://kinboard.example.com/api/mcp` as its address.
2. ChatGPT opens the Kinboard consent page. Follow [the consent
   page](#the-consent-page) below.
3. After **Allow**, you're sent back to ChatGPT, and the connector is ready.

ChatGPT can remember the permissions it asked for the first time and ask for
exactly those again when it reconnects. If Kinboard later gains a permission
you want ChatGPT to have, see [A new permission never gets asked
for](AI-Assistants-Troubleshooting#a-new-permission-never-gets-asked-for).

## Claude (web, desktop and mobile)

1. In Claude, open **Settings → Connectors → Add custom connector** and enter
   `https://kinboard.example.com/api/mcp`.
2. Claude opens the Kinboard consent page. Follow [the consent
   page](#the-consent-page) below.
3. After **Allow**, you're sent back to Claude.

The Claude desktop app and the mobile apps reach custom connectors through
Anthropic's servers, exactly as claude.ai does, so they need the same public
HTTPS address. A LAN-only Kinboard is reachable only from Claude Code.

## Claude Code

Claude Code runs on your computer, so it can reach Kinboard on your own
network as well as over the internet. Use whichever address that computer can
reach.

### Sign in through Kinboard (OAuth)

    claude mcp add --transport http kinboard http://kinboard.local:3000/api/mcp

The first time Claude Code uses the server, it opens the same consent page in
your browser, with the same settings PIN. The page adds a warning: *"This
connection returns to a program on your own computer. Only approve it if you
just started it yourself."* That is expected for Claude Code; it is a reason
to say no to a consent page you did not start.

### With a token you create by hand

1. Go to **Settings → Integration tokens**. Under **New token**, give it a
   **Name** (only for you, to tell tokens apart), tick what it may do under
   **What may it do?**, and select **Create token**.
2. Copy it now. **Copy this token now**: Kinboard shows it once and stores
   only a hash. It starts with `kbi_`.
3. Pass it as a header:

       claude mcp add --transport http kinboard http://kinboard.local:3000/api/mcp \
         --header "Authorization: Bearer kbi_…"

A hand-made token is different from a connection made through the consent
page, so be aware of these differences:

| | Signed in through the consent page | Hand-made token |
|---|---|---|
| Shown in Settings | With the **Assistant** label | As an ordinary token |
| Works only while **Allow AI assistants** is on | Yes | Yes, at `/api/mcp` (it keeps working for the Integration API) |
| Switching **Allow AI assistants** off | Revokes it | Leaves it; it works at `/api/mcp` again once the switch is back on |
| Expires | Access refreshes hourly; sign-in lapses after 60 days without use | Never; revoke it by hand |
| Limit of 30 edits and deletes per 10 minutes | Yes | No |
| Limit of 10 running timers | Yes | No |
| Home Assistant's `add_pocket_money` service books without the PIN | Refused | Allowed |

The last row matters if you would paste a token into any AI program: a token
created by hand is a Home Assistant-style token, and Home Assistant's
`add_pocket_money` service books straight away. The MCP tools never use that
service (`book_pocket_money` always waits for the PIN, whatever the token),
but the Integration API offers it to any token holding `tasks:write`. Connect
assistants through the consent page, and give a hand-made token only the
permissions it needs.

## Other MCP clients

Any client that speaks MCP's Streamable HTTP transport and OAuth can
connect the same way as Claude and ChatGPT:

- Calling `/api/mcp` without a token answers `401` with a
  `WWW-Authenticate` header that points at
  `/.well-known/oauth-protected-resource/api/mcp`. The authorization server
  metadata is at `/.well-known/oauth-authorization-server`.
- Clients identify themselves either with a client ID metadata document
  (an HTTPS URL Kinboard fetches) or by registering at
  `/api/oauth/register`. The token endpoint accepts public clients only, with
  PKCE (`S256`).
- Redirect addresses must be HTTPS, or `http://localhost`,
  `http://127.0.0.1` or `http://[::1]` on any port.

A client that can send a fixed header can instead use a hand-made token, as
in [Claude Code](#with-a-token-you-create-by-hand).

## The consent page

This is the page that hands your family's data to an assistant, so it is
worth reading each time.

1. **The heading names the assistant:** *Connect Claude to Kinboard*.
2. **Who is really asking.** Underneath, one of two lines:
   - **Verified by** *claude.ai* (or another host): the assistant identified
     itself with a document on that website, which Kinboard fetched, so the
     website vouches for the name. Claude and ChatGPT both prefer this.
   - **Self-registered app — Kinboard can't confirm it is really
     *Claude*.** The assistant registered itself under that name, and anyone
     can send any name. Only continue if you started this yourself.
3. **Where you go afterwards:** *"After you approve, you'll be sent back to
   claude.ai."* Check that the host is the assistant you meant.
4. **It may…** One checkbox per permission the assistant asked for, all
   ticked. Untick any you don't want to give. At least one has to stay
   ticked. What each one allows: [Permissions and
   safety](AI-Assistants-Permissions-and-Safety#permissions).
   Below them, **Also available** lists every permission the assistant
   didn't ask for, unticked — tick any you want it to have. This matters when
   an assistant replays an old list on reconnect (see
   [Troubleshooting](AI-Assistants-Troubleshooting#a-new-permission-never-gets-asked-for)).
5. **Settings PIN.** Enter your family's 4-digit settings PIN. If the family
   has no PIN yet, the page asks you to set one instead (**New settings
   PIN**, **Repeat the PIN**); it then protects the settings pages too.
6. **Allow** or **Don't allow.** Either way, you're sent back to the
   assistant.

Some practical points:

- **Use the tab the assistant opened.** The request is tied to that browser.
  A link copied to another device shows *"This request has expired or was
  already answered"*. Start the connection again on the device you want to
  use.
- **Finish within 10 minutes.** A request that waits longer expires the
  same way.
- **Wrong PINs:** after 20 wrong PINs within an hour, PIN entry is locked for
  the rest of that hour (*"Too many wrong PINs. Try again later."*). The
  same counter covers the settings pages.
- If someone sets the family's first PIN somewhere else while you are on
  this page, it says *"A settings PIN was just set somewhere else"*. Reload
  and enter that PIN.

## After connecting

The connection appears under **Settings → Integration tokens** with the
assistant's name and an **Assistant** label, the permissions you gave, when
it was created and when it was last used.

To change a connection's permissions, revoke it and connect again. Kinboard
does not edit a connection's permissions in place.

## The "Allow AI assistants" switch

- **Off by default**, per family. Turning it on or off needs the settings PIN
  if the family has one.
- **While no family on the server has it on**, the assistant address and the
  sign-in addresses answer `404`, as if Kinboard had no assistant support at
  all.
- **While your family has it off**, nobody can approve an assistant for your
  family and no token, hand-made or not, works at `/api/mcp` for your
  family, even if another family on the same server has it on.
- **Switching it off revokes every assistant connection** your family has.
  Switching it back on does not bring them back; connect them again.
- **Home Assistant is not affected.** The Integration API that Home Assistant
  uses is not behind this switch.
