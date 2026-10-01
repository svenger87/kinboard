import crypto from "node:crypto";
import { getStoredSecrets, upsertSecrets } from "@/lib/integration-secrets";

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

async function loadStoredPin(familyId: string): Promise<string | null> {
  const stored = await getStoredSecrets(familyId, PIN_KEY);
  return typeof stored?.pin === "string" && stored.pin.length > 0 ? stored.pin : null;
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
