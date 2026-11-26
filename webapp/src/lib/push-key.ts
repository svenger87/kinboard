import { createHash } from "node:crypto";

/**
 * Which VAPID key a push subscription belongs to (RFC-023 §6.4, §6.5).
 *
 * A browser's push subscription is bound to the server's VAPID public key it
 * was made with. When the server's key pair changes (a restore without the
 * config folder, a deleted or regenerated `vapid_*` file, other keys in
 * `.env`), every existing subscription stops working, and nothing says so:
 * the push service turns the sends away, the device simply gets nothing.
 *
 * So each subscription records the fingerprint of the key it was made with,
 * the install records the one it runs with (instance_settings
 * `push_vapid_key`), and a difference is visible: the entrypoint logs it and
 * retires the dead subscriptions (migrations/095_push_key_fingerprint.sql,
 * `kinboard.push_key_check`), Settings tells the family which devices need
 * push turned on again, and the subscribe route refuses to revive a
 * subscription made with the old key.
 *
 * The fingerprint is a SHA-256 of the public key's bytes. The public key is
 * public (every browser fetches it); nothing secret goes in.
 *
 * webapp-entrypoint.sh computes the same value in its own few lines of Node
 * (it cannot import this file); e2e/push-key.spec.ts runs both and compares.
 */

/** instance_settings key: the fingerprint of the VAPID public key the install last started with. */
export const PUSH_KEY_SETTING = "push_vapid_key";

/** Error code of a subscribe call for a subscription made with another key. */
export const KEY_CHANGED_ERROR = "vapid_key_changed";

/**
 * `sha256:<hex>` of the decoded public key, or null without a key. Accepts
 * base64url (what VAPID keys are) and standard base64, padded or not: both
 * decode to the same bytes, so a key copied with `=` at the end is the same
 * key.
 */
export function vapidKeyFingerprint(publicKey: string | null | undefined): string | null {
  const s = (publicKey ?? "").trim();
  if (!s) return null;
  const bytes = Buffer.from(s, "base64url");
  if (bytes.length === 0) return null;
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** The base64url text of a subscription's applicationServerKey, as a browser reports it. */
export function keyFromBytes(bytes: ArrayBuffer | Uint8Array): string {
  return Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64url");
}

/**
 * Whether a subscribe call may store or revive a subscription.
 *
 * - `current`: the fingerprint of the key the server runs with (null: push is
 *   not configured, nothing to compare);
 * - `stored`: what the row with this endpoint recorded (null: no row, or a row
 *   from before fingerprints were kept);
 * - `client`: the fingerprint of the applicationServerKey the browser says the
 *   subscription was made with (null: an older browser that doesn't say).
 *
 * The browser's word decides when it gives one: it knows which key it
 * subscribed with, and a push service may hand the same endpoint back after a
 * new subscription with the new key. Without it, the stored row decides. A
 * subscription of another key can never receive a push from this server
 * again: refused, the browser drops it, and the device turns push on again.
 */
export function subscribeKeyVerdict(current: string | null, stored: string | null, client: string | null): "ok" | "key_changed" {
  if (!current) return "ok";
  if (client) return client === current ? "ok" : "key_changed";
  if (stored && stored !== current) return "key_changed";
  return "ok";
}

export interface SubscriptionKeyRow {
  device_id: string;
  is_active: boolean | null;
  vapid_key_fingerprint: string | null;
  vapid_key_retired_at?: string | null;
}

/**
 * The devices that had push with an earlier key and do not have it with the
 * current one: the ones Settings asks to turn push on again. "Had push" is a
 * row of another key that is still active (a dump restored into a running
 * install, before its next start) or that a start switched off because the
 * key had changed (vapid_key_retired_at). A row that was already off (the
 * device turned push off itself) does not count, nor does a device that has
 * since subscribed with the current key. Rows without a fingerprint (made
 * before fingerprints were kept, not yet backfilled at a start) are not
 * judged.
 */
export function devicesNeedingPush(rows: SubscriptionKeyRow[], current: string | null): string[] {
  if (!current) return [];
  const stale = new Set<string>();
  const fine = new Set<string>();
  for (const r of rows) {
    if (!r.vapid_key_fingerprint) continue;
    if (r.vapid_key_fingerprint === current) {
      if (r.is_active) fine.add(r.device_id);
    } else if (r.is_active || r.vapid_key_retired_at) {
      stale.add(r.device_id);
    }
  }
  return [...stale].filter((d) => !fine.has(d)).sort();
}
