import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFamilyStore } from "@/stores/family-store";
import type { CameraConfig, CameraSettings } from "@/types/home-assistant";
import { safeRandomUUID } from "@/lib/uuid";
import { SETTINGS_KEYS } from "@/lib/settings-keys";

const cameraSettingsKey = (familyId: string | undefined) => ["camera-settings", familyId];

async function fetchCameraSettings(familyId: string): Promise<CameraSettings> {
  try {
    const response = await fetch(`/api/settings?family_id=${familyId}&key=${SETTINGS_KEYS.cameras}`);
    if (!response.ok) {
      if (response.status === 404) return { cameras: [] };
      throw new Error("Failed to fetch camera settings");
    }
    const data = await response.json();
    return (data.value as CameraSettings) || { cameras: [] };
  } catch (error) {
    console.warn("[Cameras] Settings fetch error:", error);
    return { cameras: [] };
  }
}

// Hook to get camera settings
export function useCameraSettings() {
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: cameraSettingsKey(family?.id),
    queryFn: async (): Promise<CameraSettings> => {
      if (!family?.id) return { cameras: [] };
      return fetchCameraSettings(family.id);
    },
    enabled: !!family?.id,
    staleTime: 30000,
  });
}

/**
 * The camera list as it is *now*, for a mutation about to rewrite it.
 *
 * Every camera mutation rewrites the whole `cameras` array, and each read
 * that array out of `useCameraSettings()` — a value captured when the
 * component last rendered. Two changes in quick succession therefore both
 * computed from the same starting list, and the second overwrote the first:
 * delete two cameras and the one you deleted first comes back, because the
 * second write still had it. `staleTime: 30000` widened that window
 * considerably.
 *
 * Reading through the query client instead returns the freshest value and
 * joins an in-flight refetch rather than racing it.
 */
function useCurrentCameras() {
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return async (): Promise<CameraConfig[]> => {
    if (!family?.id) return [];
    const settings = await queryClient.fetchQuery({
      queryKey: cameraSettingsKey(family.id),
      queryFn: () => fetchCameraSettings(family.id),
      staleTime: 0,
    });
    return settings?.cameras ?? [];
  };
}

// Hook to get all enabled cameras
export function useCameras() {
  const { data: settings, isLoading, error, refetch } = useCameraSettings();

  const cameras = settings?.cameras
    ?.filter((cam) => cam.enabled)
    ?.sort((a, b) => a.position - b.position) || [];

  return { cameras, isLoading, error, refetch };
}

// Hook to save camera settings
export function useSaveCameraSettings() {
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (settings: CameraSettings) => {
      if (!family?.id) throw new Error("No family");

      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          family_id: family.id,
          key: SETTINGS_KEYS.cameras,
          value: settings,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save camera settings");
      }

      return response.json();
    },
    onSuccess: (_data, settings) => {
      // Seed the cache with what we just wrote before invalidating, so a
      // second mutation started right away computes from this list rather
      // than from whatever the refetch hasn't returned yet.
      queryClient.setQueryData(cameraSettingsKey(family?.id), settings);
      queryClient.invalidateQueries({ queryKey: cameraSettingsKey(family?.id) });
    },
  });
}

// Hook to add a camera
export function useAddCamera() {
  const currentCameras = useCurrentCameras();
  const { mutateAsync: saveSettings } = useSaveCameraSettings();

  return useMutation({
    mutationFn: async (camera: Omit<CameraConfig, "id" | "position" | "created_at">) => {
      const cameras = await currentCameras();

      const newCamera: CameraConfig = {
        ...camera,
        id: safeRandomUUID(),
        position: cameras.length,
        created_at: new Date().toISOString(),
      };

      await saveSettings({ cameras: [...cameras, newCamera] });
      return newCamera;
    },
  });
}

// Hook to update a camera
export function useUpdateCamera() {
  const currentCameras = useCurrentCameras();
  const { mutateAsync: saveSettings } = useSaveCameraSettings();

  return useMutation({
    mutationFn: async ({ cameraId, updates }: { cameraId: string; updates: Partial<CameraConfig> }) => {
      const cameras = await currentCameras();
      const updatedCameras = cameras.map((cam) =>
        cam.id === cameraId ? { ...cam, ...updates } : cam
      );

      await saveSettings({ cameras: updatedCameras });
    },
  });
}

// Hook to delete a camera
export function useDeleteCamera() {
  const currentCameras = useCurrentCameras();
  const { mutateAsync: saveSettings } = useSaveCameraSettings();

  return useMutation({
    mutationFn: async (cameraId: string) => {
      const cameras = await currentCameras();
      const updatedCameras = cameras
        .filter((cam) => cam.id !== cameraId)
        .map((cam, index) => ({ ...cam, position: index }));

      await saveSettings({ cameras: updatedCameras });
    },
  });
}

// Hook to reorder cameras
export function useReorderCameras() {
  const currentCameras = useCurrentCameras();
  const { mutateAsync: saveSettings } = useSaveCameraSettings();

  return useMutation({
    mutationFn: async (cameraIds: string[]) => {
      const cameras = await currentCameras();
      const cameraMap = new Map(cameras.map((c) => [c.id, c]));

      const reorderedCameras = cameraIds
        .map((id, index) => {
          const camera = cameraMap.get(id);
          return camera ? { ...camera, position: index } : null;
        })
        .filter((c): c is CameraConfig => c !== null);

      await saveSettings({ cameras: reorderedCameras });
    },
  });
}
