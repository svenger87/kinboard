"use client";

import { use, useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Car, Save } from "lucide-react";
import { toast } from "sonner";
import { useVehicle, useSaveVehicle, useDeleteVehicle } from "@/hooks/use-vehicles";
import { useVehicleImageUpload } from "@/hooks/use-vehicle-image-upload";
import { getDriver } from "@/plugins/vehicles/drivers/registry";
import type { Json } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { useFamilyStore } from "@/stores/family-store";

export default function EditVehiclePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const t = useTranslations("settings.vehicles");
  const router = useRouter();
  const { data: vehicle, isPending } = useVehicle(id);
  const { mutateAsync: save } = useSaveVehicle();
  const { mutateAsync: del } = useDeleteVehicle();

  const [nickname, setNickname] = useState("");
  const [color, setColor] = useState<string>("");
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const { family } = useFamilyStore();
  const upload = useVehicleImageUpload();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (vehicle) {
      setNickname(vehicle.nickname);
      setColor(vehicle.color ?? "");
      setConfig(vehicle.config as Record<string, unknown>);
      setImageUrl(vehicle.image_url ?? null);
    }
  }, [vehicle]);

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !family?.id) return;
    try {
      const result = await upload.mutateAsync({ file, familyId: family.id });
      setImageUrl(result.url);
    } catch {
      toast.error(t("imageUploadError"));
    }
  }

  const driver = useMemo(
    () => (vehicle ? getDriver(vehicle.vendor) : undefined),
    [vehicle],
  );

  if (isPending || !vehicle) {
    return (
      <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
        <div className="relative z-10 max-w-3xl mx-auto">
          <p className="text-muted-foreground">{t("loading")}</p>
        </div>
      </main>
    );
  }

  if (!driver) {
    return (
      <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
        <div className="relative z-10 max-w-3xl mx-auto">
          <p className="text-destructive">
            {t("unknownVendor", { vendor: vehicle.vendor })}
          </p>
        </div>
      </main>
    );
  }

  async function handleSave() {
    if (!vehicle) return;
    await save({ id: vehicle.id, nickname, color: color || undefined, config: config as Json, image_url: imageUrl });
    toast.success(t("saved"));
  }

  async function handleDelete() {
    if (!vehicle) return;
    if (!confirm(t("confirmDelete", { name: vehicle.nickname }))) return;
    await del(vehicle.id);
    router.replace("/settings/vehicles");
  }

  const ConfigForm = driver.ConfigForm;

  return (
    <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="relative z-10 max-w-3xl mx-auto flex flex-col gap-6">
        <PageHeader
          icon={Car}
          title={vehicle.nickname}
          backHref="/settings/vehicles"
          actions={
            <div className="flex gap-2">
              <Button variant="destructive" size="sm" onClick={handleDelete}>
                {t("delete")}
              </Button>
              <Button size="sm" onClick={handleSave}>
                <Save className="size-4 mr-2" />
                {t("save")}
              </Button>
            </div>
          }
        />

        <Card className="p-6 space-y-4">
          <div className="space-y-2">
            <Label>{t("image")}</Label>
            <p className="text-sm text-muted-foreground">{t("imageHint")}</p>
          </div>
          <div className="flex items-center gap-4">
            {imageUrl ? (
              <img src={imageUrl} alt={nickname} className="w-32 h-20 object-contain rounded-md border border-border" />
            ) : (
              <div className="w-32 h-20 rounded-md border border-dashed border-border flex items-center justify-center text-muted-foreground">
                <Car className="size-8" />
              </div>
            )}
            <div className="flex flex-col gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleImageChange}
                className="hidden"
              />
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={upload.isPending}>
                {upload.isPending ? t("uploading") : t("uploadImage")}
              </Button>
              {imageUrl && (
                <Button variant="ghost" size="sm" onClick={() => setImageUrl(null)}>
                  {t("removeImage")}
                </Button>
              )}
            </div>
          </div>
        </Card>

        <Card>
          <div className="p-6 flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label>{t("nickname")}</Label>
              <Input value={nickname} onChange={(e) => setNickname(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label>{t("color")}</Label>
              <Input
                type="text"
                placeholder="#22c55e"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
            </div>
          </div>
        </Card>

        <Card>
          <div className="p-6">
            <ConfigForm
              vehicle={{ ...vehicle, config: config as typeof vehicle.config }}
              onConfigChange={(next) =>
                setConfig(next as Record<string, unknown>)
              }
            />
          </div>
        </Card>

        <div className="flex items-center justify-between">
          <Button asChild variant="ghost" size="sm">
            <Link href="/settings/vehicles">{t("back")}</Link>
          </Button>
          <div className="flex gap-2">
            <Button variant="destructive" onClick={handleDelete}>
              {t("delete")}
            </Button>
            <Button onClick={handleSave}>
              <Save className="size-4 mr-2" />
              {t("save")}
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
