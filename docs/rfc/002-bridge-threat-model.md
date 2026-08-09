# RFC-002 — Bridge threat model

| | |
|---|---|
| **Status** | Draft — no implementation, and none should start before §10 is answered |
| **Date** | 2026-08-09 |
| **Target** | Phase 4, Bridge prototype |
| **Depends on** | RFC-001 (Integration API), Phase 3 (Heute-Motor) |
| **Source** | *Produktvision und Implementierungsplan 2026*, building block C |

---

## 1. Why this document exists before any code

Everything Kinboard does today happens inside one house. The database is on the
family's own hardware, the browser is on their own network, and the Home
Assistant token never leaves the building. The worst outcome of a bug is that a
family sees the wrong reminder.

The Bridge changes that. It exists so that something outside the house can ask
the house to do things — and the moment that path exists, the worst outcome is
no longer a wrong reminder. It is a stranger unlocking a door.

The plan requires a threat model and an external security review **before any
public use**, and puts them in the same line for a reason: a threat model
written after the protocol is a justification, not an analysis. This document
is therefore written first, and deliberately says "unresolved" where it is.

---

## 2. What is being protected

In rough order of how bad it is to lose:

| Asset | Why it matters | Worst case |
|---|---|---|
| **Physical actuation** | locks, garage doors, alarms | a stranger opens the house |
| **The Home Assistant token** | grants everything HA can do, forever | total, silent, persistent control |
| **Presence data** | who is home, and when nobody is | burglary timing, stalking |
| **Family content** | calendar, photos, children's names and schedules | the children's routine is a document |
| **Availability** | the board is a household fixture | it stops being trusted and stops being used |

Presence deserves its place. It reads as less serious than a lock because
nothing moves — but "the house is empty on Tuesday mornings" is exactly the
information a burglary needs, and unlike a lock it can be gathered passively,
over weeks, without anything looking wrong.

---

## 3. Trust boundaries

```
[ family's phone, outside ]
        │  (1) internet
        ▼
[ Kinboard Cloud relay ]           ← untrusted for content and intent
        │  (2) outbound WebSocket, initiated from inside
        ▼
[ Bridge process, inside the house ]  ← the only thing that decides
        │  (3) local network
        ▼
[ Home Assistant ]                  ← holds the real power
```

The critical claim is that **(2) is outbound only**. The house never accepts an
inbound connection, so no port is forwarded and there is nothing on the public
internet to scan, fingerprint or exploit. The relay is reachable; the house is
not.

The second claim is that **the relay is untrusted**. It sees that a message
passed and roughly when. It must not be able to author a command, alter one, or
replay one — and must not hold anything that would let it. This is what makes
"cloud never holds a general HA token" (a Phase 4 exit criterion) meaningful
rather than a slogan: the token stays on the Bridge, and the Bridge is the only
component that talks to Home Assistant.

---

## 4. Adversaries

Ordered by how likely they are to actually turn up, which is not the order
security documents usually use.

**A1 — The internet.** Untargeted scanning and exploitation. Cheap, constant,
and the reason "no inbound port" is worth more than any amount of
authentication on an inbound port.

**A2 — A compromised or hostile relay.** Either the cloud is breached or its
operator is. This is *us*, and it is the adversary a self-hoster is most
entitled to worry about, because they chose self-hosting precisely to avoid
trusting an operator. A design that requires the relay to be honest is a design
that has failed the people it is for.

**A3 — Someone on the family's network.** A guest on Wi-Fi, a compromised IoT
device, a teenager. Inside the LAN, past every network control.

**A4 — A former member of the household.** A departed partner, an ex-lodger, an
adult child. Retains a paired device and legitimate knowledge. This case
matters more than its probability suggests, because it is the one where
"revocation" stops being an administrative feature and becomes a safety one.

**A5 — A family member exceeding their remit.** A child unlocking the door for
a friend. Not an attacker; a reason default-deny has to be per-capability
rather than per-person.

---

## 5. Attack surface, and what answers each

| # | Attack | Answer |
|---|---|---|
| 5.1 | Scan and exploit an exposed service | No inbound listener at all. Outbound WebSocket only |
| 5.2 | Relay forges a command | Commands signed by the *device*, verified by the Bridge. The relay holds no signing key |
| 5.3 | Relay replays a captured command | Nonce + expiry, and the Bridge remembers spent nonces for at least the expiry window |
| 5.4 | Relay reorders or drops commands | Expiry bounds the damage of delay; dropping is a denial-of-service, not an escalation. **Ordering is not guaranteed** — see §7.1 |
| 5.5 | Stolen device | Per-device keys, revocable individually and without rotating anything else |
| 5.6 | Compromised Bridge host | Total loss. Out of scope, and stated as such rather than pretended away |
| 5.7 | Command outside the allowlist | Default deny. A capability absent from the allowlist is refused by the Bridge, not by the cloud |
| 5.8 | Relay learns the family's routine from traffic | **Unresolved** — see §7.2 |
| 5.9 | Family cannot stop it | Local kill switch that needs no internet and no cloud account |

