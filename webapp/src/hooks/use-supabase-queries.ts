"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useFamilyStore } from "@/stores/family-store";
import { getDeviceId, persistDeviceId, getDeviceFingerprint } from "@/lib/device-id";
import type {
  Database,
  Family,
  Device,
  Person,
  Calendar,
  Event,
  Todo,
  ShoppingItem,
  Subject,
  Schedule,
  Birthday,
  BirthdayGiftIdea,
  Note,
} from "@/types/database";

// ===================
// HELPERS
// ===================

/** Extract family ID or throw a descriptive error when family context is missing */
export function requireFamilyId(family: Family | null): string {
  if (!family?.id) {
    throw new Error(
      "No family context — ensure the device has joined a family before performing this operation."
    );
  }
  return family.id;
}

// ===================
// QUERY KEYS
// ===================

export const queryKeys = {
  family: (id: string) => ["family", id] as const,
  devices: (familyId: string) => ["devices", familyId] as const,
  people: (familyId: string) => ["people", familyId] as const,
  events: (familyId: string) => ["events", familyId] as const,
  eventsByDate: (familyId: string, start: string, end: string) =>
    ["events", familyId, start, end] as const,
  todos: (familyId: string) => ["todos", familyId] as const,
  shoppingItems: (familyId: string) => ["shopping", familyId] as const,
  subjects: (familyId: string) => ["subjects", familyId] as const,
  schedules: (familyId: string) => ["schedules", familyId] as const,
  schedulesByPerson: (familyId: string, personId: string) =>
    ["schedules", familyId, personId] as const,
  birthdays: (familyId: string) => ["birthdays", familyId] as const,
  giftIdeas: (birthdayId: string) => ["giftIdeas", birthdayId] as const,
  notes: (familyId: string) => ["notes", familyId] as const,
  settings: (familyId: string, key: string) =>
    ["settings", familyId, key] as const,
};

// ===================
// FAMILY HOOKS
// ===================

export function useFamilyByJoinCode(joinCode: string) {
  const supabase = createClient();

  return useQuery({
    queryKey: ["family", "joinCode", joinCode],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("families")
        .select("*")
        .eq("join_code", joinCode)
        .single();

      if (error) throw error;

      const family = data as Family;

      // Expiry is opt-in: null = never expires (current behaviour).
      // Reject the code if an explicit expiry timestamp is set and has passed.
      if (
        family.join_code_expires_at != null &&
        new Date(family.join_code_expires_at).getTime() < Date.now()
      ) {
        return null;
      }

      return family;
    },
    enabled: !!joinCode,
  });
}

// Verifies the family ID still exists in the database. Used by AuthGuard
// to detect orphan sessions — when a self-hoster wipes the DB but the
// browser still has a stored family in cookie, every subsequent API
// call FK-violates and the UI gets stuck. This query gives a clean
// "stored ID is dead, clear the session and bounce to /join" signal.
//
// Returns:
//   data === true    → family still exists, session is valid
//   data === false   → family no longer in DB, session is orphan
//   data === null    → no familyId provided (skip the check)
export function useValidateStoredFamily(familyId: string | undefined) {
  const supabase = createClient();
  return useQuery({
    queryKey: ["family", "validate", familyId],
    queryFn: async (): Promise<boolean | null> => {
      if (!familyId) return null;
      const { data, error } = await supabase
        .from("families")
        .select("id")
        .eq("id", familyId)
        .maybeSingle();
      if (error) {
        // Don't false-positive on transient network/RLS errors — those
        // shouldn't kick the user out. Return null and let the next
        // refetch try again.
        console.warn("[useValidateStoredFamily] check failed:", error.message);
        return null;
      }
      return data !== null;
    },
    enabled: !!familyId,
    staleTime: 5 * 60 * 1000, // recheck once every 5 min
    retry: 1,
  });
}

export function useCreateFamily() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { setFamily } = useFamilyStore();

  return useMutation({
    mutationFn: async (name: string) => {
      // Generate join code
      const joinCode = generateJoinCode();

       
      const { data, error } = await (supabase as any)
        .from("families")
        .insert({ name, join_code: joinCode })
        .select()
        .single();

      if (error) throw error;
      return data as Family;
    },
    onSuccess: (family) => {
      setFamily(family);
      queryClient.invalidateQueries({ queryKey: ["family"] });
    },
  });
}

