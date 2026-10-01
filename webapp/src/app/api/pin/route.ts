import { NextRequest, NextResponse } from "next/server";
import { deleteSecrets } from "@/lib/integration-secrets";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import {
  PIN_FORMAT,
  PIN_KEY,
  clearSettingsUnlockForFamily,
  familyHasPin,
  requireSettingsUnlock,
  setSettingsPin,
  setSettingsPinIfAbsent,
  settleAfterPinSet,
  unlockSettings,
  verifySettingsPin,
} from "@/lib/settings-pin";

// Server-side settings-PIN check (Milestone C Task 11). Previously the PIN
// lived in the anon-readable `settings` table and was compared in the
// browser (pin-guard.tsx) — any device on the network could read it via
// PostgREST. Now it's stored in `integration_secrets` (key "settings_pin",
// value { pin: "1234" }), and verification happens here.
//
// GET  ?family_id                              → { set: boolean }
// POST { family_id, action: "verify", pin }     → { valid: boolean }
// POST { family_id, action: "set", pin }        → { success: true }
// POST { family_id, action: "remove" }          → { success: true }
//
// The verify/rate-limit logic lives in @/lib/settings-pin, shared with the
// assistant consent page (RFC-010 §3.5) so both sit behind one rate limit.
//
// Every verb requires a device session for the family named in the request.
// It used to require nothing at all: family_id is not a secret (it is in the
// client bundle and in localStorage), so "set" and "remove" were open to
// anyone who could reach the instance — a stranger could put a PIN on a
// family's settings page, or take an existing one off and walk in. The PIN is
// still the gate in front of the settings screen for people already inside the
// household; the session is what decides you are inside it.
//
// set/remove also need proof of the *current* PIN when one exists: the
// server-side settings unlock that a correct "verify" records on this device
// session (lib/settings-pin.ts, RFC-010 §3.5). They used to rely on PinGuard
// having asked first — but PinGuard is the browser's opinion, and a device
// with a session could POST "remove" without ever seeing the PIN screen, set
// its own PIN, and approve an assistant with it. A household that has
// forgotten its PIN resets it from the database (wiki: AI-Assistants,
// "Forgot the PIN?"), not through a route anyone with a session can call.

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const familyId = request.nextUrl.searchParams.get("family_id");
  if (!familyId) {
    return NextResponse.json({ error: "family_id is required" }, { status: 400 });
  }

  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  try {
    return NextResponse.json({ set: await familyHasPin(familyId) });
  } catch (err) {
    // PinGuard shows "unavailable" on an error and does not open Settings.
    // Answering { set: false } here instead would open it.
    console.error("pin: failed to read PIN status:", err);
    return NextResponse.json({ error: "Failed to read PIN status" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const familyId = body?.family_id;
  const action = body?.action;

  if (!familyId || typeof familyId !== "string") {
    return NextResponse.json({ error: "family_id is required" }, { status: 400 });
  }

  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  if (action === "verify") {
    const pin = body?.pin;
    if (typeof pin !== "string") {
      return NextResponse.json({ error: "pin is required" }, { status: 400 });
    }

    let result: Awaited<ReturnType<typeof verifySettingsPin>>;
    try {
      result = await verifySettingsPin(familyId, pin);
      if (result === "valid") await unlockSettings(auth.session.sessionId);
    } catch (err) {
      console.error("pin: verify failed:", err);
      return NextResponse.json({ error: "Failed to verify PIN" }, { status: 500 });
    }
    if (result === "rate_limited") return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    return NextResponse.json({ valid: result === "valid" });
  }

  if (action === "set") {
    const pin = body?.pin;
    if (typeof pin !== "string" || !PIN_FORMAT.test(pin)) {
      return NextResponse.json({ error: "pin must be 4 digits" }, { status: 400 });
    }
    try {
      if (await familyHasPin(familyId)) {
        // Changing an existing PIN: only from a device that entered it.
        const locked = await requireSettingsUnlock(auth.session);
        if (locked) return locked;
        await setSettingsPin(familyId, pin);
      } else if (!(await setSettingsPinIfAbsent(familyId, pin))) {
        // The first PIN is open to any session in the family — there is
        // nothing to prove yet. But "first" is decided atomically: if one
        // appeared since the check above, this caller never knew it, and
        // is treated exactly like someone changing an existing PIN while
        // locked.
        return NextResponse.json({ error: "pin_required" }, { status: 403 });
      }
    } catch (err) {
      console.error("pin: failed to store PIN:", err);
      return NextResponse.json({ error: "Failed to save PIN" }, { status: 500 });
    }
    // The PIN is saved. Unlock this device (choosing the PIN proves knowing
    // it), then end every other device's unlock, earned with the old PIN or
    // left over from before there was one. Neither may fail the request now:
    // settleAfterPinSet logs and carries on.
    await settleAfterPinSet(familyId, auth.session.sessionId);
    return NextResponse.json({ success: true });
  }

  if (action === "remove") {
    try {
      const locked = await requireSettingsUnlock(auth.session);
      if (locked) return locked;
      await deleteSecrets(familyId, PIN_KEY);
      // Without a PIN everything is open anyway; clearing every device's
      // unlock (this one included) means a PIN set later starts them all
      // from locked, not from a leftover window.
      await clearSettingsUnlockForFamily(familyId);
    } catch (err) {
      console.error("pin: failed to remove PIN:", err);
      return NextResponse.json({ error: "Failed to remove PIN" }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
