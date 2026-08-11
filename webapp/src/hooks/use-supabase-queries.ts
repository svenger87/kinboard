"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { invalidateFamilyToken, primeFamilyToken } from "@/lib/supabase/family-token";
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
  schoolHolidays: (familyId: string) => ["school-holidays", familyId] as const,
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

/**
 * Sign this device back in by itself, if it can prove who it is.
 *
 * The AuthGuard runs this on any page with no family in the store, so a wall
 * display that has been power-cycled comes back to the dashboard rather than to
 * the join screen. Like the rest of the device lookups it used to read
 * `devices` straight from PostgREST, which RLS has refused since 1.6.0 — the
 * restore silently stopped working and left a 401 on every anonymous page.
 *
 * It goes through the same routes the join screen uses, with one deliberate
 * difference: **the fingerprint is not sent.** Recognition by fingerprint is a
 * guess, and it is only fair to act on a guess when a person is there to
 * confirm it — which is what the "Sign back in" button is. Restoring without
 * being asked has to be certain, so this path accepts nothing but the device's
 * own hardware id.
 */
export function useRestoreDeviceSession() {
  const supabase = createClient();
  const { setFamily, setDevice, setPeople } = useFamilyStore();

  return useMutation({
    mutationFn: async () => {
      const hardwareId = await getDeviceId();

      const recognised = await fetch("/api/session/recognize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ hardware_id: hardwareId }),
      });
      if (!recognised.ok) return null;

      const { devices } = (await recognised.json()) as {
        devices: { device: { id: string }; match: "hardware" | "fingerprint" }[];
      };
      const known = devices.find((d) => d.match === "hardware");
      if (!known) return null;

      const resumed = await fetch("/api/session/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ device_id: known.device.id, hardware_id: hardwareId }),
      });
      if (!resumed.ok) return null;

      const { family, device, token, expiresAt } = (await resumed.json()) as {
        family: Family;
        device: Device;
        token: string | null;
        expiresAt: number | null;
      };

      // Adopt the session before reading anything through it — see the same
      // note in useQuickRejoin.
      if (token && expiresAt) primeFamilyToken(token, expiresAt);
      else invalidateFamilyToken();

      await persistDeviceId(hardwareId);

       
      const { data: people } = await (supabase as any)
        .from("people")
        .select("*")
        .eq("family_id", family.id)
        .order("created_at");

      return { family, device, people: (people || []) as Person[] };
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
      const hardwareId = await getDeviceId();
      const fingerprint = getDeviceFingerprint();

      // Joining happens server-side now.
      //
      // This used to read `families` by join_code straight from PostgREST with
      // the anon key. Row-level security forbids that — `families` holds the
      // join codes — and it was never really validation anyway: a client that
      // can read the table can read every family's code.
      //
      // The response sets an HttpOnly session cookie, which is what every
      // later request authenticates with.
      const response = await fetch("/api/session/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ joinCode, deviceName, hardwareId, fingerprint }),
      });

      if (!response.ok) {
        throw new Error("Family not found for that join code");
      }

      const { family, device } = (await response.json()) as {
        family: Family;
        device: Device;
      };

      await persistDeviceId(hardwareId);
      // A session exists now; drop the "no session" answer the client may have
      // cached while this page was anonymous, so the next query mints a token
      // straight away rather than waiting the negative-cache window out.
      invalidateFamilyToken();

      // Now that a session exists, this call carries the family token and RLS
      // lets it through.
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
  const { setFamily, setDevice } = useFamilyStore();

  return useMutation({
    mutationFn: async ({
      familyName,
      deviceName,
    }: {
      familyName: string;
      deviceName: string;
    }) => {
      const hardwareId = await getDeviceId();
      const fingerprint = getDeviceFingerprint();

      // Server-side for the same reason as joining: under row-level security
      // `anon` cannot insert into `families`, because the policy checks a
      // family claim the caller cannot have yet — the family doesn't exist.
      // Without this a fresh install couldn't get past its first screen.
      const response = await fetch("/api/session/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ familyName, deviceName, hardwareId, fingerprint }),
      });

      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Could not create the family");
      }

      const { family, device } = (await response.json()) as {
        family: Family;
        device: Device;
      };

      await persistDeviceId(hardwareId);
      invalidateFamilyToken();

      return { family, device };
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

/**
 * Ask the server whether this device is one a family already has.
 *
 * Used to be a PostgREST query with the anon key. Row-level security has
 * refused it since 1.6.0 — see /api/session/recognize, which does the lookup
 * with the service role and answers with only what an unauthenticated caller
 * may be told: the family's name and the device's name.
 */
export function useFindDeviceByFingerprint() {
  return useMutation({
    mutationFn: async (fingerprint: string) => {
      const hardwareId = await getDeviceId();
      if (!fingerprint && !hardwareId) return null;

      const response = await fetch("/api/session/recognize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hardware_id: hardwareId, fingerprint }),
      });
      if (!response.ok) return null;

      const { devices } = (await response.json()) as {
        devices: {
          device: { id: string; name: string; last_seen: string | null };
          family: { name: string };
          match: "hardware" | "fingerprint";
        }[];
      };

      return devices.map((entry) => ({
        device: {
          id: entry.device.id,
          name: entry.device.name,
          last_seen: entry.device.last_seen ?? "",
        },
        // The family id is deliberately not in the response — nothing on the
        // join screen needs it, and it is one less thing to hand out before
        // anyone has authenticated.
        family: { id: "", name: entry.family.name },
      }));
    },
  });
}

/**
 * Sign a recognised device back in.
 *
 * This used to update `devices` through PostgREST and then fill the client
 * store — which meant that even before RLS blocked it, a "rejoined" device had
 * no session cookie and no family token, so the next request it made was
 * unauthenticated. /api/session/resume issues a real session, the same one
 * joining with a code does.
 */
export function useQuickRejoin() {
  const { setFamily, setDevice, setPeople } = useFamilyStore();

  return useMutation({
    mutationFn: async ({ deviceId }: { deviceId: string }) => {
      const hardwareId = await getDeviceId();
      const fingerprint = getDeviceFingerprint();

      const response = await fetch("/api/session/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_id: deviceId,
          hardware_id: hardwareId,
          fingerprint,
        }),
      });
      if (!response.ok) {
        throw new Error("could not sign this device back in");
      }

      const { family, device, token, expiresAt } = (await response.json()) as {
        family: { id: string; name: string };
        device: { id: string; name: string };
        token: string | null;
        expiresAt: number | null;
      };

      // A session exists now. Until the client knows that, every query still
      // rides the "no session" answer cached while this page was anonymous and
      // goes out unauthenticated — which RLS answers, correctly and silently,
      // with nothing at all. The route already minted the token, so adopt it;
      // fall back to invalidating if minting failed there.
      if (token && expiresAt) primeFamilyToken(token, expiresAt);
      else invalidateFamilyToken();

      // The hardware id the server just recorded is now this device's, so keep
      // it where the next visit will find it.
      await persistDeviceId(hardwareId);

      setFamily(family as Family);
      setDevice(device as never);

      // People are family-scoped and the session now exists, so this reads
      // through the normal authenticated path rather than needing the route to
      // return them.
      const supabase = createClient();
       
      const { data: people } = await (supabase as any)
        .from("people")
        .select("*")
        .eq("family_id", family.id)
        .order("created_at");
      setPeople((people ?? []) as never);

      return { family, device };
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

// CALDAV HOOKS
// ===================

/**
 * CalDAV calendars are managed through /api/caldav/* rather than direct
 * PostgREST writes (the way ICS feeds are). The reason is the password:
 * it has to land in integration_secrets, which is service_role-only, so
 * the browser can never do that write itself.
 */

export interface DiscoveredCaldavCalendar {
  url: string;
  displayName: string;
  color: string | null;
  ctag: string | null;
  readOnly: boolean;
  components: string[];
}

export interface CaldavConnectionInput {
  server_url: string;
  username: string;
  password: string;
  /** Reuse the stored password for an already-connected calendar. */
  calendar_id?: string;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? `Request failed: ${response.status}`);
  }
  return data;
}

