import { readInstanceKey } from "@/lib/instance-settings";
import {
  DEFAULT_VAPID_SUBJECT,
  INSTANCE_SITE_URL_KEY,
  INSTANCE_VAPID_SUBJECT_KEY,
  resolveInstanceValue,
} from "@/lib/first-run";

/**
 * The two install settings the first-run sequence writes (RFC-024 §8), as
 * the server uses them: SITE_URL and VAPID_SUBJECT when the environment sets
 * them, else what the operator saved in instance_settings.
 *
 * Read on every calendar-link request and push, so the stored value is kept
 * for a short while; a save in this process drops it at once.
 */

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; value: string | null }>();

async function stored(key: string): Promise<string | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value: string | null = null;
  try {
    value = await readInstanceKey(key);
  } catch (err) {
    // A database that cannot be read must not stop a push or a feed link:
    // the behaviour before this setting existed applies.
    console.error(`instance-config: could not read ${key}:`, err);
    return hit?.value ?? null;
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function forgetInstanceConfig(): void {
  cache.clear();
}

/** The public address for links the app hands out, or null to use the request's own origin. */
export async function instanceSiteUrl(): Promise<string | null> {
  const env = process.env.SITE_URL;
  if (env?.trim()) return env.trim().replace(/\/+$/, "");
  const { value } = resolveInstanceValue(undefined, await stored(INSTANCE_SITE_URL_KEY));
  return value ? value.replace(/\/+$/, "") : null;
}

/** The contact push services see; never empty. */
export async function instanceVapidSubject(): Promise<string> {
  const env = process.env.VAPID_SUBJECT;
  if (env?.trim()) return env.trim();
  return (await stored(INSTANCE_VAPID_SUBJECT_KEY)) || DEFAULT_VAPID_SUBJECT;
}
