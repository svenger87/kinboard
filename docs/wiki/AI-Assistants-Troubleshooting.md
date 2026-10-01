# AI assistants: troubleshooting

Part of the [AI assistants](AI-Assistants) guide. For problems with Kinboard
itself, see the main [Troubleshooting](Troubleshooting) page.

When something fails, ask the assistant what Kinboard answered. Kinboard's
error messages are written to be passed on ("`vehicles:read` authorization is
required", "too many edits and deletes — slow down"), and they usually say
exactly what is wrong.

## A new permission never gets asked for

**Symptom.** Kinboard gained a permission (`vehicles:read`, say) after you
connected ChatGPT. You reconnect, but ChatGPT doesn't ask for it, and
asking about the car still answers that `vehicles:read` authorization is
required.

**Why.** An assistant can remember the list of permissions it asked for when
you first added it and ask for exactly that list every time it reconnects;
ChatGPT does. So a permission that didn't exist back then is never in its
request.

**Fix.**

- **Tick it under "Also available".** Since 1.13, the consent page lists
  every permission the assistant didn't ask for under *"Also available —
  ChatGPT didn't ask for these"*, unticked. Tick the ones you want and allow
  as usual. Nothing in that list is granted unless you tick it.
- **On an older Kinboard, delete the connector in the assistant and add it
  again** with the same address. A newly added connector asks for the
  permissions Kinboard offers today. Then revoke the old connection under
  **Settings → Integration tokens**, so only the new one is left.

To check what a connection was actually given, look at its row under
**Settings → Integration tokens**: the permissions are listed next to it.

## The assistant gets "not found" (404)

The assistant address and Kinboard's sign-in addresses answer `404` while
**Allow AI assistants** is off for every family on the server. In a browser,
the sign-in step shows *"AI assistants are not switched on for this Kinboard.
Turn them on under Settings → Integrations, then start the connection
again."*

- Switch it on under **Settings → Integration tokens → Allow AI assistants**,
  then start the connection again from the assistant.
- If it is on for your family and the consent page says *"AI assistants are
  switched off in Settings → Integrations."*, the browser you are using is
  joined to a different family on the same server, one that has it off.
- After switching it on, the sign-in addresses can take up to 30 seconds to
  answer.
- If the switch was off at any point, every assistant connection was revoked
  at that moment. Connect them again.

## The consent page never loads, or says "Can't reach the Kinboard server"

The consent page is an ordinary Kinboard page, opened at the address you
gave the assistant. It needs Kinboard itself to work in that browser at that
address: if it sits on a loading spinner and then shows *"Can't reach the
Kinboard server"*, the browser can open the page but can't reach Kinboard's
database API there.

This usually means Kinboard was set up for a different address, such as the
LAN address, and the browser blocks requests from the public one. Open
`https://kinboard.example.com` in the same browser: if the dashboard doesn't
load there either, it's a server setup problem, not an assistant one. See
[Self-hosting: Changing the URL later](Self-hosting#changing-the-url-later)
and [Troubleshooting](Troubleshooting#app-misbehaves-blocked-requests-mismatched-origin-when-opened-via-localhost-or-a-different-hostname-than-expected).

If it is not joined to your family yet, the browser is first sent to the
join screen and returned to the consent page afterwards.

## The assistant can't connect at all

ChatGPT and Claude reach Kinboard from the internet. If adding the connector
fails before any Kinboard page opens:

- Check the address ends in `/api/mcp` and starts with `https://`.
- Check it is reachable from outside your network, not just from home (from
  a phone on mobile data, for example).
- Ask whoever runs the server to check the [Self-hosting
  notes](AI-Assistants-Self-Hosting#checking-it-from-outside): a login page
  in front of Kinboard, or a proxy that sends `/.well-known/` somewhere
  else, stops the assistant before Kinboard ever sees it.

## "This request has expired or was already answered"

- The consent link was opened in a different browser or device from the one
  the assistant opened. The request is tied to that browser. Start again on
  the device you want to use.
- More than 10 minutes passed between starting the connection and
  answering. Start again.
- It was already answered. Check **Settings → Integration tokens** for the
  connection.

## The assistant has to sign in again

An assistant's access lasts an hour at a time and renews itself in the
background. The renewal itself lapses **after 60 days without use**; each use
pushes it back again. After that, or after any of the following, the
assistant has to go through the consent page again:

- the connection was revoked under **Settings → Integration tokens**;
- **Allow AI assistants** was switched off (that revokes every assistant);
- the assistant presented a renewal it had already used; Kinboard refuses
  it, and the connection has to be approved again.

A token created by hand never expires; it only stops working when it is
revoked, or at `/api/mcp` while the switch is off.

## "Too many …, slow down"

The assistant ran into one of the [limits](AI-Assistants-Permissions-and-Safety#limits),
and nothing happened. The answer says when to try again.

| Message | Limit |
|---|---|
| too many edits and deletes — slow down | 30 edits and deletes per 10 minutes per connection |
| too many messages — slow down | 5 messages to the screens per 10 minutes |
| too many requests — slow down | 120 reads or 30 writes a minute per token |
| `too_many_timers` | 10 timers running or ringing for the family; stop one first |
| This assistant already has requests waiting for confirmation, or has asked too often | 2 requests waiting at once, 5 new ones per 10 minutes |

These counters live in the Kinboard server's memory, so restarting the
webapp container resets them.

## Energy "today" looks wrong or is missing

Today's solar, battery and grid energy is **the change since midnight in the
family's time zone, from Home Assistant's statistics**, the same figure the
Energy page shows, whether the sensor resets each night or counts forever.
The counter's raw reading is passed along as `total`, and the assistant is
told never to report it as today's.

- **The assistant quoted a huge number** (the lifetime total, 1,636 kWh
  instead of a few): it read `total`. Point it at "today's value", or update
  Kinboard if your version predates this behaviour.
- **Today's figure is empty, with the reason `no_statistics`**: Home
  Assistant keeps no long-term statistics for that sensor. Choose a sensor
  that has them under **Settings → Energy**.
- **Empty with `statistics_unavailable`**: Home Assistant couldn't be asked
  just then. The power readings still come back; try again later.
- **A sensor is `null`**: it isn't set up under **Settings → Energy**, or
  Home Assistant isn't reporting it. The assistant only ever sees the sensors
  chosen there.

## The assistant can't see a device

An assistant sees only the devices in Kinboard's catalogue. Add the device
under **Settings → Things in your house** (**Add a device**); that needs Home
Assistant to be connected under **Settings → Home Assistant**. Anything else
is "not found" to the assistant, as if it didn't exist, and the assistant
cannot find out what else is in Home Assistant.

Also check:

- The connection has `home:read` (to list devices and read their state) and
  `home:control` (to act). They are separate permissions.
- The action is one an assistant may run on that kind of device, with
  values in range. The [table of actions](AI-Assistants-Permissions-and-Safety#home-assistant-devices)
  is fixed; anything else is refused.
- A switch or a cover that "always asks" is probably not reported as an
  outlet or a blind. Fix that with Home Assistant's **Show as**.

## A sensitive action or a booking never shows up on the screens

- **No settings PIN.** A family without one can't allow anything, so
  nothing is sent to the screens; the assistant is told straight away that
  the family has no settings PIN and nothing was done. Set one under
  **Settings**.
- **After an upgrade**, the realtime container has to be restarted before
  screens get new requests. See [Self-hosting
  notes](AI-Assistants-Self-Hosting#upgrading).
- **Phones**: only phones with notifications switched on get the push. See
  [Notifications](Notifications).
- **It expired.** A request lasts 2 minutes. Ask again when someone is near
  a screen.

## "Allowed, but Kinboard couldn't tell whether it happened"

Home Assistant didn't confirm the action in time. It may or may not have
happened, so Kinboard says so rather than guessing. Check the device before
asking again, so the action doesn't run twice. For a pocket-money booking
(*"Check the pocket money before trying again"*), look at the child's
balance first.

## The cars show no readings

`list_vehicles` reads the cars set up under **Settings → Vehicles** from
Home Assistant. A car marked unavailable comes with a reason, such as
`home_assistant_unavailable` or `not_configured`. Readings can be a few
minutes old; the assistant is told to say when each was taken. See
[Vehicles](Vehicles).

## Forgot the settings PIN

See [Forgot the PIN?](AI-Assistants#forgot-the-pin).
