import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/db/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { deleteSecrets, upsertSecrets } from "@/lib/integration-secrets";
import {
  API_KEY_FIELDS,
  API_KEY_NAMES,
  pickCredential,
  statusOf,
  type ApiKeyName,
  type ApiKeySource,
  type ApiKeysStatus,
} from "@/lib/api-key-status";

/**
 * The resolver for the three install keys (RFC-023 §4.4): the family's own
 * value from Settings first, then the server's environment, exactly as every
 * route read it before. Server only — the values are stored in
 * `integration_secrets`, which only the service role can read
 * (migrations/020_integration_secrets.sql), and nothing here returns one to a
 * browser except a freshly generated presence token, once, to the device that
 * asked for it behind the settings PIN.
 *
 * Every route that read OPENWEATHERMAP_API_KEY, GOOGLE_CLIENT_ID and
 * GOOGLE_CLIENT_SECRET or PRESENCE_SENSOR_TOKEN from the environment asks here
 * instead; e2e/api-keys.spec.ts fails if one reads the environment again.
 */

/** Reads one family's stored value for a key; null when there is none. Throws when the read fails. */
export type KeyLoader = (familyId: string, name: ApiKeyName) => Promise<Record<string, unknown> | null>;

export const loadFamilyKey: KeyLoader = async (familyId, name) => {
  const { data, error } = await (createAdminClient() as any)
    .from("integration_secrets")
    .select("value")
    .eq("family_id", familyId)
    .eq("key", name)
    .maybeSingle();
  if (error) throw new Error(`Failed to read ${name}: ${error.message}`);
  const value = data?.value;
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
};

interface ResolveDeps {
  load?: KeyLoader;
  env?: Record<string, string | undefined>;
}

/**
 * The values in force for one family. `familyId` null (no session) is the
 * environment alone, which is what every caller got before.
 *
 * A failed read falls back to the environment for weather and Google, and is
 * logged: the environment is the install's own default, so using it hands
 * nothing to anyone who didn't have it. The presence sensor does not use this
 * path; see presenceSensorToken.
 */
async function resolve(
  name: ApiKeyName,
  familyId: string | null,
  { load = loadFamilyKey, env = process.env }: ResolveDeps = {},
): Promise<{ source: ApiKeySource; values: string[] | null }> {
  let stored: Record<string, unknown> | null = null;
  if (familyId) {
    try {
      stored = await load(familyId, name);
    } catch (err) {
      console.error(`api-keys: could not read the family's ${name}, using the server's:`, err);
    }
  }
  return pickCredential(name, stored, env);
}

/** The OpenWeatherMap key for a family, or for nobody (environment only). */
export async function resolveOpenWeatherKey(familyId: string | null, deps?: ResolveDeps): Promise<string | undefined> {
  return (await resolve("openweathermap", familyId, deps)).values?.[0];
}

/**
 * The OpenWeatherMap key for whoever sent this request.
 *
 * The weather routes answer without a session, as they always have, and then
 * get the server's key; with one, they get the family's. The family comes
 * only from the session cookie, never from the request's parameters, so no
 * one can spend another family's key by naming it.
 */
export async function openWeatherKeyForRequest(request: NextRequest, deps?: ResolveDeps): Promise<string | undefined> {
  let familyId: string | null = null;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      familyId = (await verifySession(token))?.familyId ?? null;
    } catch {
      familyId = null;
    }
  }
  return resolveOpenWeatherKey(familyId, deps);
}

export interface GoogleClient {
  clientId: string;
  clientSecret: string;
  source: Exclude<ApiKeySource, "none">;
}

