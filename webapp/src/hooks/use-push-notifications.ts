import { useState, useEffect, useCallback, useRef } from "react";
import { useFamilyStore } from "@/stores/family-store";

export interface PushNotificationState {
  isSupported: boolean;
  permission: NotificationPermission | "not-supported";
  isSubscribed: boolean;
  isLoading: boolean;
  error: string | null;
}

export interface UsePushNotificationsReturn extends PushNotificationState {
  subscribe: () => Promise<boolean>;
  unsubscribe: () => Promise<boolean>;
  requestPermission: () => Promise<NotificationPermission | "not-supported">;
}

/**
 * Check if push notifications are supported in this browser/context
 */
function checkPushSupport(): boolean {
  if (typeof window === "undefined") return false;
  if (!("serviceWorker" in navigator)) return false;
  if (!("PushManager" in window)) return false;
  if (!("Notification" in window)) return false;
  return true;
}

/**
 * Convert a base64 string to Uint8Array for VAPID key
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Check if this device has an active push subscription on the server
 */
async function checkServerSubscription(deviceId: string, familyId: string): Promise<boolean> {
  try {
    const response = await fetch(
      `/api/notifications/subscription-status?deviceId=${encodeURIComponent(deviceId)}&familyId=${encodeURIComponent(familyId)}`
    );
    if (!response.ok) return false;
    const data = await response.json();
    return data.isActive === true;
  } catch {
    return false;
  }
}

/**
 * Hook for managing push notification subscriptions
 */