/** Probe a server and list its calendars. Nothing is persisted. */
export function useCaldavDiscover() {
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (input: CaldavConnectionInput) => {
      const result = await postJson<{
        ok: boolean;
        calendars?: DiscoveredCaldavCalendar[];
        error?: string;
      }>("/api/caldav/discover", { family_id: requireFamilyId(family), ...input });

      // Discovery answers 200 with ok:false for *expected* failures (bad
      // password, wrong host) so the settings form can show the reason
      // inline instead of treating it as a crash.
      if (!result.ok) throw new Error(result.error ?? "Discovery failed");
      return result.calendars ?? [];
    },
  });
}

export function useCreateCaldavCalendar() {
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (input: {
      name: string;
      color: string;
      server_url: string;
      calendar_url: string;
      username: string;
      password: string;
      person_id?: string | null;
      is_holidays?: boolean;
      is_waste_collection?: boolean;
      read_only?: boolean;
    }) =>
      postJson<{
        ok: true;
        calendar: Calendar;
        sync: { success: boolean; error?: string; synced?: number };
      }>("/api/caldav/calendars", { family_id: requireFamilyId(family), ...input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendars", requireFamilyId(family)] });
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });
}

export function useUpdateCaldavCalendar() {
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async ({
      calendar_id,
      ...updates
    }: {
      calendar_id: string;
      name?: string;
      color?: string;
      person_id?: string | null;
      is_holidays?: boolean;
      is_waste_collection?: boolean;
      username?: string;
      /** Empty string means "keep the stored password". */
      password?: string;
    }) => {
      const response = await fetch("/api/caldav/calendars", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          family_id: requireFamilyId(family),
          calendar_id,
          ...updates,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? `Update failed: ${response.status}`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendars", requireFamilyId(family)] });
    },
  });
}

