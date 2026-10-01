import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { upsertSecrets } from "@/lib/integration-secrets";
import { createAdminClient } from "@/lib/supabase/server";
import type { SessionContext } from "@/lib/session";

/**
 * The settings PIN check, shared by /api/pin and the assistant consent page
 * (RFC-010 §3.5) so both use one rate limit — two limits would double the
 * guesses an attacker gets.
 */
export const PIN_KEY = "settings_pin";
export type PinLoader = (familyId: string) => Promise<string | null>;

/** Four digits, nothing else — the shape a settings PIN must have to be stored. */
export const PIN_FORMAT = /^\d{4}$/;

const MAX_FAILS_PER_WINDOW = 5;
const WINDOW_MS = 60_000;
// A second, wider limit: 5/minute alone lets a slow script that paces itself
// just under it run indefinitely. 20/hour caps the total guesses regardless
// of pacing, without affecting a person who fat-fingers a PIN a few times.
const MAX_FAILS_PER_HOUR = 20;
const HOUR_MS = 60 * 60_000;
const failuresByFamily = new Map<string, number[]>();

/**
 * Reads the stored PIN, and throws when it cannot. `getStoredSecrets` turns a
 * failed query into "no row", which here would read as "this family has no
 * PIN" — and with the PIN now a server-side boundary (requireSettingsUnlock),
 * "no PIN" means "unlocked". A database hiccup must fail closed instead.
 */
async function loadStoredPin(familyId: string): Promise<string | null> {
  const { data, error } = await (createAdminClient() as any)
    .from("integration_secrets")
    .select("value")
    .eq("family_id", familyId)
    .eq("key", PIN_KEY)
    .maybeSingle();
  if (error) throw new Error(`Failed to read the settings PIN: ${error.message}`);
  const pin = (data?.value as { pin?: unknown } | undefined)?.pin;
  return typeof pin === "string" && pin.length > 0 ? pin : null;
}

