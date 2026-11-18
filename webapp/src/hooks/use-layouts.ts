import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useFamilyStore } from "@/stores/family-store";
import { isPinRequired, relockSettings } from "@/lib/pin-session";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import type { Layout, LayoutDefaults, LayoutItem } from "@/lib/layouts/types";
import { queryKeys, useSetting } from "./use-supabase-queries";

const NO_DEFAULTS: LayoutDefaults = { portrait: null, landscape: null };

/**
 * A layout route's refusal: the server's error code ("stale", "pin_required", ...),
 * the HTTP status and, for a rejected arrangement, the item it is about.
 */
export class LayoutRequestError extends Error {
  constructor(
    public code: string,
    public status: number,
    public itemId?: string,
  ) {
    super(code);
    this.name = "LayoutRequestError";
  }
}

async function request<T>(url: string, method: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (await isPinRequired(r)) {
    relockSettings();
    throw new LayoutRequestError("pin_required", r.status);
  }
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string; itemId?: string };
    throw new LayoutRequestError(j.error ?? "request_failed", r.status, j.itemId);
  }
  return r.status === 204 ? (undefined as T) : ((await r.json()) as T);
}

/** The family's layouts, oldest first. */
export function useLayouts() {
  const supabase = createClient();
  const { family } = useFamilyStore();
  const familyId = family?.id ?? "";
  return useQuery({
    queryKey: ["layouts", familyId],
    enabled: !!familyId,
    queryFn: async (): Promise<Layout[]> => {
      const { data, error } = await supabase
        .from("layouts" as never)
        .select("*")
        .eq("family_id", familyId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Layout[];
    },
  });
}

/** Which layout each orientation uses on kiosks. */
export function useLayoutDefaults() {
  return useSetting<LayoutDefaults>(SETTINGS_KEYS.layoutDefaults, NO_DEFAULTS);
}

/**
 * This device's assignment, read from the database rather than the store: the
 * store's copy of is_kiosk can be stale, and resolveLayout depends on it.
 * Undefined while loading, or with no device on this screen.
 */
export function useOwnDeviceLayout() {
  const supabase = createClient();
  const { family, device } = useFamilyStore();
  const familyId = family?.id ?? "";
  const deviceId = device?.id ?? "";
  return useQuery({
    queryKey: ["layouts", familyId, "device", deviceId],
    enabled: !!familyId && !!deviceId,
    queryFn: async (): Promise<{ id: string; layoutId: string | null; isKiosk: boolean }> => {
      const { data, error } = await supabase
        .from("devices")
        .select("id, is_kiosk, layout_id")
        .eq("id", deviceId)
        .single();
      if (error) throw error;
      const d = data as unknown as { id: string; is_kiosk: boolean; layout_id: string | null };
      return { id: d.id, layoutId: d.layout_id, isKiosk: d.is_kiosk };
    },
  });
}

function useAfterWrite(also: string[] = []) {
  const qc = useQueryClient();
  const { family } = useFamilyStore();
  const familyId = family?.id ?? "";
  return () => {
    qc.invalidateQueries({ queryKey: ["layouts", familyId] });
    if (also.includes("settings")) qc.invalidateQueries({ queryKey: ["settings", familyId] });
    if (also.includes("devices")) qc.invalidateQueries({ queryKey: queryKeys.devices(familyId) });
  };
}

/** Save a change; `updated_at` is the stamp the editor loaded, echoed exactly. A stale one fails with code "stale". */
export function useSaveLayout() {
  const onSuccess = useAfterWrite();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; screensaver?: LayoutItem[]; updated_at: string }) =>
      request<{ layout: Layout }>(`/api/layouts/${id}`, "PATCH", body).then((r) => r.layout),
    onSuccess,
  });
}

/** A layout just created, with the ids of the copied items that did not fit its size (`from: <id>`; otherwise empty). */
export type CreatedLayout = Layout & { dropped: string[] };

export function useCreateLayout() {
  const onSuccess = useAfterWrite();
  return useMutation({
    mutationFn: (body: { name: string; width: number; height: number; from?: string }) =>
      request<{ layout: Layout; dropped?: string[] }>("/api/layouts", "POST", body).then(
        (r): CreatedLayout => ({ ...r.layout, dropped: r.dropped ?? [] }),
      ),
    onSuccess,
  });
}

export function useDeleteLayout() {
  // A deleted layout may have been a default, which the route clears, and its screens go back to built-in.
  const onSuccess = useAfterWrite(["settings", "devices"]);
  return useMutation({
    mutationFn: (id: string) => request<void>(`/api/layouts/${id}`, "DELETE"),
    onSuccess,
  });
}

export function useDuplicateLayout() {
  const onSuccess = useAfterWrite();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      request<{ layout: Layout }>(`/api/layouts/${id}/duplicate`, "POST", { name }).then((r) => r.layout),
    onSuccess,
  });
}

/** Give a device a layout, or null to clear it. */
export function useAssignLayout() {
  const onSuccess = useAfterWrite(["devices"]);
  return useMutation({
    mutationFn: ({ deviceId, layoutId }: { deviceId: string; layoutId: string | null }) =>
      request<unknown>(`/api/devices/${deviceId}/layout`, "PUT", { layout_id: layoutId }),
    onSuccess,
  });
}

export function useSetLayoutDefaults() {
  const onSuccess = useAfterWrite(["settings"]);
  return useMutation({
    mutationFn: (defaults: LayoutDefaults) =>
      request<{ defaults: LayoutDefaults }>("/api/layouts/defaults", "PUT", defaults).then((r) => r.defaults),
    onSuccess,
  });
}
