"use client";

import { Video, Settings } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { getDriver } from "@/plugins/cameras/drivers/registry";
import { useKeyboardShortcuts, useSwipeNavigation } from "@/hooks";
import { useTranslations } from "next-intl";

const driver = getDriver("go2rtc")!;
const DriverCard = driver.Card;

export default function CamerasPage() {
  useKeyboardShortcuts();
  useSwipeNavigation();
  const t = useTranslations("cameras");
  const tCommon = useTranslations("common");

  return (
    <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="page-gradient" />
      <div className="relative z-10 max-w-7xl mx-auto flex flex-col gap-6">
        <PageHeader
          icon={Video}
          title={t("title")}
          actions={
            <Link href="/settings/cameras">
              <Button variant="outline" size="sm">
                <Settings className="size-4 mr-2" />
                {tCommon("settings")}
              </Button>
            </Link>
          }
        />
        <DriverCard />
      </div>
    </main>
  );
}
