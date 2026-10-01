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
const failuresByFamily = new Map<string, number[]>();

async function loadStoredPin(familyId: string): Promise<string | null> {
  const stored = await getStoredSecrets(familyId, PIN_KEY);
  return typeof stored?.pin === "string" && stored.pin.length > 0 ? stored.pin : null;
}

function recent(familyId: string, now: number): number[] {
  const fails = (failuresByFamily.get(familyId) ?? []).filter((t) => now - t < WINDOW_MS);
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

export async function verifySettingsPin(
  familyId: string,
  pin: string,
  load: PinLoader = loadStoredPin,
): Promise<"valid" | "invalid" | "rate_limited"> {
  const now = Date.now();
  if (recent(familyId, now).length >= MAX_FAILS_PER_WINDOW) return "rate_limited";
  const stored = await load(familyId);
  if (stored && timingSafeStringEqual(pin, stored)) {
    failuresByFamily.delete(familyId);
    return "valid";
  }
  recent(familyId, now).push(now);
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