export function useRegisterDevice() {
  const supabase = createClient();
  const { setDevice } = useFamilyStore();

  return useMutation({
    mutationFn: async ({
      familyId,
      name,
    }: {
      familyId: string;
      name: string;
    }) => {
       
      const { data, error } = await (supabase as any)
        .from("devices")
        .insert({
          family_id: familyId,
          name,
          user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
        })
        .select()
        .single();

      if (error) throw error;
      return data as Device;
    },
    onSuccess: (device) => {
      setDevice(device);
    },
  });
}

// Restore existing device session by hardware ID
export function useRestoreDeviceSession() {
  const supabase = createClient();
  const { setFamily, setDevice, setPeople } = useFamilyStore();

  return useMutation({
    mutationFn: async () => {
      // Get persistent device ID and fingerprint
      const hardwareId = await getDeviceId();
      const fingerprint = getDeviceFingerprint();

      // Find device by hardware_id
       
      const { data: device } = await (supabase as any)
        .from("devices")
        .select("*, families(*)")
        .eq("hardware_id", hardwareId)
        .maybeSingle();

      if (!device) {
        return null; // No existing device found
      }

      const family = device.families as Family;

      // Update last_seen and fingerprint (keep fingerprint fresh)
       
      await (supabase as any)
        .from("devices")
        .update({
          last_seen: new Date().toISOString(),
          fingerprint: fingerprint,
        })
        .eq("id", device.id);

      // Fetch family members
       
      const { data: people } = await (supabase as any)
        .from("people")
        .select("*")
        .eq("family_id", family.id)
        .order("created_at");

      // Persist device ID to all storage locations
      await persistDeviceId(hardwareId);

      // Remove the joined family data from device object
      const { families: _, ...deviceWithoutFamily } = device;

      return {
        family,
        device: { ...deviceWithoutFamily, fingerprint } as Device,
        people: (people || []) as Person[],
      };
    },
    onSuccess: (result) => {
      if (result) {
        setFamily(result.family);
        setDevice(result.device);
        setPeople(result.people);
      }
    },
  });
}

export function useJoinFamily() {
  const supabase = createClient();
  const { setFamily, setDevice, setPeople } = useFamilyStore();

  return useMutation({
    mutationFn: async ({
      joinCode,
      deviceName,
    }: {
      joinCode: string;
      deviceName: string;
    }) => {
      // Get persistent device ID and fingerprint
      const hardwareId = await getDeviceId();
      const fingerprint = getDeviceFingerprint();

      // Find family by join code

      const { data: familyData, error: familyError } = await (supabase as any)
        .from("families")
        .select("*")
        .eq("join_code", joinCode.toUpperCase())
        .single();

      if (familyError) throw new Error("Familie nicht gefunden");

      // Expiry is opt-in: null = never expires (current behaviour).
      // Reject the code if an explicit expiry timestamp is set and has passed.
      const familyRaw = familyData as Family;
      if (
        familyRaw.join_code_expires_at != null &&
        new Date(familyRaw.join_code_expires_at).getTime() < Date.now()
      ) {
        throw new Error("Familie nicht gefunden");
      }
      const family = familyRaw;

      // Check if this device already exists in this family (by hardware_id)
       
      const { data: existingDevice } = await (supabase as any)
        .from("devices")
        .select("*")
        .eq("family_id", family.id)
        .eq("hardware_id", hardwareId)
        .maybeSingle();

      let device: Device;

      if (existingDevice) {
        // Device already registered, just restore session
        device = existingDevice as Device;
        // Update last_seen and fingerprint
         
        await (supabase as any)
          .from("devices")
          .update({
            last_seen: new Date().toISOString(),
            fingerprint: fingerprint,
          })
          .eq("id", device.id);
        device = { ...device, fingerprint };
      } else {
        // Register new device with hardware_id and fingerprint
         
        const { data: newDevice, error: deviceError } = await (supabase as any)
          .from("devices")
          .insert({
            family_id: family.id,
            name: deviceName || "Unbekanntes Gerät",
            hardware_id: hardwareId,
            fingerprint: fingerprint,
            user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
          })
          .select()
          .single();

        if (deviceError) throw deviceError;
        device = newDevice as Device;
      }

      // Persist device ID to all storage locations
      await persistDeviceId(hardwareId);

      // Fetch family members
       
      const { data: people } = await (supabase as any)
        .from("people")
        .select("*")
        .eq("family_id", family.id)
        .order("created_at");

      return { family, device, people: (people || []) as Person[] };
    },
    onSuccess: ({ family, device, people }) => {
      setFamily(family);
      setDevice(device);
      setPeople(people);
    },
  });
}

