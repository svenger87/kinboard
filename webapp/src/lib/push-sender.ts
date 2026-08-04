import webpush from "web-push";

// Push subscription type (matches what the browser returns)
export interface PushSubscriptionJSON {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

// Notification payload type
export interface NotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  url?: string;
  actions?: Array<{
    action: string;
    title: string;
    icon?: string;
  }>;
}

// Database subscription type (from Supabase)
export interface DatabaseSubscription {
  id: string;
  device_id: string;
  family_id: string;
  endpoint: string;
  p256dh_key: string;
  auth_key: string;
  is_active: boolean;
}

/**
 * Why a send failed, as far as the subscription's fate is concerned.
 *
 * The old code collapsed this to a boolean and deactivated on *any* 4xx.
 * That reads backwards: a 400 or a 401 from a push service is almost always
 * a complaint about our request — a mistyped VAPID key, a bad payload — not
 * news that the device is gone. And because every subscription is sent with
 * the same keys, one such mistake deactivated *every device in the family*
 * in a single batch, silently, with no way back except re-enabling
 * notifications by hand on each device.
 *
 * - "gone"    the push service says this subscription is dead. 404 and 410
 *             are the codes the spec gives for that; they are the only ones
 *             we trust on their own.
 * - "suspect" a 4xx that might be the subscription or might be us. Acted on
 *             only if the rest of the batch went through — see
 *             sendPushToMultiple.
 * - false     transient or ours. Never deactivates.
 */
export type DeactivateVerdict = "gone" | "suspect" | false;

/**
 * Read VAPID keys lazily from runtime environment.
 * IMPORTANT: We avoid reading NEXT_PUBLIC_* at module level because Next.js
 * inlines those at build time (replacing with empty string if not set during build).
 * Reading at call time ensures we get the actual runtime env var.
 */
function getVapidConfig() {
  // Try VAPID_PUBLIC_KEY first (server-only), fall back to NEXT_PUBLIC_ variant
  const publicKey = process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
  return { publicKey, privateKey, subject };
}

let vapidConfigured = false;

/**
 * Ensure VAPID is configured for web-push (idempotent)
 */
function ensureVapidConfigured(): boolean {
  if (vapidConfigured) return true;

  const { publicKey, privateKey, subject } = getVapidConfig();
  if (publicKey && privateKey) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidConfigured = true;
    console.log("[Push] VAPID configured successfully");
    return true;
  }

  return false;
}

/**
 * Convert a database subscription to the format web-push expects
 */
function toWebPushSubscription(sub: DatabaseSubscription): PushSubscriptionJSON {
  return {
    endpoint: sub.endpoint,
    keys: {
      p256dh: sub.p256dh_key,
      auth: sub.auth_key,
    },
  };
}

/**
 * Send a push notification to a single subscription
 * @returns true if successful, false if subscription should be marked inactive
 */
export async function sendPushNotification(
  subscription: DatabaseSubscription,
  payload: NotificationPayload
): Promise<{ success: boolean; shouldDeactivate: DeactivateVerdict; error?: string }> {
  if (!ensureVapidConfigured()) {
    console.error("[Push] VAPID keys not configured");
    return { success: false, shouldDeactivate: false, error: "VAPID keys not configured" };
  }

  try {
    const webPushSub = toWebPushSubscription(subscription);

    await webpush.sendNotification(
      webPushSub,
      JSON.stringify(payload),
      {
        TTL: 60 * 60, // 1 hour
        urgency: "normal",
      }
    );

    console.log(`[Push] Notification sent to device ${subscription.device_id}`);
    return { success: true, shouldDeactivate: false };
  } catch (error) {
    const err = error as { statusCode?: number; message?: string; body?: string };
    console.error(`[Push] Failed to send to device ${subscription.device_id}: status=${err.statusCode}, message=${err.message}`);

    // Handle specific error codes
    if (err.statusCode === 404 || err.statusCode === 410) {
      // Subscription no longer valid - should be removed
      console.log(`[Push] Subscription ${subscription.id} is no longer valid (${err.statusCode})`);
      return { success: false, shouldDeactivate: "gone", error: `Subscription expired (${err.statusCode})` };
    }

    if (err.statusCode === 401 || err.statusCode === 403) {
      // Not the subscription's fault: VAPID authenticates *us* to the push
      // service, so this means our keys are wrong or expired. Deactivating
      // here would wipe every device the moment a key was rotated badly.
      console.error(
        `[Push] Auth rejected (${err.statusCode}) for subscription ${subscription.id} — check the VAPID keys. Keeping the subscription.`,
      );
      return { success: false, shouldDeactivate: false, error: `Auth failed (${err.statusCode}) — check VAPID keys` };
    }

    if (err.statusCode === 413) {
      // Payload too large
      return { success: false, shouldDeactivate: false, error: "Payload too large" };
    }

    if (err.statusCode === 429) {
      // Too many requests - don't deactivate, just retry later
      return { success: false, shouldDeactivate: false, error: "Rate limited" };
    }

    // Other 4xx: could be this subscription, could be a malformed request
    // from us. Flag it and let the batch decide.
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      console.log(`[Push] Subscription ${subscription.id} got client error (${err.statusCode})`);
      return { success: false, shouldDeactivate: "suspect", error: `Client error (${err.statusCode})` };
    }

    return { success: false, shouldDeactivate: false, error: err.message || "Unknown error" };
  }
}

/**
 * Send a push notification to multiple subscriptions
 * Returns stats about how many succeeded/failed
 */
export async function sendPushToMultiple(
  subscriptions: DatabaseSubscription[],
  payload: NotificationPayload
): Promise<{
  sent: number;
  failed: number;
  deactivated: string[];
}> {
  const results = await Promise.all(
    subscriptions.map((sub) => sendPushNotification(sub, payload).then((result) => ({ sub, result })))
  );

  const deactivated: string[] = [];
  const suspect: string[] = [];
  let sent = 0;
  let failed = 0;

  for (const { sub, result } of results) {
    if (result.success) {
      sent++;
    } else {
      failed++;
      if (result.shouldDeactivate === "gone") deactivated.push(sub.id);
      else if (result.shouldDeactivate === "suspect") suspect.push(sub.id);
    }
  }

  // A 4xx that hits every device at once is us, not them — a bad payload or
  // bad credentials. Acting on it would unsubscribe the whole family over a
  // single bad deploy. Only trust an ambiguous 4xx when other devices in the
  // same batch were fine.
  if (suspect.length > 0) {
    if (sent > 0) {
      deactivated.push(...suspect);
    } else {
      console.error(
        `[Push] ${suspect.length} subscription(s) failed with a client error and none succeeded — treating this as a problem on our side and keeping them.`,
      );
    }
  }

  return { sent, failed, deactivated };
}

/**
 * Check if VAPID keys are configured
 */
export function isVapidConfigured(): boolean {
  const { publicKey, privateKey } = getVapidConfig();
  return !!(publicKey && privateKey);
}

/**
 * Get the public VAPID key (for client-side subscription)
 */
export function getPublicVapidKey(): string | null {
  const { publicKey } = getVapidConfig();
  return publicKey || null;
}
