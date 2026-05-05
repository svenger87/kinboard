import { useCallback, useRef, useEffect } from "react";
import { useFamilyStore } from "@/stores/family-store";

/**
 * Batching window in milliseconds
 * Items added within this window will be combined into a single notification
 */
const BATCH_WINDOW_MS = 10000; // 10 seconds

interface UseShoppingNotificationsReturn {
  /**
   * Queue an item name for notification
   * Multiple items added within 10 seconds will be batched together
   */
  queueNotification: (itemName: string) => void;

  /**
   * Immediately send any pending notifications without waiting for the timer
   * Useful when navigating away or closing the app
   */
  flushPending: () => Promise<void>;

  /**
   * Get the number of items currently pending in the batch
   */
  getPendingCount: () => number;
}

/**
 * Hook for sending batched shopping notifications
 *
 * When items are added, they are collected for 10 seconds before sending
 * a notification. This prevents spamming when users add multiple items quickly.
 *
 * Example flow:
 * - 12:00:00 - User adds "Milch" → Timer starts
 * - 12:00:02 - User adds "Brot" → Added to batch
 * - 12:00:08 - User adds "Käse" → Added to batch
 * - 12:00:10 - Timer fires → Sends: "3 Artikel hinzugefügt: Milch, Brot, Käse"
 */
export function useShoppingNotifications(): UseShoppingNotificationsReturn {
  const { family, device } = useFamilyStore();

  // Store pending items in a ref to avoid re-renders
  const pendingItemsRef = useRef<string[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Store family/device IDs in refs for use in cleanup
  const familyIdRef = useRef<string | null>(null);
  const deviceIdRef = useRef<string | null>(null);

  // Keep refs in sync with state
  useEffect(() => {
    familyIdRef.current = family?.id ?? null;
    deviceIdRef.current = device?.id ?? null;
  }, [family?.id, device?.id]);

  /**
   * Send the batched notification to the server
   */
  const sendBatchedNotification = useCallback(async (items: string[]) => {
    if (items.length === 0) return;

    const familyId = familyIdRef.current;
    const deviceId = deviceIdRef.current;

    if (!familyId) {
      console.log("[ShoppingNotifications] No family ID, skipping notification");
      return;
    }

    try {
      const response = await fetch("/api/notifications/send-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          familyId,
          deviceId,
          items,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        console.log(`[ShoppingNotifications] Sent batch notification for ${items.length} items, delivered to ${result.sent} devices`);
      } else {
        console.error("[ShoppingNotifications] Failed to send batch notification:", response.status);
      }
    } catch (err) {
      console.error("[ShoppingNotifications] Error sending batch notification:", err);
    }
  }, []);

  /**
   * Queue an item for notification
   */
  const queueNotification = useCallback((itemName: string) => {
    // Add item to pending list
    pendingItemsRef.current.push(itemName);

    console.log(`[ShoppingNotifications] Queued "${itemName}", pending: ${pendingItemsRef.current.length} items`);

    // Clear existing timer (resets the window)
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    // Set new timer
    timerRef.current = setTimeout(() => {
      const items = [...pendingItemsRef.current];
      pendingItemsRef.current = [];
      timerRef.current = null;

      if (items.length > 0) {
        sendBatchedNotification(items);
      }
    }, BATCH_WINDOW_MS);
  }, [sendBatchedNotification]);

  /**
   * Flush any pending notifications immediately
   */
  const flushPending = useCallback(async () => {
    // Clear timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    // Send pending items
    const items = [...pendingItemsRef.current];
    pendingItemsRef.current = [];

    if (items.length > 0) {
      await sendBatchedNotification(items);
    }
  }, [sendBatchedNotification]);

  /**
   * Get the number of pending items
   */
  const getPendingCount = useCallback(() => {
    return pendingItemsRef.current.length;
  }, []);

  // Cleanup: flush pending notifications when unmounting
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      // Note: We don't send on unmount as it may cause issues during navigation
      // The batch will be lost, which is acceptable for a better UX
    };
  }, []);

  // Flush pending notifications when the page is about to unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (pendingItemsRef.current.length > 0) {
        // Use sendBeacon for reliable delivery during page unload
        const familyId = familyIdRef.current;
        const deviceId = deviceIdRef.current;

        if (familyId) {
          navigator.sendBeacon(
            "/api/notifications/send-batch",
            JSON.stringify({
              familyId,
              deviceId,
              items: pendingItemsRef.current,
            })
          );
        }
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  return {
    queueNotification,
    flushPending,
    getPendingCount,
  };
}

/**
 * Hook that combines creating shopping items with notification batching
 * Use this instead of the regular useCreateShoppingItem when you want notifications
 */
export function useCreateShoppingItemWithNotification() {
  const { queueNotification } = useShoppingNotifications();

  // This is a simple wrapper that queues a notification after successful creation
  // The actual mutation should be done separately using useCreateShoppingItem
  const notifyItemCreated = useCallback((itemName: string) => {
    queueNotification(itemName);
  }, [queueNotification]);

  return { notifyItemCreated };
}