export function useCreateFamilyWithDevice() {
  const supabase = createClient();
  const { setFamily, setDevice } = useFamilyStore();

  return useMutation({
    mutationFn: async ({
      familyName,
      deviceName,
    }: {
      familyName: string;
      deviceName: string;
    }) => {
      // Get persistent device ID and fingerprint
      const hardwareId = await getDeviceId();
      const fingerprint = getDeviceFingerprint();

      // Generate join code
      const joinCode = generateJoinCode();

      // Create family
       
      const { data: family, error: familyError } = await (supabase as any)
        .from("families")
        .insert({ name: familyName, join_code: joinCode })
        .select()
        .single();

      if (familyError) throw familyError;

      // Register device with hardware_id and fingerprint
       
      const { data: device, error: deviceError } = await (supabase as any)
        .from("devices")
        .insert({
          family_id: family.id,
          name: deviceName || "Erstes Gerät",
          hardware_id: hardwareId,
          fingerprint: fingerprint,
          user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
        })
        .select()
        .single();

      if (deviceError) throw deviceError;

      // Persist device ID to all storage locations
      await persistDeviceId(hardwareId);

      return { family: family as Family, device: device as Device };
    },
    onSuccess: ({ family, device }) => {
      setFamily(family);
      setDevice(device);
    },
  });
}

// ===================
// DEVICES HOOKS
// ===================

export function useDevices() {
  const supabase = createClient();
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: queryKeys.devices(family?.id ?? ""),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("devices")
        .select("*")
        .eq("family_id", requireFamilyId(family))
        .order("created_at");

      if (error) throw error;
      return data as Device[];
    },
    enabled: !!family?.id,
  });
}

export function useUpdateDevice() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family, device: currentDevice, setDevice } = useFamilyStore();

  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: Partial<Device> & { id: string }) => {
       
      const { data, error } = await (supabase as any)
        .from("devices")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as Device;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.devices(requireFamilyId(family)) });
      // Update the device in the store if it's the current device
      if (currentDevice?.id === data.id) {
        setDevice(data);
      }
    },
  });
}

export function useDeleteDevice() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (id: string) => {
       
      const { error } = await (supabase as any).from("devices").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.devices(requireFamilyId(family)) });
    },
  });
}

export function useUpdateDeviceLastSeen() {
  const supabase = createClient();
  const { device } = useFamilyStore();

  return useMutation({
    mutationFn: async () => {
      if (!device?.id) return null;

       
      const { error } = await (supabase as any)
        .from("devices")
        .update({ last_seen: new Date().toISOString() })
        .eq("id", device.id);

      // If device doesn't exist (was deleted), clear it from local storage
      if (error) {
        console.warn("[Device] Update last_seen failed:", error.message);
        // Don't throw - this is a non-critical heartbeat
        return null;
      }
      return { success: true };
    },
  });
}

// Find devices by fingerprint (for fallback recognition on join page)
export function useFindDeviceByFingerprint() {
  const supabase = createClient();

  return useMutation({
    mutationFn: async (fingerprint: string) => {
      if (!fingerprint) return null;

      // Match against both the current fingerprint column AND the
      // fingerprint_history array. The latter accumulates every
      // fingerprint a device has presented successfully — so a
      // browser/OS update that changes today's hash doesn't break
      // recognition once the new hash has been recorded once.
      // PostgREST's array-contains operator is `cs` (contains set);
      // `or=(fingerprint.eq.X,fingerprint_history.cs.{X})` matches
      // either condition.

      const { data: devices } = await (supabase as any)
        .from("devices")
        .select(`
          id,
          name,
          hardware_id,
          fingerprint,
          fingerprint_history,
          last_seen,
          families!inner(id, name, join_code)
        `)
        .or(`fingerprint.eq.${fingerprint},fingerprint_history.cs.{${fingerprint}}`)
        .order("last_seen", { ascending: false })
        .limit(5);

      // For each match, append the current fingerprint to the device's
      // history if it's not already there. This is fire-and-forget —
      // the user's recognition doesn't block on the write.
      if (devices && devices.length > 0) {

        for (const d of devices as any[]) {
          const history: string[] = Array.isArray(d.fingerprint_history)
            ? d.fingerprint_history
            : [];
          if (!history.includes(fingerprint)) {

            (supabase as any)
              .from("devices")
              .update({ fingerprint_history: [...history, fingerprint] })
              .eq("id", d.id)
              .then(() => undefined, () => undefined);
          }
        }
      }

      if (!devices || devices.length === 0) {
        return null;
      }

      // Return array of matching devices with their families
       
      return devices.map((d: any) => ({
        device: {
          id: d.id,
          name: d.name,
          hardware_id: d.hardware_id,
          fingerprint: d.fingerprint,
          last_seen: d.last_seen,
        },
        family: d.families as { id: string; name: string; join_code: string },
      }));
    },
  });
}