/** The Google OAuth client a family's Connect, callback and syncs use; null when neither it nor the server has one. */
export async function resolveGoogleClient(familyId: string, deps?: ResolveDeps): Promise<GoogleClient | null> {
  const { source, values } = await resolve("google_oauth_client", familyId, deps);
  if (source === "none" || !values) return null;
  return { clientId: values[0], clientSecret: values[1], source };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Which family a device belongs to; null when there is no such device. Throws when the read fails. */
export type DeviceFamilyLoader = (deviceId: string) => Promise<string | null>;

const loadDeviceFamily: DeviceFamilyLoader = async (deviceId) => {
  const { data, error } = await (createAdminClient() as any)
    .from("devices")
    .select("family_id")
    .eq("id", deviceId)
    .maybeSingle();
  if (error) throw new Error(`Failed to look up the device: ${error.message}`);
  return (data?.family_id as string | undefined) ?? null;
};

/**
 * The token a presence report for this device must carry.
 *
 * The sensor sends no family, only its device id, so the family is the
 * device's: its own token when it has set one, else the server's
 * `PRESENCE_SENSOR_TOKEN`. That also makes "New token" in Settings mean
 * something: once a family has its own, the server's no longer moves its
 * screens. A device id that isn't a device (or isn't an id) gets the server's
 * token, as every report did before.
 *
 * Unlike weather and Google, a failed read throws rather than falling back:
 * the family may have replaced the server's token precisely so that it stops
 * working, and a database hiccup must not bring it back.
 *
 * The sensor reports about once a second, and before any family could have a
 * token the route touched no database at all. So whether any family has one
 * is asked at most every PRESENCE_TOKENS_TTL_MS and remembered; while none
 * has, a report is checked against the server's token alone, with no lookup,
 * as before — an install that only uses `.env` keeps working through a
 * database hiccup, and an unauthenticated caller can't make it query.
 * Storing or removing a family's token here forgets the answer at once.
 */
export async function presenceSensorToken(
  deviceId: unknown,
  {
    load = loadFamilyKey,
    deviceFamily = loadDeviceFamily,
    anyFamilyToken = anyFamilyPresenceToken,
    env = process.env,
  }: ResolveDeps & { deviceFamily?: DeviceFamilyLoader; anyFamilyToken?: () => Promise<boolean> } = {},
): Promise<string | null> {
  let stored: Record<string, unknown> | null = null;
  if (typeof deviceId === "string" && UUID.test(deviceId) && (await anyFamilyToken())) {
    const familyId = await deviceFamily(deviceId);
    if (familyId) stored = await load(familyId, "presence_sensor");
  }
  return pickCredential("presence_sensor", stored, env).values?.[0] ?? null;
}

export const PRESENCE_TOKENS_TTL_MS = 30_000;
let familyTokensKnown: { any: boolean; at: number } | null = null;

/** Whether any family has a presence token of its own. Throws when the read fails and nothing is remembered. */
async function anyFamilyPresenceToken(now: number = Date.now()): Promise<boolean> {
  if (familyTokensKnown && now - familyTokensKnown.at < PRESENCE_TOKENS_TTL_MS) return familyTokensKnown.any;
  const { data, error } = await (createAdminClient() as any)
    .from("integration_secrets")
    .select("family_id")
    .eq("key", "presence_sensor")
    .limit(1);
  if (error) throw new Error(`Failed to look up presence tokens: ${error.message}`);
  familyTokensKnown = { any: (data ?? []).length > 0, at: now };
  return familyTokensKnown.any;
}

/** Forget whether any family has a presence token: after storing or removing one, and in tests. */
export function forgetPresenceTokens(): void {
  familyTokensKnown = null;
}

/**
 * Compares a presented token with the expected one in constant time, whatever
 * their lengths: both are hashed first, so the comparison is always of 32
 * bytes and the time taken says nothing about the length either.
 */
export function tokensMatch(supplied: string, expected: string): boolean {
  const a = createHash("sha256").update(supplied).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** A new presence token: 32 random bytes, hex, as setup.sh and the init step make them. */
export function generatePresenceToken(): string {
  return randomBytes(32).toString("hex");
}

/** Every key's status for the Settings screens: where it comes from and a masked hint, never a value. */
export async function apiKeysStatus(
  familyId: string,
  { load = loadFamilyKey, env = process.env }: ResolveDeps = {},
): Promise<ApiKeysStatus> {
  const entries = await Promise.all(
    API_KEY_NAMES.map(async (name) => [name, statusOf(name, await load(familyId, name), env)] as const),
  );
  return Object.fromEntries(entries) as ApiKeysStatus;
}

/** Stores a family's own value for a key, every field at once. */
export async function setFamilyKey(familyId: string, name: ApiKeyName, values: string[]): Promise<void> {
  const fields = API_KEY_FIELDS[name];
  if (values.length !== fields.length) throw new Error(`${name} takes ${fields.length} values`);
  try {
    await upsertSecrets(familyId, name, Object.fromEntries(fields.map((f, i) => [f, values[i]])));
  } finally {
    if (name === "presence_sensor") forgetPresenceTokens();
  }
}

/** Removes a family's own value; the server's environment applies again. */
export async function clearFamilyKey(familyId: string, name: ApiKeyName): Promise<void> {
  try {
    await deleteSecrets(familyId, name);
  } finally {
    if (name === "presence_sensor") forgetPresenceTokens();
  }
}