### On the kill switch

It must work when the internet is down, when the cloud is unreachable, and when
the person using it is angry and not reading instructions. That means physical
or local-network, not a setting in a cloud dashboard. A kill switch that
requires the thing it is killing is not a kill switch.

---

## 6. What the Bridge must never do

- Never accept an inbound connection.
- Never send the Home Assistant token anywhere, including to the relay,
  including in diagnostics or crash reports.
- Never execute a command it cannot verify — an unverifiable command is
  refused, never "allowed because it looked routine".
- Never expand its own allowlist from a remote instruction. Widening what the
  house permits is a local, physical act.
- Never fail open. If policy cannot be read, nothing is permitted.

---

## 7. Unresolved

These are the reason this document is a draft. Each blocks a design decision,
not merely an implementation detail.

### 7.1 Ordering and causality

Signing and expiry make each command individually authentic, but a relay that
chooses *which* valid command to deliver, and when, still has influence.
"Unlock" and "lock" are both legitimate; delivering them in the wrong order is
an attack that no per-message signature detects.

Sequence numbers per device would fix ordering at the cost of making a dropped
message wedge the channel. Not yet decided.

### 7.2 Traffic analysis

Even with perfect confidentiality, the relay sees timing and volume. Commands
cluster around leaving and arriving home. Over weeks that is a presence
timetable held by the party the family trusts least, derived without breaking
anything.

Padding and cover traffic are the textbook answers and both cost battery and
bandwidth on a phone. **No answer yet**, and this is the item most likely to be
skipped quietly because it has no visible symptom.

### 7.3 Pairing

Every pairing mechanism trades security against a family's ability to actually
complete it. QR-in-person is strong and excludes anyone not physically present
— including the grandparent the feature is partly for. A code typed from the
board is weaker and workable. Undecided, and it should be decided with a
household, not at a desk.

### 7.4 Revocation latency

Revoking a device is only meaningful if it takes effect while the Bridge is
offline too. If revocation is a message from the relay, then a Bridge that
cannot reach the relay keeps honouring a revoked device — precisely when the
former household member (A4) is most likely to try.

### 7.5 What the review is for

The external review (Phase 4) should be asked specifically about §7.1 and §7.2,
not for a general audit. A general audit will find the things already listed
here; these are the two where the design might be wrong rather than incomplete.

---

## 8. Explicit non-goals

- **Not a VPN replacement.** A family already running Tailscale or WireGuard
  needs none of this and should be told so plainly.
- **Not remote access to the Kinboard UI.** The Bridge carries a narrow,
  allowlisted command set, not a tunnel.
- **Not protection against a compromised Home Assistant.** If HA is owned, the
  Bridge is downstream of the problem.
- **Not high availability.** A Bridge that is down means a feature does not
  work. That is the correct failure.

---

## 9. Exit criteria this model must satisfy

From the plan, restated as things that can be *tested* rather than asserted:

| Criterion | How it is demonstrated |
|---|---|
| No port forwarding needed | Bridge runs behind an unmodified consumer router; no rule added |
| Cloud never holds a general HA token | The token appears in no relay-bound payload; verified by inspecting what leaves the process |
| Tampered/replayed commands rejected | A recorded valid command, resent, is refused — as is one with a flipped bit |
| Five test households, four weeks | Stability, not security, and deliberately after the review |

---

## 10. The decision this document exists to inform

Nothing in Phase 4 should start until these are answered:

1. Is §7.2 (traffic analysis) acceptable as a *documented* limitation, or a
   blocker? It cannot be solved cheaply, and shipping while quiet about it
   would be the dishonest option.
2. Does the Bridge earn its place against simply recommending Tailscale? The
   honest comparison is: a VPN is more capable, less convenient, and already
   exists. The Bridge is only worth building if the convenience gap is real for
   people who will not run a VPN.
3. Who performs the external review, and is that budgeted? "Before any public
   use" is a real gate, and unbudgeted gates get moved.

**Recommendation: do not begin Bridge implementation on the strength of this
document.** It is the analysis the plan asked for, and its main finding is that
two of the design questions are genuinely open — which is a reason to answer
them, not to start writing a WebSocket client.