// Quick rejoin using fingerprint match (restores session without join code)
export function useQuickRejoin() {
  const supabase = createClient();
  const { setFamily, setDevice, setPeople } = useFamilyStore();

  return useMutation({
    mutationFn: async ({ deviceId }: { deviceId: string }) => {
      // Get current hardware ID and fingerprint
      const hardwareId = await getDeviceId();
      const fingerprint = getDeviceFingerprint();

      // Fetch device with family
       
      const { data: device } = await (supabase as any)
        .from("devices")
        .select("*, families(*)")
        .eq("id", deviceId)
        .single();

      if (!device) {
        throw new Error("Device not found");
      }

      const family = device.families as Family;

      // Update device with new hardware_id and fingerprint (storage was cleared)
       
      await (supabase as any)
        .from("devices")
        .update({
          hardware_id: hardwareId,
          fingerprint: fingerprint,
          last_seen: new Date().toISOString(),
        })
        .eq("id", deviceId);

      // Persist new hardware ID to all storage
      await persistDeviceId(hardwareId);

      // Fetch family members
       
      const { data: people } = await (supabase as any)
        .from("people")
        .select("*")
        .eq("family_id", family.id)
        .order("created_at");

      const { families: _, ...deviceWithoutFamily } = device;

      return {
        family,
        device: { ...deviceWithoutFamily, hardware_id: hardwareId, fingerprint } as Device,
        people: (people || []) as Person[],
      };
    },
    onSuccess: (result) => {
      if (result) {
        setFamily(result.family);
        setDevice(result.device);
        setPeople(result.people);
      }
    },
  });
}

// ===================
// PEOPLE HOOKS
// ===================

export function usePeople() {
  const supabase = createClient();
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: queryKeys.people(family?.id ?? ""),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("people")
        .select("*")
        .eq("family_id", requireFamilyId(family))
        .order("created_at");

      if (error) throw error;
      return data as Person[];
    },
    enabled: !!family?.id,
  });
}

export function useCreatePerson() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (person: { name: string; color: string; avatar_url?: string; is_child?: boolean; birth_date?: string | null }) => {
       
      const { data, error } = await (supabase as any)
        .from("people")
        .insert({ ...person, family_id: requireFamilyId(family) })
        .select()
        .single();

      if (error) throw error;
      return data as Person;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.people(requireFamilyId(family)) });
    },
  });
}

export function useUpdatePerson() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: Partial<Person> & { id: string }) => {
       
      const { data, error } = await (supabase as any)
        .from("people")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as Person;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.people(requireFamilyId(family)) });
    },
  });
}

export function useDeletePerson() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (id: string) => {
       
      const { error } = await (supabase as any).from("people").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.people(requireFamilyId(family)) });
    },
  });
}

// ===================
// CALENDARS HOOKS
// ===================

export function useCalendars() {
  const supabase = createClient();
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: ["calendars", family?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("calendars")
        .select("*")
        .eq("family_id", requireFamilyId(family))
        .order("name");

      if (error) throw error;
      return data as Calendar[];
    },
    enabled: !!family?.id,
  });
}

export function useCreateCalendar() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (calendar: {
      name: string;
      color: string;
      google_calendar_id?: string;
    }) => {
       
      const { data, error } = await (supabase as any)
        .from("calendars")
        .insert({
          ...calendar,
          family_id: requireFamilyId(family),
        })
        .select()
        .single();

      if (error) throw error;
      return data as Calendar;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendars", requireFamilyId(family)] });
    },
  });
}

export function useUpdateCalendar() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: {
      id: string;
      person_id?: string | null;
      color?: string;
      name?: string;
      is_holidays?: boolean;
      is_waste_collection?: boolean;
      ics_url?: string | null;
    }) => {

      const { data, error } = await (supabase as any)
        .from("calendars")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as Calendar;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendars", requireFamilyId(family)] });
    },
  });
}

