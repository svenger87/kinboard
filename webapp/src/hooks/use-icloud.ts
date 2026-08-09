"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFamilyStore } from "@/stores/family-store";
import { SETTINGS_KEYS } from "@/lib/settings-keys";

/** The family's iCloud Shared Album, as configured and as read. */
export interface IcloudSettings {
  token: string;
  album_name?: string;
}

export interface IcloudPhoto {
  id: string;
  caption: string | null;
  dateCreated: string | null;
  /** Apple's signed URL. Short-lived — never store it. */
  url: string;
  width: number;
  height: number;
}

export function useIcloudStatus() {
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: ["icloud-settings", family?.id],
    queryFn: async (): Promise<IcloudSettings | null> => {
      if (!family?.id) return null;
      const r = await fetch(`/api/settings?family_id=${family.id}&key=${SETTINGS_KEYS.icloud}`);
      if (!r.ok) return null;
      const data = (await r.json()) as { value?: IcloudSettings | null };
      return data.value ?? null;
    },
    enabled: !!family?.id,
  });
}

export function useIcloudPhotos(limit = 100, enabled = true) {
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: ["icloud-photos", family?.id, limit],
    queryFn: async (): Promise<IcloudPhoto[]> => {
      if (!family?.id) return [];
      const r = await fetch(`/api/icloud/photos?family_id=${family.id}&limit=${limit}`);
      if (!r.ok) return [];
      const data = (await r.json()) as { photos?: IcloudPhoto[] };
      return data.photos ?? [];
    },
    enabled: enabled && !!family?.id,
    // Apple's URLs last about an hour, so the list is refreshed well inside
    // that. This is the reason the value is not cached longer.
    staleTime: 30 * 60 * 1000,
  });
}

export function useTestIcloudAlbum() {
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (
      link: string,
    ): Promise<{ ok: boolean; token?: string; streamName?: string; photoCount?: number; error?: string }> => {
      if (!family?.id) throw new Error("No family");
      const r = await fetch("/api/icloud/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ family_id: family.id, link }),
      });
      if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
      return r.json();
    },
  });
}

export function useSaveIcloudSettings() {
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (settings: IcloudSettings | null) => {
      if (!family?.id) throw new Error("No family");
      const r = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          family_id: family.id,
          key: SETTINGS_KEYS.icloud,
          value: settings,
        }),
      });
      if (!r.ok) throw new Error("Failed to save iCloud settings");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["icloud-settings"] });
      queryClient.invalidateQueries({ queryKey: ["icloud-photos"] });
    },
  });
}
