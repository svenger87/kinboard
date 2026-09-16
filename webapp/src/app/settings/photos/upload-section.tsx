"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Upload, Trash2, Loader2, Images, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  useFamilyPhotos,
  useUploadFamilyPhoto,
  useDeleteFamilyPhoto,
  PhotoRejected,
} from "@/hooks/use-family-photos";
import { ACCEPTED_PHOTO_TYPES, MAX_PHOTO_BYTES } from "@/lib/photo-upload-rules";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/**
 * The uploaded photo library. RFC-009 §4, M1.
 *
 * One or a few files at a time. The folder drop — hundreds at once, with a
 * progress list and resume — is M2, and calls this same route repeatedly
 * rather than needing new plumbing.
 */
export function UploadSection() {
  const t = useTranslations("settings.photos.upload");
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);

  const { data, isLoading } = useFamilyPhotos();
  const upload = useUploadFamilyPhoto();
  const remove = useDeleteFamilyPhoto();

  const photos = data?.photos ?? [];

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files);
    setBusy(list.length);

    let failed = 0;
    // Sequential on purpose: a wall panel on domestic wifi uploading eight
    // 20MB photos in parallel finishes none of them for a long time, and the
    // progress is easier to be honest about one at a time.
    for (const file of list) {
      try {
        await upload.mutateAsync(file);
      } catch (error) {
        failed++;
        if (error instanceof PhotoRejected && error.check.reason === "heic") {
          // Named explicitly: an iPhone household would otherwise be told
          // "invalid file" about every photo they own. RFC-009 §5.
          toast.error(t("heicTitle"), { description: t("heicBody") });
        } else if (error instanceof PhotoRejected && error.check.reason === "size") {
          toast.error(t("tooLargeTitle"), {
            description: t("tooLargeBody", { max: formatBytes(MAX_PHOTO_BYTES) }),
          });
        } else {
          toast.error(t("failedTitle"), { description: file.name });
        }
      } finally {
        setBusy((n) => Math.max(0, n - 1));
      }
    }

    if (failed < list.length) {
      toast.success(t("uploadedTitle", { count: list.length - failed }));
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{t("heading")}</p>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Button
          onClick={() => inputRef.current?.click()}
          disabled={busy > 0}
          className="shrink-0"
        >
          {busy > 0 ? (
            <Loader2 className="size-4 mr-2 animate-spin" />
          ) : (
            <Upload className="size-4 mr-2" />
          )}
          {busy > 0 ? t("uploading", { count: busy }) : t("addButton")}
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_PHOTO_TYPES.join(",")}
          className="hidden"
          onChange={(event) => handleFiles(event.target.files)}
        />
      </div>

      {/* RFC-009 §5: no quota — it is the self-hoster's disk — but they are
          told what the library costs them. */}
      {photos.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {t("summary", { count: photos.length, size: formatBytes(data?.totalBytes ?? 0) })}
        </p>
      )}

      <div className="mt-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t("loading")}
          </div>
        ) : photos.length === 0 ? (
          <div className="rounded-xl border border-border/40 bg-muted/20 px-4 py-8 text-center">
            <Images className="size-8 mx-auto mb-2 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
            {photos.map((photo) => (
              <div key={photo.id} className="group relative aspect-square overflow-hidden rounded-lg">
                {photo.thumbnailUrl ? (
                  /* Contained, not cropped: this grid is how somebody finds
                     the photo they want to delete, and a square crop of a
                     portrait hides exactly what identifies it. */
                  <img
                    src={photo.thumbnailUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 size-full object-contain bg-muted/40"
                  />
                ) : (
                  <div className="absolute inset-0 grid place-items-center bg-muted/40">
                    <AlertCircle className="size-4 text-muted-foreground" />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    remove.mutate(photo.id, {
                      onError: () => toast.error(t("deleteFailed")),
                    });
                  }}
                  aria-label={t("deleteAria")}
                  className="absolute right-1 top-1 rounded-md bg-black/60 p-1 text-white opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