export function useCreateIcsCalendar() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (calendar: {
      name: string;
      color: string;
      ics_url: string;
      person_id?: string | null;
      is_holidays?: boolean;
      is_waste_collection?: boolean;
    }) => {

      const { data, error } = await (supabase as any)
        .from("calendars")
        .insert({
          ...calendar,
          family_id: requireFamilyId(family),
        })
        .select()
        .single();

      if (error) throw error;
      return data as Calendar;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendars", requireFamilyId(family)] });
    },
  });
}

export function useDeleteCalendar() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (calendarId: string) => {
      // Delete associated events first

      await (supabase as any)
        .from("events")
        .delete()
        .eq("calendar_id", calendarId);


      const { error } = await (supabase as any)
        .from("calendars")
        .delete()
        .eq("id", calendarId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendars", requireFamilyId(family)] });
    },
  });
}

// User-triggered manual sync for ICS calendars. Hits the same
// /api/calendar/sync-ics endpoint the "Sync now" button on
// /settings/ics calls. Mirrors the shape of useGoogleCalendarSync —
// returns sync stats (processed/succeeded/failed) and invalidates
// calendar + event queries on success so the UI refreshes.
export function useIcsSync() {
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async () => {
      if (!family?.id) throw new Error("No family");
      const response = await fetch("/api/calendar/sync-ics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ family_id: family.id }),
      });
      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `Sync failed: ${response.status}`);
      }
      return response.json() as Promise<{
        ok: true;
        processed: number;
        succeeded: number;
        failed: number;
        results: Array<{
          calendarId: string;
          success: boolean;
          synced?: number;
          created?: number;
          updated?: number;
          deleted?: number;
          notModified?: boolean;
          error?: string;
        }>;
        timestamp: string;
      }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendars", requireFamilyId(family)] });
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });
}

// EVENTS HOOKS
// ===================

export function useEvents(startDate?: string, endDate?: string) {
  const supabase = createClient();
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: startDate && endDate
      ? queryKeys.eventsByDate(family?.id ?? "", startDate, endDate)
      : queryKeys.events(family?.id ?? ""),
    queryFn: async () => {
      let query = supabase
        .from("events")
        .select(`
          *,
          calendar:calendars!inner(family_id, person_id, color, name, is_holidays, is_waste_collection)
        `)
        .eq("calendar.family_id", requireFamilyId(family));

      if (startDate && endDate) {
        // Include events that overlap the range (not just start within it)
        // An event overlaps if: event.start <= range.end AND event.end >= range.start
        query = query
          .lte("start_at", endDate)
          .gte("end_at", startDate);
      }

      const { data, error } = await query.order("start_at");
      if (error) throw error;
      return data as (Event & { calendar: { family_id: string; person_id: string | null; color: string; name: string; is_holidays: boolean; is_waste_collection: boolean } })[];
    },
    enabled: !!family?.id,
  });
}

export function useCreateEvent() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (event: {
      calendar_id: string;
      title: string;
      description?: string;
      location?: string;
      start_at: string;
      end_at: string;
      all_day?: boolean;
      person_id?: string | null;
    }) => {
       
      const { data, error } = await (supabase as any)
        .from("events")
        .insert(event)
        .select()
        .single();

      if (error) throw error;
      const createdEvent = data as Event;

      // Push to Google Calendar (non-blocking)
      try {
        const response = await fetch("/api/google/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            family_id: requireFamilyId(family),
            event_id: createdEvent.id,
            calendar_id: event.calendar_id,
            title: event.title,
            description: event.description,
            location: event.location,
            start_at: event.start_at,
            end_at: event.end_at,
            all_day: event.all_day,
            person_id: event.person_id,
          }),
        });
        if (response.ok) {
          const result = await response.json();
          if (result.google_event_id) {
            createdEvent.google_event_id = result.google_event_id;
          }
        } else {
          console.warn("Failed to push event to Google Calendar");
        }
      } catch (err) {
        console.warn("Error pushing event to Google:", err);
      }

      return createdEvent;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events", requireFamilyId(family)] });
    },
  });
}

