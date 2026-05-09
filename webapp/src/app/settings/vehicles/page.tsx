"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Car, Plus, Pencil, Trash2 } from "lucide-react";
import { useVehicles, useDeleteVehicle } from "@/hooks/use-vehicles";
import { getDriver } from "@/plugins/vehicles/drivers/registry";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";

export default function VehiclesSettingsPage() {
  const t = useTranslations("settings.vehicles");
  const { data: vehicles = [] } = useVehicles();
  const { mutateAsync: deleteVehicle } = useDeleteVehicle();

  return (
    <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="relative z-10 max-w-2xl mx-auto flex flex-col gap-6">
        <PageHeader
          icon={Car}
          title={t("title")}
          subtitle={t("subtitle")}
          backHref="/settings"
          actions={
            <Button asChild>
              <Link href="/settings/vehicles/new">
                <Plus className="size-4 mr-2" />
                {t("addVehicle")}
              </Link>
            </Button>
          }
        />

        <GlassCard>
          <div className="p-6">
            {vehicles.length === 0 ? (
              <div className="text-center py-8">
                <Car className="size-12 mx-auto text-muted-foreground/50 mb-4" />
                <h3 className="font-medium mb-2">{t("emptyTitle")}</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {t("emptyDescription")}
                </p>
                <Button asChild variant="outline">
                  <Link href="/settings/vehicles/new">
                    <Plus className="size-4 mr-2" />
                    {t("addVehicle")}
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {vehicles.map((v) => {
                  const driver = getDriver(v.vendor);
                  const configured = driver?.isConfigured(v.config) ?? false;
                  const Icon = driver?.icon;
                  return (
                    <div
                      key={v.id}
                      className="flex items-center gap-3 p-3 rounded-lg border border-border bg-background/50"
                    >
                      {Icon && <Icon className="size-5 text-muted-foreground shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium truncate">{v.nickname}</span>
                          {!configured && (
                            <Badge variant="outline" className="text-xs">
                              {t("needsConfig")}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground truncate">
                          {driver ? t(`driver.${driver.id as "tesla" | "generic-ev"}`) : v.vendor}
                        </p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button asChild variant="ghost" size="icon" className="size-8">
                          <Link href={`/settings/vehicles/${v.id}`}>
                            <Pencil className="size-4" />
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive hover:text-destructive"
                          onClick={async () => {
                            if (confirm(t("confirmDelete", { name: v.nickname }))) {
                              await deleteVehicle(v.id);
                            }
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </GlassCard>
      </div>
    </main>
  );
}
