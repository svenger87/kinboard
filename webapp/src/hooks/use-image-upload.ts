import { useMutation } from "@tanstack/react-query";

interface UploadResult {
  url: string;
  path: string;
}

interface UploadOptions {
  file: File;
  familyId: string;
}

export function useImageUpload() {
  return useMutation<UploadResult, Error, UploadOptions>({
    mutationFn: async ({ file, familyId }) => {
      const formData = new FormData();
      formData.append("image", file);
      formData.append("family_id", familyId);

      const res = await fetch("/api/recipes/upload-image", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Upload failed");
      }

      return res.json();
    },
  });
}