export function useUpdateEvent() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Event> & { id: string }) => {
       
      const { data, error } = await (supabase as any)
        .from("events")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      const updatedEvent = data as Event;

      // Push update to Google Calendar (non-blocking)
      if (updatedEvent.google_event_id) {
        try {
          const response = await fetch("/api/google/events", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              family_id: requireFamilyId(family),
              event_id: id,
              title: updates.title,
              description: updates.description,
              location: updates.location,
              start_at: updates.start_at,
              end_at: updates.end_at,
              all_day: updates.all_day,
              person_id: updates.person_id,
            }),
          });
          if (!response.ok) {
            console.warn("Failed to update event on Google Calendar");
          }
        } catch (err) {
          console.warn("Error updating event on Google:", err);
        }
      }

      return updatedEvent;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events", requireFamilyId(family)] });
    },
  });
}

export function useDeleteEvent() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (id: string) => {
      // Delete from Google Calendar first (non-blocking, but we try before local delete)
      try {
        await fetch("/api/google/events", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            family_id: requireFamilyId(family),
            event_id: id,
          }),
        });
      } catch (err) {
        console.warn("Error deleting event from Google:", err);
      }

      // Delete locally
       
      const { error } = await (supabase as any).from("events").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events", requireFamilyId(family)] });
    },
  });
}

// ===================
// TODOS HOOKS
// ===================

export function useTodos() {
  const supabase = createClient();
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: queryKeys.todos(family?.id ?? ""),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("todos")
        .select("*")
        .eq("family_id", requireFamilyId(family))
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as Todo[];
    },
    enabled: !!family?.id,
  });
}

export function useCreateTodo() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family, device } = useFamilyStore();

  return useMutation({
    mutationFn: async (todo: {
      title: string;
      person_id?: string | null;
      due_date?: string | null;
      priority?: number | string;
      recurrence?: string;
    }) => {
       
      const { data, error } = await (supabase as any)
        .from("todos")
        .insert({ ...todo, family_id: requireFamilyId(family), source_device_id: device?.id })
        .select()
        .single();

      if (error) throw error;
      return data as Todo;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.todos(requireFamilyId(family)) });
    },
  });
}

export function useUpdateTodo() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Todo> & { id: string }) => {
       
      const { data, error } = await (supabase as any)
        .from("todos")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as Todo;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.todos(requireFamilyId(family)) });
    },
  });
}

export function useDeleteTodo() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (id: string) => {
       
      const { error } = await (supabase as any).from("todos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.todos(requireFamilyId(family)) });
    },
  });
}

// ===================
// SHOPPING HOOKS
// ===================

export function useShoppingItems() {
  const supabase = createClient();
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: queryKeys.shoppingItems(family?.id ?? ""),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shopping_items")
        .select("*")
        .eq("family_id", requireFamilyId(family))
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as ShoppingItem[];
    },
    enabled: !!family?.id,
  });
}

export function useCreateShoppingItem() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family, device } = useFamilyStore();

  return useMutation({
    mutationFn: async (item: {
      name: string;
      category?: string;
      quantity?: number | null;
      unit?: string | null;
      notes?: string | null;
      image_url?: string | null;
      catalog_item_id?: string | null;
      recipe_id?: string | null;
      added_by?: string | null;
    }) => {
       
      const { data, error } = await (supabase as any)
        .from("shopping_items")
        .insert({ ...item, family_id: requireFamilyId(family), source_device_id: device?.id })
        .select()
        .single();

      if (error) throw error;
      return data as ShoppingItem;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.shoppingItems(requireFamilyId(family)),
      });
    },
  });
}

export function useUpdateShoppingItem() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: Partial<ShoppingItem> & { id: string }) => {
       
      const { data, error } = await (supabase as any)
        .from("shopping_items")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as ShoppingItem;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.shoppingItems(requireFamilyId(family)),
      });
    },
  });
}

export function useDeleteShoppingItem() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (id: string) => {
       
      const { error } = await (supabase as any)
        .from("shopping_items")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.shoppingItems(requireFamilyId(family)),
      });
    },
  });
}

// ===================
// SUBJECTS HOOKS
// ===================

export function useSubjects() {
  const supabase = createClient();
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: queryKeys.subjects(family?.id ?? ""),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subjects")
        .select("*")
        .eq("family_id", requireFamilyId(family))
        .order("name");

      if (error) throw error;
      return data as Subject[];
    },
    enabled: !!family?.id,
  });
}

export function useCreateSubject() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (subject: {
      name: string;
      color: string;
      icon?: string;
    }) => {
       
      const { data, error } = await (supabase as any)
        .from("subjects")
        .insert({ ...subject, family_id: requireFamilyId(family) })
        .select()
        .single();

      if (error) throw error;
      return data as Subject;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.subjects(requireFamilyId(family)),
      });
    },
  });
}

