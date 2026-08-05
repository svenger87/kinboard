import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { deleteSecrets, getStoredSecrets, upsertSecrets } from "@/lib/integration-secrets";
import { familyMatchesSession, requireSession } from "@/lib/require-session";

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
// Every verb requires a device session for the family named in the request.
// It used to require nothing at all: family_id is not a secret (it is in the
// client bundle and in localStorage), so "set" and "remove" were open to
// anyone who could reach the instance — a stranger could put a PIN on a
// family's settings page, or take an existing one off and walk in. The PIN is
// still the gate in front of the settings screen for people already inside the
// household; the session is what decides you are inside it.
//
// set/remove deliberately still take no proof of the *current* PIN. The
// settings page sits behind PinGuard, so a caller with a session that reached
// this route has either passed the PIN screen or there was no PIN to pass —
// and a household that has forgotten its own PIN should not be locked out of
// its own dashboard forever.

const PIN_KEY = "settings_pin";

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

  const stored = await getStoredSecrets(familyId, PIN_KEY);
  return NextResponse.json({ set: typeof stored?.pin === "string" && stored.pin.length > 0 });
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

    if (isRateLimited(familyId)) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }

    const stored = await getStoredSecrets(familyId, PIN_KEY);
    const storedPin = typeof stored?.pin === "string" ? stored.pin : null;
    const valid = !!storedPin && timingSafeStringEqual(pin, storedPin);

    if (!valid) {
      recordFailure(familyId);
      return NextResponse.json({ valid: false });
    }

    clearFailures(familyId);
    return NextResponse.json({ valid: true });
  }

  if (action === "set") {
    const pin = body?.pin;
    if (typeof pin !== "string" || !/^\d{4}$/.test(pin)) {
      return NextResponse.json({ error: "pin must be 4 digits" }, { status: 400 });
    }
    try {
      await upsertSecrets(familyId, PIN_KEY, { pin });
    } catch (err) {
      console.error("pin: failed to store PIN:", err);
      return NextResponse.json({ error: "Failed to save PIN" }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  }

  if (action === "remove") {
    try {
      await deleteSecrets(familyId, PIN_KEY);
    } catch (err) {
      console.error("pin: failed to remove PIN:", err);
      return NextResponse.json({ error: "Failed to remove PIN" }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ---- rate limiting ----------------------------------------------------
// Best-effort, in-memory, per-family: max 5 failed verify attempts per
// rolling minute. This is process-local state — it resets on deploy/restart
// and does NOT share state across replicas if the webapp is ever scaled
// horizontally (single container today, per docker-compose.yml). Good
// enough to slow down someone guessing a 4-digit PIN over the LAN; not a
// substitute for a real distributed rate limiter if that topology changes.
const MAX_FAILS_PER_WINDOW = 5;
const WINDOW_MS = 60_000;
const failuresByFamily = new Map<string, number[]>();

function isRateLimited(familyId: string): boolean {
  const now = Date.now();
  const fails = (failuresByFamily.get(familyId) ?? []).filter((t) => now - t < WINDOW_MS);
  failuresByFamily.set(familyId, fails);
  return fails.length >= MAX_FAILS_PER_WINDOW;
}

function recordFailure(familyId: string): void {
  const now = Date.now();
  const fails = (failuresByFamily.get(familyId) ?? []).filter((t) => now - t < WINDOW_MS);
  fails.push(now);
  failuresByFamily.set(familyId, fails);
}

function clearFailures(familyId: string): void {
  failuresByFamily.delete(familyId);
}
