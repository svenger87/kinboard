"use client";

import { Zap } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { getDriver } from "@/plugins/energy/drivers/registry";
import { useKeyboardShortcuts, useSwipeNavigation } from "@/hooks";
import { useTranslations } from "next-intl";

const driver = getDriver("generic-ha-energy")!;
const DriverCard = driver.Card;

export default function EnergyPage() {
  useKeyboardShortcuts();
  useSwipeNavigation();
  const t = useTranslations("energy");

  return (
    <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="page-gradient" />
      <div className="relative z-10 max-w-6xl mx-auto flex flex-col gap-6">
        <PageHeader
          icon={Zap}
          title={t("title")}
          backHref="/"
          actions={
            <Button variant="ghost" size="icon" asChild aria-label={t("settingsAria")}>
              <Link href="/settings/energy">
                <Zap className="size-5" />
              </Link>
            </Button>
          }
        />
        <DriverCard />
      </div>
    </main>
  );
}