export function useUpdateSubject() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: Partial<Subject> & { id: string }) => {
       
      const { data, error } = await (supabase as any)
        .from("subjects")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as Subject;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.subjects(requireFamilyId(family)),
      });
    },
  });
}

export function useDeleteSubject() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (id: string) => {
       
      const { error } = await (supabase as any).from("subjects").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.subjects(requireFamilyId(family)),
      });
    },
  });
}

// ===================
// SCHEDULES HOOKS
// ===================

export function useSchedules(personId?: string) {
  const supabase = createClient();
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: personId
      ? queryKeys.schedulesByPerson(family?.id ?? "", personId)
      : queryKeys.schedules(family?.id ?? ""),
    queryFn: async () => {
      let query = supabase
        .from("schedules")
        .select("*")
        .eq("family_id", requireFamilyId(family));

      if (personId) {
        query = query.eq("person_id", personId);
      }

      const { data, error } = await query.order("day_of_week");

      if (error) throw error;
      return data as Schedule[];
    },
    enabled: !!family?.id,
  });
}

export function useUpsertSchedule() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (schedule: {
      person_id: string;
      day_of_week: number;
      time_slots: unknown[];
    }) => {
      // Check if schedule exists for this person and day
       
      const { data: existingData } = await (supabase as any)
        .from("schedules")
        .select("id")
        .eq("family_id", requireFamilyId(family))
        .eq("person_id", schedule.person_id)
        .eq("day_of_week", schedule.day_of_week)
        .single();
      const existing = existingData as { id: string } | null;

      if (existing) {
        // Update
         
        const { data, error } = await (supabase as any)
          .from("schedules")
          .update({ time_slots: schedule.time_slots })
          .eq("id", existing.id)
          .select()
          .single();

        if (error) throw error;
        return data as Schedule;
      } else {
        // Insert
         
        const { data, error } = await (supabase as any)
          .from("schedules")
          .insert({ ...schedule, family_id: requireFamilyId(family) })
          .select()
          .single();

        if (error) throw error;
        return data as Schedule;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.schedules(requireFamilyId(family)),
      });
    },
  });
}

// ===================
// BIRTHDAYS HOOKS
// ===================

export function useBirthdays() {
  const supabase = createClient();
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: queryKeys.birthdays(family?.id ?? ""),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("birthdays")
        .select("*")
        .eq("family_id", requireFamilyId(family))
        .order("date");

      if (error) throw error;
      return data as Birthday[];
    },
    enabled: !!family?.id,
  });
}

export function useCreateBirthday() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (birthday: {
      name: string;
      date: string;
      person_id?: string | null;
      notify_days_before?: number;
      image_url?: string | null;
    }) => {
       
      const { data, error } = await (supabase as any)
        .from("birthdays")
        .insert({ ...birthday, family_id: requireFamilyId(family) })
        .select()
        .single();

      if (error) throw error;
      return data as Birthday;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.birthdays(requireFamilyId(family)),
      });
    },
  });
}

export function useUpdateBirthday() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: Partial<Birthday> & { id: string }) => {
       
      const { data, error } = await (supabase as any)
        .from("birthdays")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as Birthday;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.birthdays(requireFamilyId(family)),
      });
    },
  });
}

export function useDeleteBirthday() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (id: string) => {
       
      const { error } = await (supabase as any).from("birthdays").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.birthdays(requireFamilyId(family)),
      });
    },
  });
}

// ===================
// GIFT IDEAS HOOKS
// ===================

export function useGiftIdeas(birthdayId: string | null) {
  const supabase = createClient();
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: queryKeys.giftIdeas(birthdayId ?? ""),
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("birthday_gift_ideas")
        .select("*")
        .eq("birthday_id", birthdayId)
        .order("created_at", { ascending: true });

      if (error) {
        // Table may not exist in dev — return empty instead of crashing.
        console.warn("[useGiftIdeas] query failed:", error.message);
        return [] as BirthdayGiftIdea[];
      }
      return data as BirthdayGiftIdea[];
    },
    enabled: !!family?.id && !!birthdayId,
  });
}

export function useCreateGiftIdea() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async ({ birthday_id, text }: { birthday_id: string; text: string }) => {
      const { data, error } = await (supabase as any)
        .from("birthday_gift_ideas")
        .insert({ birthday_id, text, family_id: requireFamilyId(family) })
        .select()
        .single();

      if (error) throw error;
      return data as BirthdayGiftIdea;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.giftIdeas(variables.birthday_id),
      });
    },
  });
}

