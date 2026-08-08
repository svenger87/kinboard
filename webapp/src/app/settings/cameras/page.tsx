"use client";

import { Video } from "lucide-react";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/page-header";
import { getDriver } from "@/plugins/cameras/drivers/registry";

const driver = getDriver("go2rtc")!;
const DriverConfigForm = driver.ConfigForm;

export default function CameraSettingsPage() {
  const t = useTranslations("settings.cameras");

  return (
    <main id="main-content" className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="relative z-10 max-w-2xl mx-auto flex flex-col gap-6">
        <PageHeader
          icon={Video}
          title={t("title")}
          subtitle={t("subtitle")}
        />
        <DriverConfigForm />
      </div>
    </main>
  );
}
