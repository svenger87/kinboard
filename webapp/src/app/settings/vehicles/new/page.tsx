"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Car } from "lucide-react";
import { useSaveVehicle } from "@/hooks/use-vehicles";
import { VEHICLE_DRIVERS } from "@/plugins/vehicles/drivers/registry";
import type { Json } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GlassCard } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";

export default function NewVehiclePage() {
  const t = useTranslations("settings.vehicles");
  const router = useRouter();
  const { mutateAsync: save } = useSaveVehicle();
  const [vendor, setVendor] = useState<string>(VEHICLE_DRIVERS[0]?.id ?? "");
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    setBusy(true);
    try {
      const driver = VEHICLE_DRIVERS.find((d) => d.id === vendor);
      const created = await save({
        vendor: vendor as "tesla" | "generic-ev",
        nickname:
          nickname.trim() ||
          (driver ? t(`driver.${driver.id as "tesla" | "generic-ev"}`) : "Vehicle"),
        config: (driver?.defaultConfig ?? {}) as Json,
      });
      router.replace(`/settings/vehicles/${created.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="relative z-10 max-w-xl mx-auto flex flex-col gap-6">
        <PageHeader
          icon={Car}
          title={t("addVehicle")}
          backHref="/settings/vehicles"
        />

        <GlassCard>
          <div className="p-6 flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label>{t("nickname")}</Label>
              <Input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder={t("nicknamePlaceholder")}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label>{t("vendor")}</Label>
              <div className="flex flex-col gap-2">
                {VEHICLE_DRIVERS.map((d) => {
                  const Icon = d.icon;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setVendor(d.id)}
                      className={`flex items-center gap-3 p-3 rounded-md border text-left transition ${
                        vendor === d.id
                          ? "border-primary bg-primary/10"
                          : "border-border hover:bg-muted/50"
                      }`}
                    >
                      <Icon className="size-5 shrink-0" />
                      <div>
                        <div className="font-medium">
                          {t(`driver.${d.id as "tesla" | "generic-ev"}`)}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {t(`driverDescription.${d.id as "tesla" | "generic-ev"}`)}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <Button onClick={handleCreate} disabled={busy} className="w-full">
              {busy ? t("creating") : t("create")}
            </Button>
          </div>
        </GlassCard>
      </div>
    </main>
  );
}