export function useToggleGiftIdea() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, bought, birthday_id }: { id: string; bought: boolean; birthday_id: string }) => {
      const { data, error } = await (supabase as any)
        .from("birthday_gift_ideas")
        .update({ bought })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as BirthdayGiftIdea;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.giftIdeas(variables.birthday_id),
      });
    },
  });
}

export function useDeleteGiftIdea() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, birthday_id }: { id: string; birthday_id: string }) => {
      const { error } = await (supabase as any)
        .from("birthday_gift_ideas")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.giftIdeas(variables.birthday_id),
      });
    },
  });
}

// ===================
// NOTES HOOKS
// ===================

export function useNotes() {
  const supabase = createClient();
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: queryKeys.notes(family?.id ?? ""),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notes")
        .select("*")
        .eq("family_id", requireFamilyId(family))
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as Note[];
    },
    enabled: !!family?.id,
  });
}

export function useCreateNote() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (input: { content: string; person_id?: string | null }) => {

      const { data, error } = await (supabase as any)
        .from("notes")
        .insert({ content: input.content, person_id: input.person_id ?? null, family_id: requireFamilyId(family) })
        .select()
        .single();

      if (error) throw error;
      return data as Note;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notes(requireFamilyId(family)) });
    },
  });
}

export function useUpdateNote() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async ({ id, content, pinned, person_id }: { id: string; content?: string; pinned?: boolean; person_id?: string | null }) => {
      const updates: Record<string, unknown> = {};
      if (content !== undefined) updates.content = content;
      if (pinned !== undefined) updates.pinned = pinned;
      if (person_id !== undefined) updates.person_id = person_id;
       
      const { data, error } = await (supabase as any)
        .from("notes")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as Note;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notes(requireFamilyId(family)) });
    },
  });
}

export function useDeleteNote() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (id: string) => {
       
      const { error } = await (supabase as any).from("notes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notes(requireFamilyId(family)) });
    },
  });
}

// ===================
// SETTINGS HOOKS
// ===================

export function useSetting<T>(key: string, defaultValue: T) {
  const supabase = createClient();
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: queryKeys.settings(family?.id ?? "", key),
    queryFn: async () => {
       
      const { data, error } = await (supabase as any)
        .from("settings")
        .select("value")
        .eq("family_id", requireFamilyId(family))
        .eq("key", key)
        .maybeSingle();

      if (error) {
        throw error;
      }

      // maybeSingle returns null when no rows found
      if (!data) {
        return defaultValue;
      }

      return (data as { value: unknown }).value as T;
    },
    enabled: !!family?.id,
  });
}

export function useUpdateSetting<T>() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: T }) => {
       
      const { data, error } = await (supabase as any)
        .from("settings")
        .upsert(
          { family_id: requireFamilyId(family), key, value: value as unknown },
          { onConflict: "family_id,key" }
        )
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, { key }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.settings(requireFamilyId(family), key),
      });
    },
  });
}

// ===================
// JOIN CODE REGENERATION
// ===================

export function useRegenerateJoinCode() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family, setFamily } = useFamilyStore();

  return useMutation({
    mutationFn: async ({ ttlHours }: { ttlHours?: number | null }) => {
      const familyId = requireFamilyId(family);

      // Generate a fresh unique code (retry on unique-violation)
      let newCode = generateJoinCode();
      let attempts = 0;
      while (attempts < 10) {
        const expiresAt =
          ttlHours != null && ttlHours > 0
            ? new Date(Date.now() + ttlHours * 3600e3).toISOString()
            : null;

        const { data, error } = await (supabase as any)
          .from("families")
          .update({ join_code: newCode, join_code_expires_at: expiresAt })
          .eq("id", familyId)
          .select()
          .single();

        if (!error) {
          return data as Family;
        }

        // Postgres unique-violation code: 23505
        if ((error as { code?: string }).code === "23505") {
          newCode = generateJoinCode();
          attempts++;
          continue;
        }

        throw error;
      }

      throw new Error("Could not generate a unique join code after 10 attempts.");
    },
    onSuccess: (updatedFamily) => {
      setFamily(updatedFamily);
      queryClient.invalidateQueries({ queryKey: ["family"] });
    },
  });
}

// ===================
// HELPER FUNCTIONS
// ===================

function generateJoinCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