export function useDeleteCaldavCalendar() {
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (calendarId: string) => {
      const response = await fetch("/api/caldav/calendars", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          family_id: requireFamilyId(family),
          calendar_id: calendarId,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? `Delete failed: ${response.status}`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendars", requireFamilyId(family)] });
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });
}

/** Manual "Sync now" for every CalDAV calendar in the family. */
export function useCaldavSync() {
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async () =>
      postJson<{
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
      }>("/api/calendar/sync-caldav", { family_id: requireFamilyId(family) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendars", requireFamilyId(family)] });
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });
}

// ===================
// EVENTS HOOKS
// ===================

/**
 * Find a calendar in the already-cached list.
 *
 * Event writes need to know which provider backs the calendar so they
 * push to the right endpoint. The calendars query is loaded on every
 * surface that can create an event, so reading the cache avoids an extra
 * round-trip on the critical path. A cache miss falls through to the
 * Google path, which no-ops for calendars it doesn't own.
 */
function findCachedCalendar(
  queryClient: ReturnType<typeof useQueryClient>,
  familyId: string,
  calendarId: string,
): Calendar | undefined {
  return queryClient
    .getQueryData<Calendar[]>(["calendars", familyId])
    ?.find((c) => c.id === calendarId);
}

/**
 * Push one event mutation to a CalDAV server.
 *
 * Returns the failure message instead of throwing: the local write has
 * already succeeded by the time this runs, so a server that's down must
 * not roll back the UI. Callers surface the message as a toast — unlike
 * the Google path's silent console.warn, because a self-hosted CalDAV
 * server being unreachable is common enough that the user needs to know
 * their edit hasn't propagated yet.
 */
async function pushToCaldav(
  method: "POST" | "PATCH" | "DELETE",
  body: Record<string, unknown>,
): Promise<string | null> {
  try {
    const response = await fetch("/api/caldav/events", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) return null;
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    return data.error ?? `CalDAV sync failed (HTTP ${response.status})`;
  } catch (err) {
    return err instanceof Error ? err.message : "CalDAV sync failed";
  }
}

export type EventWithCalendar = Event &{ calendar: { family_id: string; person_id: string | null; color: string; name: string; is_holidays: boolean; is_waste_collection: boolean } };

export function useEvents(startDate?: string, endDate?: string, options?: { enabled?: boolean }) {
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
      return data as EventWithCalendar[];
    },
    enabled: (options?.enabled ?? true) && !!family?.id,
  });
}

