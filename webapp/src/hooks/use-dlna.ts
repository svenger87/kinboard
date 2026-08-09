"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFamilyStore } from "@/stores/family-store";
import { SETTINGS_KEYS } from "@/lib/settings-keys";

/**
 * The family's DLNA photo source.
 *
 * Shaped like use-immich.ts on purpose — status / albums / photos / save /
 * test / disconnect — so the settings page and the screensaver treat the two
 * sources the same way. Unlike Immich there is no credential, so the settings
 * blob is plain (see lib/dlna-settings.ts).
 */

export interface DlnaSettings {
  description_url: string;
  control_url: string;
  friendly_name: string;
  selected_container?: string;
  selected_container_title?: string;
}

export interface DlnaContainer {
  id: string;
  title: string;
  childCount: number | null;
}

export interface DlnaPhoto {
  id: string;
  title: string;
  /** Already proxied through /api/dlna/image. */
  url: string;
  thumbnailUrl: string | null;
  mimeType: string | null;
  resolution: string | null;
  date: string | null;
}

export function useDlnaStatus() {
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: ["dlna-settings", family?.id],
    queryFn: async (): Promise<DlnaSettings | null> => {
      if (!family?.id) return null;
      const r = await fetch(
        `/api/settings?family_id=${family.id}&key=${SETTINGS_KEYS.dlna}`,
      );
      if (!r.ok) return null;
      const data = (await r.json()) as { value?: DlnaSettings | null };
      return data.value ?? null;
    },
    enabled: !!family?.id,
  });
}

/**
 * The containers inside one container.
 *
 * `objectId` walks the tree — DLNA has folders, not albums, and every server
 * arranges them differently, so the settings page lets the owner descend
 * rather than guessing where the photos are.
 */
export function useDlnaContainers(objectId = "0", enabled = true) {
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: ["dlna-containers", family?.id, objectId],
    queryFn: async (): Promise<{ containers: DlnaContainer[]; photoCount: number }> => {
      if (!family?.id) return { containers: [], photoCount: 0 };
      const r = await fetch(
        `/api/dlna/albums?family_id=${family.id}&object_id=${encodeURIComponent(objectId)}`,
      );
      if (!r.ok) return { containers: [], photoCount: 0 };
      return r.json();
    },
    enabled: enabled && !!family?.id,
  });
}

export function useDlnaPhotos(limit = 50, random = false, enabled = true) {
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: ["dlna-photos", family?.id, limit, random],
    queryFn: async (): Promise<DlnaPhoto[]> => {
      if (!family?.id) return [];
      const params = new URLSearchParams({
        family_id: family.id,
        limit: String(limit),
        random: String(random),
      });
      const r = await fetch(`/api/dlna/photos?${params}`);
      if (!r.ok) return [];
      const data = (await r.json()) as { photos?: DlnaPhoto[] };
      return data.photos ?? [];
    },
    enabled: enabled && !!family?.id,
    // The LAN server is fast and its contents change when someone drops files
    // on the NAS; an hour is plenty stale for a screensaver.
    staleTime: 60 * 60 * 1000,
  });
}

/** Probe a description URL before saving it. */
export function useTestDlnaConnection() {
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (
      descriptionUrl: string,
    ): Promise<{ ok: boolean; friendlyName?: string; controlUrl?: string; error?: string }> => {
      if (!family?.id) throw new Error("No family");
      const r = await fetch("/api/dlna/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ family_id: family.id, description_url: descriptionUrl }),
      });
      if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
      return r.json();
    },
  });
}

export function useSaveDlnaSettings() {
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (settings: DlnaSettings) => {
      if (!family?.id) throw new Error("No family");
      const r = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          family_id: family.id,
          key: SETTINGS_KEYS.dlna,
          value: settings,
        }),
      });
      if (!r.ok) throw new Error("Failed to save DLNA settings");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dlna-settings"] });
      queryClient.invalidateQueries({ queryKey: ["dlna-containers"] });
      queryClient.invalidateQueries({ queryKey: ["dlna-photos"] });
    },
  });
}

export function useDisconnectDlna() {
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async () => {
      if (!family?.id) throw new Error("No family");
      const r = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          family_id: family.id,
          key: SETTINGS_KEYS.dlna,
          value: null,
        }),
      });
      if (!r.ok) throw new Error("Failed to disconnect");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dlna-settings"] });
      queryClient.invalidateQueries({ queryKey: ["dlna-photos"] });
    },
  });
}
