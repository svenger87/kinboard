import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFamilyStore } from "@/stores/family-store";
import type { CameraConfig, CameraSettings } from "@/types/home-assistant";

// Hook to get camera settings
export function useCameraSettings() {
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: ["camera-settings", family?.id],
    queryFn: async (): Promise<CameraSettings> => {
      if (!family?.id) return { cameras: [] };

      try {
        const response = await fetch(`/api/settings?family_id=${family.id}&key=cameras`);
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
    },
    enabled: !!family?.id,
    staleTime: 30000,
  });
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
          key: "cameras",
          value: settings,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save camera settings");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["camera-settings", family?.id] });
    },
  });
}

// Hook to add a camera
export function useAddCamera() {
  const { data: settings } = useCameraSettings();
  const { mutateAsync: saveSettings } = useSaveCameraSettings();

  return useMutation({
    mutationFn: async (camera: Omit<CameraConfig, "id" | "position" | "created_at">) => {
      const cameras = settings?.cameras || [];

      const newCamera: CameraConfig = {
        ...camera,
        id: crypto.randomUUID(),
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
  const { data: settings } = useCameraSettings();
  const { mutateAsync: saveSettings } = useSaveCameraSettings();

  return useMutation({
    mutationFn: async ({ cameraId, updates }: { cameraId: string; updates: Partial<CameraConfig> }) => {
      const cameras = settings?.cameras || [];
      const updatedCameras = cameras.map((cam) =>
        cam.id === cameraId ? { ...cam, ...updates } : cam
      );

      await saveSettings({ cameras: updatedCameras });
    },
  });
}

// Hook to delete a camera
export function useDeleteCamera() {
  const { data: settings } = useCameraSettings();
  const { mutateAsync: saveSettings } = useSaveCameraSettings();

  return useMutation({
    mutationFn: async (cameraId: string) => {
      const cameras = settings?.cameras || [];
      const updatedCameras = cameras
        .filter((cam) => cam.id !== cameraId)
        .map((cam, index) => ({ ...cam, position: index }));

      await saveSettings({ cameras: updatedCameras });
    },
  });
}

// Hook to reorder cameras
export function useReorderCameras() {
  const { data: settings } = useCameraSettings();
  const { mutateAsync: saveSettings } = useSaveCameraSettings();

  return useMutation({
    mutationFn: async (cameraIds: string[]) => {
      const cameras = settings?.cameras || [];
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
