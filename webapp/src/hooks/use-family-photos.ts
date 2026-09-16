"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFamilyStore } from "@/stores/family-store";
import { checkPhotoUpload, type PhotoUploadCheck } from "@/lib/photo-upload-rules";

/**
 * The uploaded photo library. RFC-009.
 *
 * Shaped like use-dlna / use-icloud so the screensaver and the Photos page
 * treat it as one more source. What is different is that Kinboard owns these
 * photos, so this hook also uploads and deletes.
 */

export interface FamilyPhoto {
  id: string;
  /** Signed, and good for an hour — see /api/photos. */
  url: string | null;
  thumbnailUrl: string | null;
  /** Post-rotation, so it is the shape the photo actually renders at. */
  width: number | null;
  height: number | null;
  takenAt: string | null;
  uploadedAt: string;
  byteSize: number;
}

export function useFamilyPhotos(enabled = true) {
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: ["family-photos", family?.id],
    queryFn: async (): Promise<{ photos: FamilyPhoto[]; totalBytes: number }> => {
      const res = await fetch(`/api/photos?family_id=${family!.id}`);
      if (!res.ok) throw new Error("Failed to load photos");
      return res.json();
    },
    enabled: enabled && !!family?.id,
    // The URLs expire after an hour; refetching well inside that keeps a wall
    // panel that never reloads from slowly filling with dead images.
    staleTime: 30 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
  });
}

export class PhotoRejected extends Error {
  constructor(readonly check: Exclude<PhotoUploadCheck, { ok: true }>) {
    super(check.reason);
    this.name = "PhotoRejected";
  }
}

export function useUploadFamilyPhoto() {
  const { family } = useFamilyStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: File): Promise<FamilyPhoto> => {
      if (!family?.id) throw new Error("No family");

      // Checked here as well as in the route, against the same module, so a
      // 30MB video does not get uploaded in full before being refused.
      const check = checkPhotoUpload({ type: file.type, size: file.size });
      if (!check.ok) throw new PhotoRejected(check);

      const body = new FormData();
      body.append("photo", file);
      body.append("family_id", family.id);

      const res = await fetch("/api/photos/upload", { method: "POST", body });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? "upload_failed");
      }
      return (await res.json()).photo;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["family-photos", family?.id] });
    },
  });
}

export function useDeleteFamilyPhoto() {
  const { family } = useFamilyStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!family?.id) throw new Error("No family");
      const res = await fetch(`/api/photos/${id}?family_id=${family.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete_failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["family-photos", family?.id] });
    },
  });
}