/** Prunes to the hour window — a superset of the minute window — and stores the result back. */
function recentFailures(familyId: string, now: number): number[] {
  const fails = (failuresByFamily.get(familyId) ?? []).filter((t) => now - t < HOUR_MS);
  failuresByFamily.set(familyId, fails);
  return fails;
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export async function familyHasPin(familyId: string, load: PinLoader = loadStoredPin): Promise<boolean> {
  return (await load(familyId)) !== null;
}

/**
 * The attempt is reserved BEFORE the async lookup, not after. Everything up
 * to that reservation runs synchronously (JS does not yield until the first
 * `await`), so N callers racing on the same family — concurrent requests,
 * not a sequence — each see exactly the reservations made by the callers
 * ahead of them in that synchronous run, not a stale "4 of 5 used" read that
 * lets all N through. `now` is injectable so the hourly limit can be tested
 * without a real hour of wall-clock time.
 */
export async function verifySettingsPin(
  familyId: string,
  pin: string,
  load: PinLoader = loadStoredPin,
  now: () => number = Date.now,
): Promise<"valid" | "invalid" | "rate_limited"> {
  const nowMs = now();
  const fails = recentFailures(familyId, nowMs);
  const withinMinute = fails.filter((t) => nowMs - t < WINDOW_MS).length;
  if (withinMinute >= MAX_FAILS_PER_WINDOW || fails.length >= MAX_FAILS_PER_HOUR) return "rate_limited";

  fails.push(nowMs);
  failuresByFamily.set(familyId, fails);

  const stored = await load(familyId);
  if (stored && timingSafeStringEqual(pin, stored)) {
    // Clears the reservation just pushed along with every earlier one.
    failuresByFamily.delete(familyId);
    return "valid";
  }
  return "invalid";
}

/**
 * Store a new settings PIN. Throws on an invalid format or a storage error.
 *
 * Used by /api/pin's "set" action and by the assistant consent page (Task 7),
 * which lets a family set its first PIN inline when approving an assistant —
 * the controller ruling made the PIN mandatory for that approval, so the
 * consent flow needs the same validate-then-store step the settings page uses.
 */
export async function setSettingsPin(
  familyId: string,
  pin: string,
  store: (familyId: string, pin: string) => Promise<void> = (fid, p) => upsertSecrets(fid, PIN_KEY, { pin: p }),
): Promise<void> {
  if (!PIN_FORMAT.test(pin)) throw new Error("pin must be 4 digits");
  await store(familyId, pin);
}

/**
 * Store a first PIN only if the family still has none — atomically.
 *
 * The consent page sets a PIN inline when a family has none. Checking
 * `familyHasPin` and then calling `setSettingsPin` leaves a gap: a PIN set
 * from Settings (or a second consent tab) in between would be silently
 * overwritten by whoever came second, and that second caller never proved
 * they knew the first one. So this is a single conditional write instead.
 *
 * Not through `upsertSecrets`: it reads, merges and upserts, which is exactly
 * the read-then-write gap this exists to close. It goes straight to
 * `integration_secrets`, whose primary key is (family_id, key):
 *
 *   1. INSERT ... ON CONFLICT DO NOTHING (`ignoreDuplicates`) — wins only if
 *      no row exists. Postgres decides, not this process.
 *   2. If a row did exist, it may still hold no usable PIN (an empty object
 *      left by an older migration); `loadStoredPin` treats that as "no PIN",
 *      so it is claimed with an UPDATE guarded on the pin being absent or
 *      empty — again one statement, so two callers cannot both win.
 *
 * Returns false when a real PIN was already there: the caller must not
 * proceed as if theirs had been stored.
 */
export type PinInsertIfAbsent = (familyId: string, pin: string) => Promise<boolean>;

async function insertPinIfAbsent(familyId: string, pin: string): Promise<boolean> {
  const db = createAdminClient() as any;
  const value = { pin };
  const updatedAt = new Date().toISOString();
  const { data: inserted, error: insertError } = await db
    .from("integration_secrets")
    .upsert({ family_id: familyId, key: PIN_KEY, value, updated_at: updatedAt }, { onConflict: "family_id,key", ignoreDuplicates: true })
    .select("family_id");
  if (insertError) throw new Error(`Failed to store PIN: ${insertError.message}`);
  if ((inserted ?? []).length === 1) return true;

  const { data: claimed, error: claimError } = await db
    .from("integration_secrets")
    .update({ value, updated_at: updatedAt })
    .eq("family_id", familyId)
    .eq("key", PIN_KEY)
    .or("value->>pin.is.null,value->>pin.eq.")
    .select("family_id");
  if (claimError) throw new Error(`Failed to store PIN: ${claimError.message}`);
  return (claimed ?? []).length === 1;
}

export async function setSettingsPinIfAbsent(
  familyId: string,
  pin: string,
  store: PinInsertIfAbsent = insertPinIfAbsent,
): Promise<boolean> {
  if (!PIN_FORMAT.test(pin)) throw new Error("pin must be 4 digits");
  return store(familyId, pin);
}

/**
 * The server-side settings unlock (RFC-010 §3.5).
 *
 * PinGuard asks for the PIN before it renders Settings, but that is the
 * browser deciding — a device with a session could skip the screen and call
 * the routes behind it directly. So a correct PIN entry also records, on the
 * device session that entered it, that this device may change protected
 * settings for the next fifteen minutes; the routes that matter check that
 * record, not the browser's word.
 *
 * Fifteen minutes is a little longer than PinGuard's own ten-minute idle
 * window, so someone working through Settings is re-prompted by the screen
 * before the server would refuse them — a 403 is the fallback, not the flow.
 */
export const SETTINGS_UNLOCK_TTL_S = 15 * 60;

export async function unlockSettings(sessionId: string, now: Date = new Date()): Promise<void> {
  const until = new Date(now.getTime() + SETTINGS_UNLOCK_TTL_S * 1000).toISOString();
  const { error } = await createAdminClient()
    .from("device_sessions")
    .update({ settings_unlocked_until: until })
    .eq("id", sessionId);
  if (error) throw new Error(`Failed to record the settings unlock: ${error.message}`);
}

/**
 * Ends the settings unlock of every device in the family, or of every device
 * but `exceptSessionId`.
 *
 * An unlock is proof that a device knew the PIN — the PIN as it was then.
 * When the PIN changes, a device that only knew the old one must not keep a
 * fifteen-minute window to mint tokens or switch assistants on with it; when
 * it is removed, every window ends so a PIN set later starts every device
 * from locked. The device that made the change is the one exception on a
 * change: choosing the new PIN proves it knows it.
 *
 * `db` is injectable so the query shape can be tested without a database.
 */
export async function clearSettingsUnlockForFamily(
  familyId: string,
  exceptSessionId?: string,
  db: any = createAdminClient(),
): Promise<void> {
  let query = db
    .from("device_sessions")
    .update({ settings_unlocked_until: null })
    .eq("family_id", familyId);
  if (exceptSessionId) query = query.neq("id", exceptSessionId);
  const { error } = await query;
  if (error) throw new Error(`Failed to clear the settings unlock: ${error.message}`);
}

/**
 * What follows a stored PIN — RFC-010 §3.5. The device that chose it is
 * unlocked first (choosing the PIN proves knowing it), then every other
 * device's unlock, earned with the old PIN, is ended.
 *
 * The PIN has already changed when this runs, so nothing here may turn the
 * request into an error: a "Failed to save PIN" after the PIN was saved
 * would leave the household guessing which PIN is in force. A failure is
 * logged; at worst this device asks for the new PIN once more, or another
 * device keeps its old window until it runs out (SETTINGS_UNLOCK_TTL_S).
 */
export async function settleAfterPinSet(
  familyId: string,
  sessionId: string,
  deps: {
    unlock: (sessionId: string) => Promise<void>;
    clearOthers: (familyId: string, exceptSessionId: string) => Promise<void>;
    log?: (message: string, err: unknown) => void;
  } = { unlock: (id) => unlockSettings(id), clearOthers: (f, id) => clearSettingsUnlockForFamily(f, id) },
): Promise<void> {
  const log = deps.log ?? ((message, err) => console.error(message, err));
  try {
    await deps.unlock(sessionId);
  } catch (err) {
    log("pin: the PIN was saved, but this device's unlock could not be recorded:", err);
  }
  try {
    await deps.clearOthers(familyId, sessionId);
  } catch (err) {
    log("pin: the PIN was saved, but other devices' unlocks could not be cleared:", err);
  }
}

/** Pure: may this session change protected settings right now? */
export function settingsUnlocked(session: SessionContext, pinSet: boolean, now: Date): boolean {
  if (!pinSet) return true;
  if (!session.settingsUnlockedUntil) return false;
  const until = new Date(session.settingsUnlockedUntil).getTime();
  return Number.isFinite(until) && until > now.getTime();
}

/**
 * For a route: null when the action may proceed, else the 403 to return.
 * `pin_required` is what the settings UI listens for to put the PIN screen
 * back up.
 */
export async function requireSettingsUnlock(
  session: SessionContext,
  hasPin: (familyId: string) => Promise<boolean> = (familyId) => familyHasPin(familyId),
  now: Date = new Date(),
): Promise<NextResponse | null> {
  if (settingsUnlocked(session, await hasPin(session.familyId), now)) return null;
  return NextResponse.json({ error: "pin_required" }, { status: 403 });
}
