"use client";

import { Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/page-header";
import { getDriver } from "@/plugins/energy/drivers/registry";

const driver = getDriver("generic-ha-energy")!;
const DriverConfigForm = driver.ConfigForm;

export default function EnergySettingsPage() {
  const t = useTranslations("settings.homeassistantEnergy");

  return (
    <main id="main-content" className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="relative z-10 max-w-2xl mx-auto flex flex-col gap-6">
        <PageHeader
          iconSlot={
            <div className="p-2.5 rounded-xl bg-warning/10 shrink-0">
              <Zap className="size-6 text-warning" strokeWidth={1.5} />
            </div>
          }
          title={t("title")}
          subtitle={t("subtitle")}
          backHref="/settings"
        />
        <DriverConfigForm />
      </div>
    </main>
  );
}