export function usePushNotifications(): UsePushNotificationsReturn {
  const { family, device } = useFamilyStore();
  const [state, setState] = useState<PushNotificationState>({
    isSupported: false,
    permission: "not-supported",
    isSubscribed: false,
    isLoading: true,
    error: null,
  });

  // Cache the VAPID key
  const vapidKeyRef = useRef<string | null>(null);

  // Track whether we've already attempted auto-recovery
  const hasAttemptedRecoveryRef = useRef(false);

  // Check initial state on mount
  useEffect(() => {
    async function checkState() {
      const isSupported = checkPushSupport();

      if (!isSupported) {
        setState({
          isSupported: false,
          permission: "not-supported",
          isSubscribed: false,
          isLoading: false,
          error: null,
        });
        return;
      }

      const permission = Notification.permission;

      // Check browser-side subscription
      let hasBrowserSubscription = false;
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        hasBrowserSubscription = subscription !== null;
      } catch (err) {
        console.error("[PushNotifications] Error checking subscription:", err);
      }

      setState({
        isSupported: true,
        permission,
        isSubscribed: hasBrowserSubscription,
        isLoading: false,
        error: null,
      });
    }

    checkState();
  }, []);

  // Send family ID to service worker so pushsubscriptionchange can re-subscribe
  useEffect(() => {
    if (!family?.id) return;
    if (!checkPushSupport()) return;

    navigator.serviceWorker.ready.then((registration) => {
      registration.active?.postMessage({
        type: "STORE_FAMILY_ID",
        familyId: family.id,
      });
    });
  }, [family?.id]);

  // Auto-recovery: if browser lost subscription but server knows we were subscribed,
  // automatically re-subscribe. Also refresh server record if browser is still subscribed.
  const familyId = family?.id;
  const deviceId = device?.id;
  useEffect(() => {
    if (state.isLoading || hasAttemptedRecoveryRef.current) return;
    if (!familyId || !deviceId) return;
    if (!state.isSupported) return;
    // Only attempt recovery if permission was previously granted
    if (Notification.permission !== "granted") return;

    hasAttemptedRecoveryRef.current = true;

    async function recoverOrRefresh() {
      const serverHasSubscription = await checkServerSubscription(deviceId!, familyId!);

      if (state.isSubscribed) {
        // Browser has subscription — refresh server record to keep it active
        try {
          const registration = await navigator.serviceWorker.ready;
          const subscription = await registration.pushManager.getSubscription();
          if (subscription) {
            const subscriptionJSON = subscription.toJSON();
            const response = await fetch("/api/notifications/subscribe", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                subscription: {
                  endpoint: subscriptionJSON.endpoint,
                  keys: {
                    p256dh: subscriptionJSON.keys?.p256dh,
                    auth: subscriptionJSON.keys?.auth,
                  },
                },
                deviceId: deviceId,
                familyId: familyId,
              }),
            });

            if (response.ok) {
              console.log("[PushNotifications] Subscription refreshed on server");
            } else {
              console.warn("[PushNotifications] Server rejected subscription, re-creating...");
              await subscription.unsubscribe();
              setState((prev) => ({ ...prev, isSubscribed: false }));
            }
          }
        } catch (err) {
          console.error("[PushNotifications] Error refreshing subscription:", err);
        }
      } else if (serverHasSubscription) {
        // Browser lost subscription but server says we were subscribed — auto re-subscribe
        console.log("[PushNotifications] Server has active subscription but browser lost it, auto-recovering...");

        try {
          // Fetch VAPID key
          const vapidResponse = await fetch("/api/notifications/vapid-key");
          if (!vapidResponse.ok) {
            console.error("[PushNotifications] Cannot recover: VAPID key unavailable");
            return;
          }
          const vapidData = await vapidResponse.json();
          const vapidKey = vapidData.publicKey;
          if (!vapidKey) return;

          vapidKeyRef.current = vapidKey;

          const registration = await navigator.serviceWorker.ready;
          const applicationServerKey = urlBase64ToUint8Array(vapidKey);
          const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: applicationServerKey as BufferSource,
          });

          // Register with server
          const subscriptionJSON = subscription.toJSON();
          const response = await fetch("/api/notifications/subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              subscription: {
                endpoint: subscriptionJSON.endpoint,
                keys: {
                  p256dh: subscriptionJSON.keys?.p256dh,
                  auth: subscriptionJSON.keys?.auth,
                },
              },
              deviceId: deviceId,
              familyId: familyId,
            }),
          });

          if (response.ok) {
            console.log("[PushNotifications] Auto-recovered push subscription");
            setState((prev) => ({ ...prev, isSubscribed: true }));
          }
        } catch (err) {
          console.error("[PushNotifications] Auto-recovery failed:", err);
        }
      }
    }

    recoverOrRefresh();
  }, [state.isSubscribed, state.isLoading, state.isSupported, familyId, deviceId]);

  /**
   * Get the VAPID public key from the server
   */
  const getVapidKey = useCallback(async (): Promise<string | null> => {
    if (vapidKeyRef.current) return vapidKeyRef.current;

    try {
      const response = await fetch("/api/notifications/vapid-key");
      if (!response.ok) {
        console.error("[PushNotifications] Failed to get VAPID key:", response.status);
        return null;
      }
      const data = await response.json();
      vapidKeyRef.current = data.publicKey;
      return data.publicKey;
    } catch (err) {
      console.error("[PushNotifications] Error fetching VAPID key:", err);
      return null;
    }
  }, []);

  /**
   * Request notification permission from the user
   */
  const requestPermission = useCallback(async (): Promise<
    NotificationPermission | "not-supported"
  > => {
    if (!state.isSupported) return "not-supported";

    try {
      const permission = await Notification.requestPermission();
      setState((prev) => ({ ...prev, permission }));
      return permission;
    } catch (err) {
      console.error("[PushNotifications] Error requesting permission:", err);
      return "denied";
    }
  }, [state.isSupported]);

  /**
   * Subscribe to push notifications
   */
  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!state.isSupported) {
      setState((prev) => ({ ...prev, error: "Push-Benachrichtigungen werden nicht unterstützt" }));
      return false;
    }

    if (!family?.id || !device?.id) {
      setState((prev) => ({ ...prev, error: "Familie oder Gerät nicht gefunden" }));
      return false;
    }

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      // Request permission if not already granted
      let permission = state.permission;
      if (permission !== "granted") {
        permission = await requestPermission();
        if (permission !== "granted") {
          setState((prev) => ({
            ...prev,
            isLoading: false,
            error: "Benachrichtigungen wurden nicht erlaubt",
          }));
          return false;
        }
      }

      // Get VAPID key
      const vapidKey = await getVapidKey();
      if (!vapidKey) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: "Push-Server nicht konfiguriert. Bitte VAPID-Schlüssel in .env setzen.",
        }));
        return false;
      }

      // Get service worker registration
      const registration = await navigator.serviceWorker.ready;

      // Always unsubscribe existing subscription first to ensure we use current VAPID key
      const existingSubscription = await registration.pushManager.getSubscription();
      if (existingSubscription) {
        await existingSubscription.unsubscribe();
        console.log("[PushNotifications] Unsubscribed from existing subscription");
      }

      // Create new subscription with current VAPID key
      const applicationServerKey = urlBase64ToUint8Array(vapidKey);
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey as BufferSource,
      });

      // Send subscription to server
      const subscriptionJSON = subscription.toJSON();
      const response = await fetch("/api/notifications/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscription: {
            endpoint: subscriptionJSON.endpoint,
            keys: {
              p256dh: subscriptionJSON.keys?.p256dh,
              auth: subscriptionJSON.keys?.auth,
            },
          },
          deviceId: device.id,
          familyId: family.id,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to register subscription on server");
      }

      // Store family ID in service worker for auto-recovery
      registration.active?.postMessage({
        type: "STORE_FAMILY_ID",
        familyId: family.id,
      });

      setState((prev) => ({
        ...prev,
        isSubscribed: true,
        isLoading: false,
        error: null,
      }));

      console.log("[PushNotifications] Successfully subscribed");
      return true;
    } catch (err) {
      console.error("[PushNotifications] Subscribe error:", err);
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : "Fehler beim Abonnieren",
      }));
      return false;
    }
  }, [state.isSupported, state.permission, family?.id, device?.id, getVapidKey, requestPermission]);

  /**
   * Unsubscribe from push notifications
   */
  const unsubscribe = useCallback(async (): Promise<boolean> => {
    if (!state.isSupported) return false;

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        // Unsubscribe from push manager
        await subscription.unsubscribe();
      }

      // Always remove from server (even if browser sub was already gone)
      await fetch("/api/notifications/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: subscription?.endpoint,
          deviceId: device?.id,
        }),
      });

      setState((prev) => ({
        ...prev,
        isSubscribed: false,
        isLoading: false,
        error: null,
      }));

      console.log("[PushNotifications] Successfully unsubscribed");
      return true;
    } catch (err) {
      console.error("[PushNotifications] Unsubscribe error:", err);
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : "Fehler beim Abmelden",
      }));
      return false;
    }
  }, [state.isSupported, device?.id]);

  return {
    ...state,
    subscribe,
    unsubscribe,
    requestPermission,
  };
}

/**
 * Send a test notification via the server (actually tests push infrastructure)
 */
export async function sendTestNotification(
  deviceId: string,
  familyId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch("/api/notifications/send-test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, familyId }),
    });

    const result = await response.json();

    if (result.success) {
      console.log("[PushNotifications] Test notification sent successfully");
    } else {
      console.error("[PushNotifications] Test notification failed:", result.error);
    }

    return result;
  } catch (err) {
    console.error("[PushNotifications] Test notification error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Netzwerkfehler",
    };
  }
}
