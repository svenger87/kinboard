import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFamilyStore } from "@/stores/family-store";
import { createClient } from "@/lib/supabase/client";
import type { NotificationPreferences } from "@/types/database";

export const notificationQueryKeys = {
  all: ["notification-preferences"] as const,
  byDevice: (familyId: string, deviceId: string) =>
    [...notificationQueryKeys.all, familyId, deviceId] as const,
};

export const DEFAULT_NOTIFICATION_PREFERENCES: Omit<
  NotificationPreferences,
  "id" | "family_id" | "device_id" | "created_at" | "updated_at"
> = {
  shopping_reminders: true,
  shopping_collaborative: true,
  calendar_reminders: true,
  meal_prep_reminders: true,
  birthday_reminders: true,
  default_event_reminder_minutes: 15,
  // meal_prep_advance_minutes: kept for schema back-compat only. The
  // original "remind me N minutes before meal prep" idea was abandoned —
  // meal-plan entries don't carry a time of day, so there's no anchor to
  // count down from. Superseded by a fixed daily 18:00 digest
  // (meal_prep_reminders toggle + /api/cron/meal-prep-reminders).
  meal_prep_advance_minutes: 60,
  quiet_hours_enabled: false,
  quiet_hours_start: "22:00",
  quiet_hours_end: "07:00",
  todo_reminders: true,
  todo_collaborative: true,
};

/**
 * Hook for fetching notification preferences for the current device
 */
export function useNotificationPreferences() {
  const { family, device } = useFamilyStore();
  const supabase = createClient();

  return useQuery({
    queryKey: notificationQueryKeys.byDevice(family?.id ?? "", device?.id ?? ""),
    queryFn: async () => {
      if (!family?.id || !device?.id) {
        return null;
      }

      const { data, error } = await supabase
        .from("notification_preferences")
        .select("*")
        .eq("family_id", family.id)
        .eq("device_id", device.id)
        .single();

      if (error) {
        // If no preferences exist, return defaults
        if (error.code === "PGRST116") {
          return {
            ...DEFAULT_NOTIFICATION_PREFERENCES,
            family_id: family.id,
            device_id: device.id,
          } as NotificationPreferences;
        }
        throw error;
      }

      return data as NotificationPreferences;
    },
    enabled: !!family?.id && !!device?.id,
  });
}

export type NotificationPreferencesUpdate = Partial<
  Omit<NotificationPreferences, "id" | "family_id" | "device_id" | "created_at" | "updated_at">
>;

/**
 * Hook for updating notification preferences
 */
export function useUpdateNotificationPreferences() {
  const { family, device } = useFamilyStore();
  const queryClient = useQueryClient();
  const supabase = createClient();

  return useMutation({
    mutationFn: async (updates: NotificationPreferencesUpdate) => {
      if (!family?.id || !device?.id) {
        throw new Error("No family or device");
      }

      const upsertData = {
        family_id: family.id,
        device_id: device.id,
        ...updates,
        updated_at: new Date().toISOString(),
      };

       
      const { data, error } = await (supabase as any)
        .from("notification_preferences")
        .upsert(upsertData, { onConflict: "family_id,device_id" })
        .select()
        .single();

      if (error) throw error;
      return data as NotificationPreferences;
    },
    onSuccess: () => {
      if (family?.id && device?.id) {
        queryClient.invalidateQueries({
          queryKey: notificationQueryKeys.byDevice(family.id, device.id),
        });
      }
    },
  });
}

/**
 * Check if current time is within quiet hours
 */
export function isWithinQuietHours(
  quietHoursEnabled: boolean,
  quietHoursStart: string,
  quietHoursEnd: string
): boolean {
  if (!quietHoursEnabled) return false;

  const now = new Date();
  const currentTime = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;

  // Handle overnight quiet hours (e.g., 22:00 - 07:00)
  if (quietHoursStart > quietHoursEnd) {
    return currentTime >= quietHoursStart || currentTime <= quietHoursEnd;
  }

  // Normal range (e.g., 12:00 - 14:00)
  return currentTime >= quietHoursStart && currentTime <= quietHoursEnd;
}