/** Fetch a single event by id, scoped to the current family. Used for
 * deep-link (`?event=`) and search-result opens where the event may fall
 * outside the currently loaded date range. */
export function useEventById(id?: string) {
  const supabase = createClient();
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: ["events", family?.id ?? "", "byId", id ?? ""],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select(`
          *,
          calendar:calendars!inner(family_id, person_id, color, name, is_holidays, is_waste_collection)
        `)
        .eq("id", id as string)
        .eq("calendar.family_id", requireFamilyId(family))
        .maybeSingle();

      if (error) throw error;
      return data as EventWithCalendar | null;
    },
    enabled: !!id && !!family?.id,
  });
}

export function useCreateEvent() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();
  const tCaldav = useTranslations("calendar.caldavToast");
  const tGoogle = useTranslations("calendar.googleToast");

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

      // Route by provider: a CalDAV-backed calendar gets a PUT to its
      // server, anything else keeps the existing Google push (which
      // itself no-ops for local-only calendars).
      const calendar = findCachedCalendar(
        queryClient,
        requireFamilyId(family),
        event.calendar_id,
      );
      if (calendar?.caldav_url) {
        const caldavError = await pushToCaldav("POST", {
          family_id: requireFamilyId(family),
          event_id: createdEvent.id,
          calendar_id: event.calendar_id,
        });
        // Deliberately not thrown: the event exists locally and must
        // still appear. The toast tells the user it hasn't reached the
        // server; the next sync will retry nothing, so the repair path
        // in PATCH /api/caldav/events picks it up on the next edit.
        if (caldavError) toast.error(tCaldav("pushFailed"), { description: caldavError });
        return createdEvent;
      }

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
          // The CalDAV branch above already toasts on a failed push. Google
          // only logged, so an event that never reached the phone looked
          // exactly like one that did.
          console.warn("Failed to push event to Google Calendar");
          toast.warning(tGoogle("pushFailed"));
        }
      } catch (err) {
        console.warn("Error pushing event to Google:", err);
        toast.warning(tGoogle("pushFailed"));
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
  const tCaldav = useTranslations("calendar.caldavToast");
  const tGoogle = useTranslations("calendar.googleToast");

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

      // CalDAV replaces the whole resource, so the server route re-reads
      // the row we just wrote rather than taking a field delta here.
      const calendar = findCachedCalendar(
        queryClient,
        requireFamilyId(family),
        updatedEvent.calendar_id,
      );
      if (calendar?.caldav_url) {
        const caldavError = await pushToCaldav("PATCH", {
          family_id: requireFamilyId(family),
          event_id: id,
        });
        if (caldavError) toast.error(tCaldav("updateFailed"), { description: caldavError });
        return updatedEvent;
      }

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
            toast.warning(tGoogle("updateFailed"));
          }
        } catch (err) {
          console.warn("Error updating event on Google:", err);
          toast.warning(tGoogle("updateFailed"));
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
  const tCaldav = useTranslations("calendar.caldavToast");
  const tGoogle = useTranslations("calendar.googleToast");

  return useMutation({
    mutationFn: async (id: string) => {
      // The event row is needed before the local delete to know which
      // provider owns it — afterwards there's nothing left to look up.
      const { data: existing } = await (supabase as any)
        .from("events")
        .select("calendar_id")
        .eq("id", id)
        .maybeSingle();

      const calendar = existing
        ? findCachedCalendar(queryClient, requireFamilyId(family), existing.calendar_id)
        : undefined;

      if (calendar?.caldav_url) {
        const caldavError = await pushToCaldav("DELETE", {
          family_id: requireFamilyId(family),
          event_id: id,
        });
        // A server-side delete that failed would leave the event on the
        // phone and gone from Kinboard — until the next sync pulls it
        // straight back. Keeping the local row and saying why is less
        // confusing than a delete that silently undoes itself.
        if (caldavError) {
          toast.error(tCaldav("deleteFailed"), { description: caldavError });
          throw new Error(caldavError);
        }
      } else {
        // Delete from Google first, and keep the local row if that fails —
        // the same reasoning the CalDAV branch above spells out. Deleting
        // locally while the event survives on Google means the next sync
        // pulls it straight back, so the delete appears to undo itself with
        // nothing to explain why.
        //
        // The response was previously not checked at all, so a 500 from
        // Google counted as a successful delete.
        let googleError: string | null = null;
        try {
          const response = await fetch("/api/google/events", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              family_id: requireFamilyId(family),
              event_id: id,
            }),
          });
          if (!response.ok) {
            googleError = `Google Calendar returned ${response.status}`;
          }
        } catch (err) {
          console.warn("Error deleting event from Google:", err);
          googleError = err instanceof Error ? err.message : String(err);
        }
        if (googleError) {
          toast.error(tGoogle("deleteFailed"), { description: googleError });
          throw new Error(googleError);
        }
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


// ===================
// School holidays
// ===================

/**
 * School holiday periods, as inclusive local calendar days.
 *
 * The attention engine reads these server-side to keep the school reminders
 * quiet during a break; this is the household's way of putting them in. Dates
 * are plain `YYYY-MM-DD` strings end to end — the column is DATE, the rules
 * compare strings, and introducing a Date here would only add a timezone the
 * rest of the feature deliberately does without.
 */
export interface SchoolHoliday {
  id: string;
  family_id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  created_at: string;
  updated_at: string;
}

export function useSchoolHolidays() {
  const supabase = createClient();
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: queryKeys.schoolHolidays(family?.id ?? ""),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("school_holidays")
        .select("*")
        .eq("family_id", requireFamilyId(family))
        .order("starts_on");

      if (error) throw error;
      return data as SchoolHoliday[];
    },
    enabled: !!family?.id,
  });
}

