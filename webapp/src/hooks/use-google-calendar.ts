import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFamilyStore } from "@/stores/family-store";

interface GoogleCalendarSettings {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  email?: string;
  enabled_calendars?: string[];
  mapping_rules?: PersonMappingRule[];
  last_sync?: string;
  connected_at?: string;
  auto_sync?: boolean;
  last_auto_sync?: string;
  auto_sync_error?: string | null;
}

interface PersonMappingRule {
  id: string;
  person_id: string;
  match_type: "contains" | "starts_with" | "ends_with" | "regex";
  pattern: string;
  priority: number;
}

interface GoogleCalendar {
  id: string;
  name: string;
  color: string;
  primary: boolean;
  accessRole: string;
}

interface GoogleEvent {
  id: string;
  calendarId: string;
  title: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  allDay: boolean;
  color?: string;
  person_id?: string;
}

interface SyncResult {
  synced: number;
  created: number;
  updated: number;
  deleted: number;
  message: string;
}

// Hook to get Google Calendar connection status
export function useGoogleCalendarStatus() {
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: ["google-calendar-status", family?.id],
    queryFn: async (): Promise<GoogleCalendarSettings | null> => {
      if (!family?.id) return null;

      const response = await fetch(`/api/settings?family_id=${family.id}&key=google_calendar`);
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error("Failed to fetch Google Calendar status");
      }
      const data = await response.json();
      return data.value as GoogleCalendarSettings | null;
    },
    enabled: !!family?.id,
  });
}

// Hook to get list of Google Calendars
export function useGoogleCalendars() {
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: ["google-calendars", family?.id],
    queryFn: async (): Promise<GoogleCalendar[]> => {
      if (!family?.id) return [];

      const response = await fetch(`/api/google/calendars?family_id=${family.id}`);
      if (!response.ok) {
        if (response.status === 401) return [];
        throw new Error("Failed to fetch calendars");
      }
      const data = await response.json();
      return data.calendars;
    },
    enabled: !!family?.id,
  });
}

// Hook to get events from Google Calendar
export function useGoogleEvents(timeMin?: string, timeMax?: string) {
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: ["google-events", family?.id, timeMin, timeMax],
    queryFn: async (): Promise<GoogleEvent[]> => {
      if (!family?.id) return [];

      const params = new URLSearchParams({ family_id: family.id });
      if (timeMin) params.append("time_min", timeMin);
      if (timeMax) params.append("time_max", timeMax);

      const response = await fetch(`/api/google/events?${params}`);
      if (!response.ok) {
        if (response.status === 401) return [];
        throw new Error("Failed to fetch events");
      }
      const data = await response.json();
      return data.events;
    },
    enabled: !!family?.id,
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
  });
}

// Hook to update enabled calendars
export function useUpdateEnabledCalendars() {
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (enabledCalendars: string[]) => {
      if (!family?.id) throw new Error("No family");

      const response = await fetch("/api/google/calendars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          family_id: family.id,
          enabled_calendars: enabledCalendars,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to update calendars");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["google-calendar-status", family?.id] });
      queryClient.invalidateQueries({ queryKey: ["google-events", family?.id] });
    },
  });
}

// Hook to sync Google Calendar
export function useGoogleCalendarSync() {
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (): Promise<SyncResult> => {
      if (!family?.id) throw new Error("No family");

      const response = await fetch("/api/google/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ family_id: family.id }),
      });

      if (!response.ok) {
        throw new Error("Sync failed");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["google-calendar-status", family?.id] });
      queryClient.invalidateQueries({ queryKey: ["google-events", family?.id] });
      queryClient.invalidateQueries({ queryKey: ["events", family?.id] });
      queryClient.invalidateQueries({ queryKey: ["calendars", family?.id] });
    },
  });
}

// Hook to disconnect Google Calendar
export function useDisconnectGoogleCalendar() {
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async () => {
      if (!family?.id) throw new Error("No family");

      const response = await fetch(`/api/settings`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          family_id: family.id,
          key: "google_calendar",
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to disconnect");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["google-calendar-status", family?.id] });
      queryClient.invalidateQueries({ queryKey: ["google-calendars", family?.id] });
      queryClient.invalidateQueries({ queryKey: ["google-events", family?.id] });
    },
  });
}

// Hook to update mapping rules
export function useUpdateMappingRules() {
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (mappingRules: PersonMappingRule[]) => {
      if (!family?.id) throw new Error("No family");

      // Get current settings
      const statusResponse = await fetch(`/api/settings?family_id=${family.id}&key=google_calendar`);
      if (!statusResponse.ok) throw new Error("Not connected");
      const currentSettings = await statusResponse.json();

      // Update with new mapping rules
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          family_id: family.id,
          key: "google_calendar",
          value: {
            ...currentSettings.value,
            mapping_rules: mappingRules,
          },
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to update mapping rules");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["google-calendar-status", family?.id] });
    },
  });
}

// Hook to update auto-sync setting
export function useUpdateAutoSync() {
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!family?.id) throw new Error("No family");

      // Get current settings
      const statusResponse = await fetch(`/api/settings?family_id=${family.id}&key=google_calendar`);
      if (!statusResponse.ok) throw new Error("Not connected");
      const currentSettings = await statusResponse.json();

      // Update with auto_sync setting
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          family_id: family.id,
          key: "google_calendar",
          value: {
            ...currentSettings.value,
            auto_sync: enabled,
          },
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to update auto-sync setting");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["google-calendar-status", family?.id] });
    },
  });
}

// Get OAuth URL for connecting
export function getGoogleAuthUrl(familyId: string): string {
  return `/api/google/auth?family_id=${encodeURIComponent(familyId)}`;
}
