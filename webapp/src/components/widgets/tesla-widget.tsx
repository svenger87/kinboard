"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { Car, Battery, Zap, Gauge } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useHomeAssistantStatus,
  useTeslaConfig,
  useHomeAssistantEntityStates,
} from "@/hooks";

interface TeslaWidgetProps {
  className?: string;
}

function TeslaSkeleton() {
  const t = useTranslations("tesla");
  return (
    <Card aria-label={t("loadingAria")} aria-busy="true">
      <CardContent className="p-6">
        <div className="flex items-center gap-3 mb-3">
          <Skeleton className="size-10 rounded-xl" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
        <Skeleton className="h-2 w-full rounded-full" />
        <div className="flex justify-between mt-3">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-20" />
        </div>
      </CardContent>
    </Card>
  );
}

export function TeslaWidget({ className = "" }: TeslaWidgetProps) {
  const t = useTranslations("tesla");
  const { data: settings, isLoading: loadingSettings } = useHomeAssistantStatus();
  const teslaConfig = useTeslaConfig();

  const isConnected = !!settings?.url && !!settings?.access_token;
  const isConfigured = !!teslaConfig?.battery_level;

  // Collect entity IDs for fetching
  const entityIds = useMemo(() => {
    if (!teslaConfig) return [];
    return [
      teslaConfig.battery_level,
      teslaConfig.battery_range,
      teslaConfig.charging_rate,
      teslaConfig.charger_power,
      teslaConfig.charging_state,
    ].filter((id): id is string => !!id);
  }, [teslaConfig]);

  const { data: entities = [], isLoading: loadingEntities } =
    useHomeAssistantEntityStates(entityIds, isConnected && isConfigured);

  // Entity value helpers
  const entityMap = useMemo(
    () => new Map(entities.map((e) => [e.entity_id, e])),
    [entities]
  );

  const getVal = (id: string | undefined): number => {
    if (!id) return 0;
    const entity = entityMap.get(id);
    if (!entity) return 0;
    const value = parseFloat(entity.state);
    return isNaN(value) ? 0 : value;
  };

  const getState = (id: string | undefined): string => {
    if (!id) return "unknown";
    const entity = entityMap.get(id);
    return entity?.state || "unknown";
  };

  // Return null if not configured or dashboard display disabled
  if (!loadingSettings && (!isConnected || !isConfigured || teslaConfig?.show_on_dashboard === false)) {
    return null;
  }

  if (loadingSettings || loadingEntities) {
    return <TeslaSkeleton />;
  }

  const batteryLevel = getVal(teslaConfig?.battery_level);
  const batteryRange = getVal(teslaConfig?.battery_range);
  const chargingRate = getVal(teslaConfig?.charging_rate || teslaConfig?.charger_power);
  const chargingState = getState(teslaConfig?.charging_state);
  const isCharging = chargingState === "charging" || chargingRate > 0;

  // Battery color based on level
  const batteryColor =
    batteryLevel > 60
      ? "text-success"
      : batteryLevel > 20
        ? "text-warning"
        : "text-destructive";
  const batteryBg =
    batteryLevel > 60
      ? "bg-success"
      : batteryLevel > 20
        ? "bg-warning"
        : "bg-destructive";

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, delay: 0.4 }}
    >
      <Card
        className={`overflow-hidden hover:shadow-lg transition-shadow accent-border-top ${className}`}
      >
        <CardContent className="p-6">
          {/* Header: Icon + Battery % */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-month-primary/10">
                <Car
                  className="size-6 text-month-primary"
                  strokeWidth={1.5}
                />
              </div>
              <div>
                <p className={`text-3xl font-display font-light tracking-tight ${batteryColor}`}>
                  {Math.round(batteryLevel)}
                  <span className="text-base text-muted-foreground">%</span>
                </p>
              </div>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-1 justify-end">
                <Gauge className="size-3.5 text-muted-foreground" />
                <span className="text-lg font-semibold">
                  {Math.round(batteryRange)}
                  <span className="text-xs text-muted-foreground ml-0.5">km</span>
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{t("rangeLabel")}</p>
            </div>
          </div>

          {/* Battery bar */}
          <div
            className="relative h-2 bg-muted rounded-full overflow-hidden"
            role="progressbar"
            aria-valuenow={Math.round(batteryLevel)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t("batteryAria", { percent: Math.round(batteryLevel) })}
          >
            <div
              className={`absolute inset-y-0 left-0 ${batteryBg} rounded-full transition-all duration-500`}
              style={{ width: `${Math.min(100, batteryLevel)}%` }}
            />
          </div>

          {/* Charging status */}
          <div className="flex items-center justify-between mt-3">
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Battery className="size-3.5" />
              <span>{t("chargeStateLabel")}</span>
            </div>
            {isCharging ? (
              <div className="flex items-center gap-1 text-sm font-medium text-energy-grid">
                <Zap className="size-3.5" />
                <span>{chargingRate.toFixed(1)} kW</span>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">{t("notCharging")}</span>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
