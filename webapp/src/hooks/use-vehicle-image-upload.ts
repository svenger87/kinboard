import { useMutation } from "@tanstack/react-query";

interface UploadResult {
  url: string;
  path: string;
}

interface UploadOptions {
  file: File;
  familyId: string;
}

export function useVehicleImageUpload() {
  return useMutation<UploadResult, Error, UploadOptions>({
    mutationFn: async ({ file, familyId }) => {
      const formData = new FormData();
      formData.append("image", file);
      formData.append("family_id", familyId);

      const res = await fetch("/api/vehicles/upload-image", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const error = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(error.error || "Upload failed");
      }

      return res.json() as Promise<UploadResult>;
    },
  });
}
