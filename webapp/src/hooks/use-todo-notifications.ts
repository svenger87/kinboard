import { useCallback, useRef, useEffect } from "react";
import { useFamilyStore } from "@/stores/family-store";

const BATCH_WINDOW_MS = 10000; // 10 seconds

interface PendingNotification {
  type: "created" | "assigned";
  title: string;
  personName?: string;
}

interface UseTodoNotificationsReturn {
  notifyTodoCreated: (title: string) => void;
  notifyTodoAssigned: (title: string, personName: string) => void;
}

export function useTodoNotifications(): UseTodoNotificationsReturn {
  const { family, device } = useFamilyStore();

  const pendingRef = useRef<PendingNotification[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const familyIdRef = useRef<string | null>(null);
  const deviceIdRef = useRef<string | null>(null);

  useEffect(() => {
    familyIdRef.current = family?.id ?? null;
    deviceIdRef.current = device?.id ?? null;
  }, [family?.id, device?.id]);

  const sendBatch = useCallback(async (items: PendingNotification[]) => {
    if (items.length === 0) return;

    const familyId = familyIdRef.current;
    const deviceId = deviceIdRef.current;

    if (!familyId) return;

    // Split by type
    const created = items.filter((i) => i.type === "created");
    const assigned = items.filter((i) => i.type === "assigned");

    const batches: { type: string; items: PendingNotification[] }[] = [];
    if (created.length > 0) batches.push({ type: "created", items: created });
    if (assigned.length > 0) batches.push({ type: "assigned", items: assigned });

    for (const batch of batches) {
      try {
        await fetch("/api/notifications/send-todo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            familyId,
            deviceId,
            type: batch.type,
            items: batch.items.map((i) => ({
              title: i.title,
              personName: i.personName,
            })),
          }),
        });
      } catch (err) {
        console.error("[TodoNotifications] Error sending notification:", err);
      }
    }
  }, []);

  const queueNotification = useCallback(
    (notification: PendingNotification) => {
      pendingRef.current.push(notification);

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout(() => {
        const items = [...pendingRef.current];
        pendingRef.current = [];
        timerRef.current = null;
        if (items.length > 0) {
          sendBatch(items);
        }
      }, BATCH_WINDOW_MS);
    },
    [sendBatch]
  );

  const notifyTodoCreated = useCallback(
    (title: string) => {
      queueNotification({ type: "created", title });
    },
    [queueNotification]
  );

  const notifyTodoAssigned = useCallback(
    (title: string, personName: string) => {
      queueNotification({ type: "assigned", title, personName });
    },
    [queueNotification]
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (pendingRef.current.length > 0) {
        const familyId = familyIdRef.current;
        const deviceId = deviceIdRef.current;
        if (familyId) {
          const created = pendingRef.current.filter((i) => i.type === "created");
          if (created.length > 0) {
            navigator.sendBeacon(
              "/api/notifications/send-todo",
              JSON.stringify({
                familyId,
                deviceId,
                type: "created",
                items: created.map((i) => ({ title: i.title })),
              })
            );
          }
        }
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  return { notifyTodoCreated, notifyTodoAssigned };
}
