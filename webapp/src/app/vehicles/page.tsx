"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Car } from "lucide-react";
import { useVehicles } from "@/hooks/use-vehicles";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { getDriver } from "@/plugins/vehicles/drivers/registry";

export default function VehiclesPage() {
  const t = useTranslations("vehicles");
  const router = useRouter();
  const { data: vehicles = [], isPending } = useVehicles();
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeId && vehicles.length > 0) setActiveId(vehicles[0].id);
  }, [vehicles, activeId]);

  if (isPending) {
    return (
      <div className="p-8 max-w-2xl mx-auto space-y-3">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  if (vehicles.length === 0) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <PageHeader title={t("title")} icon={Car} />
        <EmptyState
          icon={Car}
          title={t("emptyState")}
          action={{ label: t("addFirstVehicle"), onClick: () => router.push("/settings/vehicles/new") }}
        />
      </div>
    );
  }

  const active = vehicles.find((v) => v.id === activeId) ?? vehicles[0];
  const driver = getDriver(active.vendor);

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <PageHeader
        title={t("title")}
        icon={Car}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/settings/vehicles">{t("manage")}</Link>
          </Button>
        }
      />

      {vehicles.length > 1 && (
        <Tabs value={active.id} onValueChange={setActiveId}>
          <TabsList>
            {vehicles.map((v) => (
              <TabsTrigger key={v.id} value={v.id}>
                {v.nickname}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {driver ? (
        <motion.div
          key={active.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <driver.Card vehicle={active} />
        </motion.div>
      ) : (
        <Card className="p-6">
          {t("unknownVendor", { vendor: active.vendor })}
        </Card>
      )}
    </div>
  );
}