export function useCreateSchoolHoliday() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (holiday: { name: string; starts_on: string; ends_on: string }) => {
      const { data, error } = await (supabase as any)
        .from("school_holidays")
        .insert({ ...holiday, family_id: requireFamilyId(family) })
        .select()
        .single();

      if (error) throw error;
      return data as SchoolHoliday;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.schoolHolidays(requireFamilyId(family)),
      });
    },
  });
}

export function useUpdateSchoolHoliday() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<SchoolHoliday> & { id: string }) => {
      const { data, error } = await (supabase as any)
        .from("school_holidays")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as SchoolHoliday;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.schoolHolidays(requireFamilyId(family)),
      });
    },
  });
}

export function useDeleteSchoolHoliday() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("school_holidays").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.schoolHolidays(requireFamilyId(family)),
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

/** Fetch a single setting row fresh from the DB (bypasses the query cache).
 * Shared by `useSetting`'s queryFn and by feature hooks (e.g. Bring!) that
 * need to merge a partial update onto the *stored* value rather than a
 * possibly-cold `queryClient` cache entry. Falls back to `defaultValue`
 * only when no row exists yet. */
export async function fetchSetting<T>(
  supabase: ReturnType<typeof createClient>,
  familyId: string,
  key: string,
  defaultValue: T
): Promise<T> {

  const { data, error } = await (supabase as any)
    .from("settings")
    .select("value")
    .eq("family_id", familyId)
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
}

export function useSetting<T>(key: string, defaultValue: T) {
  const supabase = createClient();
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: queryKeys.settings(family?.id ?? "", key),
    queryFn: async () => fetchSetting<T>(supabase, requireFamilyId(family), key, defaultValue),
    enabled: !!family?.id,
  });
}

export function useUpdateSetting<T>() {
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: T }) => {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ family_id: requireFamilyId(family), key, value }),
      });
      if (!res.ok) throw new Error("Failed to save setting");
      return res.json();
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
// FAMILY RENAME
// ===================

export function useRenameFamily() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { family, setFamily } = useFamilyStore();

  return useMutation({
    mutationFn: async ({ name }: { name: string }) => {
      const familyId = requireFamilyId(family);

      const { data, error } = await (supabase as any)
        .from("families")
        .update({ name, updated_at: new Date().toISOString() })
        .eq("id", familyId)
        .select()
        .single();

      if (error) throw error;
      return data as Family;
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
