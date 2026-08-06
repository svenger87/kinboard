"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useTranslations, useLocale } from "next-intl";
import { getIntlLocale } from "@/i18n/intl-locale";
import {
  Zap,
  Sun,
  Battery,
  Home,
  Settings,
  RefreshCw,
  Loader2,
  TrendingUp,
  TrendingDown,
  Check,
  Search,
  Monitor,
  LineChart,
  Plus,
  X,
  ArrowLeft,
} from "lucide-react";
import { DEFAULT_EXPORT_PRICE, DEFAULT_IMPORT_PRICE, parsePrice } from "@/lib/tariff";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useHomeAssistantStatus,
  useEnergyConfig,
  useSaveEnergyConfig,
  useHomeAssistantEntityStates,
  useMultiEntityHistory,
  useEnergyPeriodStats,
  useHomeAssistantEntities,
} from "@/hooks";
import { EnergyFlow } from "@/components/home-assistant/energy-flow";
import { PowerChart } from "@/components/home-assistant/power-chart";
import { EnergyChart } from "@/components/home-assistant/energy-chart";
import { BatteryChart } from "@/components/home-assistant/battery-chart";
import { StatisticsCard, StatisticsGrid } from "@/components/home-assistant/statistics-card";
import type { EnergyConfig, HAEntity } from "@/types/home-assistant";
import type { EnergyDriver } from "./types";

// ============================================================================
// EnergyCard — the /energy dashboard (extracted from app/energy/page.tsx)
// ============================================================================

type TimePeriod = "today" | "week" | "month" | "year";
type ChartType = "power" | "energy";

function EnergyCard() {
  const t = useTranslations("energy");
  const locale = useLocale();
  const intlLocale = getIntlLocale(locale);
  const { data: settings, isLoading: loadingSettings, refetch } = useHomeAssistantStatus();
  const energyConfig = useEnergyConfig();
  const [selectedPeriod, setSelectedPeriod] = useState<TimePeriod>("today");
  const [chartType, setChartType] = useState<ChartType>("power");

  // Track current date so charts reset at midnight
  const [currentDay, setCurrentDay] = useState(() => new Date().toDateString());
  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date().toDateString();
      if (now !== currentDay) setCurrentDay(now);
    }, 60000);
    return () => clearInterval(interval);
  }, [currentDay]);

  const isConnected = !!settings?.url && !!settings?.access_token;
  const isConfigured = !!energyConfig?.solar_power || !!energyConfig?.grid_power;

  // Collect entity IDs for power chart and current values
  const powerEntityIds = useMemo(() => {
    if (!energyConfig) return [];
    return [
      energyConfig.solar_power,
      energyConfig.home_consumption,
      energyConfig.grid_import_power,
      energyConfig.grid_export_power,
      energyConfig.battery_power,
      energyConfig.battery_charge_power,
      energyConfig.battery_discharge_power,
      energyConfig.battery_soc,
      energyConfig.grid_to_battery_power,
    ].filter((id): id is string => !!id);
  }, [energyConfig]);

  // Fetch current power values
  const {
    data: powerEntities = [],
    isLoading: loadingPower,
    isFetching,
  } = useHomeAssistantEntityStates(powerEntityIds, isConnected && isConfigured);

  // Fetch energy statistics for the selected period
  const periodStats = useEnergyPeriodStats(
    isConnected && isConfigured ? energyConfig : undefined,
    selectedPeriod === "year" ? "month" : selectedPeriod
  );

  // Create entity map for quick lookup
  const entityMap = useMemo(
    () => new Map(powerEntities.map((e) => [e.entity_id, e])),
    [powerEntities]
  );

  const getCurrentValue = useCallback((entityId: string | undefined): number => {
    if (!entityId) return 0;
    const entity = entityMap.get(entityId);
    if (!entity) return 0;
    const value = parseFloat(entity.state);
    return isNaN(value) ? 0 : value;
  }, [entityMap]);

  const solarPower = getCurrentValue(energyConfig?.solar_power);
  const batterySoc = getCurrentValue(energyConfig?.battery_soc);

  const batteryChargePower = energyConfig?.battery_charge_power
    ? getCurrentValue(energyConfig.battery_charge_power)
    : Math.max(getCurrentValue(energyConfig?.battery_power), 0);
  const batteryDischargePower = energyConfig?.battery_discharge_power
    ? getCurrentValue(energyConfig.battery_discharge_power)
    : Math.abs(Math.min(getCurrentValue(energyConfig?.battery_power), 0));
  const batteryPower = batteryChargePower - batteryDischargePower;

  const gridImportPower = energyConfig?.grid_import_power
    ? getCurrentValue(energyConfig.grid_import_power)
    : Math.max(getCurrentValue(energyConfig?.grid_power), 0);
  const gridExportPower = energyConfig?.grid_export_power
    ? getCurrentValue(energyConfig.grid_export_power)
    : Math.abs(Math.min(getCurrentValue(energyConfig?.grid_power), 0));
  const gridPower = gridImportPower - gridExportPower;

  const gridToBatteryPower = getCurrentValue(energyConfig?.grid_to_battery_power);

  const homePower = Math.max(0, gridImportPower - gridExportPower + solarPower - batteryPower);

  const solarTotal = periodStats.solarToday;
  const gridImport = periodStats.gridImport;
  const gridExport = periodStats.gridExport;
  const batteryIn = periodStats.batteryIn;
  const batteryOut = periodStats.batteryOut;
  const gridToBattery = periodStats.gridToBattery;

  const selfConsumption = solarTotal > 0 ? ((solarTotal - gridExport) / solarTotal) * 100 : 0;
  const periodHomeConsumption = gridImport + solarTotal + batteryOut - gridExport - batteryIn;
  const autarky = periodHomeConsumption > 0 ? ((periodHomeConsumption - gridImport) / periodHomeConsumption) * 100 : 0;

  const importCost = (energyConfig?.cost_per_kwh_import ?? DEFAULT_IMPORT_PRICE) * gridImport;
  const exportRevenue = (energyConfig?.cost_per_kwh_export ?? DEFAULT_EXPORT_PRICE) * gridExport;
  const netCost = importCost - exportRevenue;

  const gridToBatteryCost = (energyConfig?.cost_per_kwh_import ?? DEFAULT_IMPORT_PRICE) * gridToBattery;
  const solarToBattery = Math.max(0, batteryIn - gridToBattery);
  const solarChargingRatio = batteryIn > 0 ? (solarToBattery / batteryIn) * 100 : 100;

  const historyStartTime = useMemo(() => {
    const now = new Date(currentDay);
    switch (selectedPeriod) {
      case "today":
        return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      case "week": {
        const startOfWeek = new Date(now);
        const dayOfWeek = startOfWeek.getDay();
        const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        startOfWeek.setDate(startOfWeek.getDate() - daysToMonday);
        startOfWeek.setHours(0, 0, 0, 0);
        return startOfWeek.toISOString();
      }
      case "month": {
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        startOfMonth.setHours(0, 0, 0, 0);
        return startOfMonth.toISOString();
      }
      case "year": {
        const startOfYear = new Date(now.getFullYear(), 0, 1);
        startOfYear.setHours(0, 0, 0, 0);
        return startOfYear.toISOString();
      }
    }
  }, [selectedPeriod, currentDay]);

  const historyEndTime = useMemo(() => {
    if (selectedPeriod === "today") return undefined;
    void currentDay;
    return new Date().toISOString();
  }, [selectedPeriod, currentDay]);

  const { data: powerHistory = [], isLoading: loadingHistory } = useMultiEntityHistory(
    powerEntityIds,
    historyStartTime,
    historyEndTime,
    {
      enabled: isConnected && isConfigured && powerEntityIds.length > 0,
      significantChangesOnly: false,
    }
  );

  const batterySocEntityIds = useMemo(() => {
    if (!energyConfig?.battery_soc) return [];
    return [energyConfig.battery_soc];
  }, [energyConfig]);

  const { data: batteryHistory = [] } = useMultiEntityHistory(
    batterySocEntityIds,
    historyStartTime,
    historyEndTime,
    {
      enabled: isConnected && isConfigured && batterySocEntityIds.length > 0,
      significantChangesOnly: false,
    }
  );

  const energyEntityIds = useMemo(() => {
    if (!energyConfig) return [];
    return [
      energyConfig.solar_energy_today,
      energyConfig.battery_energy_in,
      energyConfig.battery_energy_out,
      energyConfig.grid_import,
      energyConfig.grid_export,
    ].filter((id): id is string => !!id);
  }, [energyConfig]);

  const { data: energyHistory = [], isLoading: loadingEnergyHistory } = useMultiEntityHistory(
    energyEntityIds,
    historyStartTime,
    historyEndTime,
    {
      enabled: isConnected && isConfigured && energyEntityIds.length > 0,
      significantChangesOnly: false,
    }
  );

  const periodLabel = selectedPeriod === "today" ? t("periodToday")
    : selectedPeriod === "week" ? t("periodWeek")
    : selectedPeriod === "year" ? t("periodYear")
    : t("periodMonth");

  // Loading state
  if (loadingSettings) {
    return (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-muted/10 border border-border/20">
              <Skeleton className="size-5 rounded" />
              <div className="flex-1">
                <Skeleton className="h-3 w-20 mb-1.5" />
                <Skeleton className="h-5 w-16" />
              </div>
            </div>
          ))}
        </div>
        <Card>
          <CardContent className="p-6 flex flex-col items-center gap-4">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-40 w-full max-w-md rounded-xl" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-5 w-40 mb-4" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Not connected state
  if (!isConnected) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Zap className="size-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <h2 className="text-lg font-medium mb-2">{t("notConnectedTitle")}</h2>
          <p className="text-muted-foreground mb-6">
            {t("notConnectedDescription")}
          </p>
          <Link href="/settings/homeassistant">
            <Button>
              <Settings className="size-4 mr-2" />
              {t("notConnectedAction")}
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  // Not configured state
  if (!isConfigured) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Sun className="size-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <h2 className="text-lg font-medium mb-2">{t("notConfiguredTitle")}</h2>
          <p className="text-muted-foreground mb-6">
            {t("notConfiguredDescription")}
          </p>
          <Link href="/settings/energy">
            <Button>
              <Settings className="size-4 mr-2" />
              {t("notConfiguredAction")}
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  // Suppress unused warning
  void loadingPower;

  // Main dashboard content (no outer <main> or PageHeader — parent page provides those)
  return (
    <div className="flex flex-col gap-6">
      {/* Quick Stats Bar */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid grid-cols-2 md:grid-cols-4 gap-3"
      >
        <div className="flex items-center gap-3 p-3 rounded-xl bg-energy-solar/10 border border-energy-solar/20">
          <Sun className="size-5 text-energy-solar shrink-0" />
          <div>
            <p className="text-kiosk-primary text-energy-solar">
              {solarTotal.toFixed(1)}<span className="text-sm font-normal ml-1">kWh</span>
            </p>
            <p className="text-kiosk-label mt-1.5">{t("quickSolar")}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3 rounded-xl bg-energy-consumption/10 border border-energy-consumption/20">
          <Home className="size-5 text-energy-consumption shrink-0" />
          <div>
            <p className="text-kiosk-primary text-energy-consumption">
              {Math.max(0, periodHomeConsumption).toFixed(1)}<span className="text-sm font-normal ml-1">kWh</span>
            </p>
            <p className="text-kiosk-label mt-1.5">{t("quickConsumption")}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3 rounded-xl bg-success/10 border border-success/20">
          <div className="relative size-10 shrink-0" role="img" aria-label={t("quickAutarkyAria", { percent: Math.max(0, Math.min(100, autarky)).toFixed(0) })}>
            <svg viewBox="0 0 40 40" className="size-10 -rotate-90" aria-hidden="true">
              <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeOpacity="0.1" strokeWidth="3" />
              <circle
                cx="20" cy="20" r="16"
                fill="none"
                className="text-success"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 16}`}
                strokeDashoffset={`${2 * Math.PI * 16 * (1 - Math.max(0, Math.min(100, autarky)) / 100)}`}
              />
            </svg>
            <TrendingUp className="size-4 text-success absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
          </div>
          <div>
            <p className="text-kiosk-primary text-success">
              {Math.max(0, Math.min(100, autarky)).toFixed(0)}<span className="text-sm font-normal">%</span>
            </p>
            <p className="text-kiosk-label mt-1.5">{t("quickAutarky")}</p>
          </div>
        </div>
        {(() => {
          const isNeutral = Math.abs(netCost) < 1;
          const tone = isNeutral ? "neutral" : netCost > 0 ? "cost" : "savings";
          const wrapClass =
            tone === "cost"
              ? "bg-destructive/10 border border-destructive/20"
              : tone === "savings"
              ? "bg-success/10 border border-success/20"
              : "bg-muted/30 border border-border/40";
          const valueClass =
            tone === "cost" ? "text-destructive" : tone === "savings" ? "text-success" : "text-foreground";
          const Icon = tone === "cost" ? TrendingDown : TrendingUp;
          const iconClass =
            tone === "cost" ? "text-destructive" : tone === "savings" ? "text-success" : "text-muted-foreground";
          const label = tone === "cost" ? t("quickCost") : tone === "savings" ? t("quickSavings") : t("quickBalanced");
          return (
            <div className={`flex items-center gap-3 p-3 rounded-xl ${wrapClass}`}>
              <Icon className={`size-5 shrink-0 ${iconClass}`} />
              <div>
                <p className={`text-kiosk-primary ${valueClass}`}>
                  {Math.abs(netCost).toFixed(2)}<span className="text-sm font-normal ml-1">€</span>
                </p>
                <p className="text-kiosk-label mt-1.5">{label}</p>
              </div>
            </div>
          );
        })()}
      </motion.div>

      {/* Energy Flow Visualization + stat column */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <Card>
          <CardContent className="p-6">
            <h2 className="text-lg font-medium mb-4">{t("energyFlowHeading")}</h2>
            {/* The diagram used to share this card with a stat column that
                repeated Solar yield, Autarky and Grid export — all three appear
                again in the statistics section below, so on a wide display the
                same numbers rendered twice while the diagram was squeezed into
                half the width (audit KB-37). The diagram now owns the card. */}
            <div className="flex flex-col gap-6">
              <div className="min-w-0">
                {/* Animated marching-dash SVG flow on ALL widths — the SVG
                    scales down on mobile (was a static chevron row before). */}
                <EnergyFlow
                  solarPower={solarPower}
                  batteryPower={batteryPower}
                  batterySoc={batterySoc}
                  gridPower={gridPower}
                  homePower={homePower}
                  gridToBatteryPower={gridToBatteryPower}
                />
              </div>

            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Statistics Cards */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <h2 className="text-lg font-medium mb-4">{t("statisticsHeading", { period: periodLabel })}</h2>
        <StatisticsGrid columns={4}>
          <StatisticsCard
            title={t("statSolarYield")}
            value={solarTotal}
            unit="kWh"
            icon={<Sun className="size-4" />}
            color="solar"
          />
          <StatisticsCard
            title={t("statBatteryCharged")}
            value={batteryIn}
            unit="kWh"
            icon={<Battery className="size-4" />}
            color="battery"
          />
          <StatisticsCard
            title={t("statGridImport")}
            value={gridImport}
            unit="kWh"
            icon={<Zap className="size-4" />}
            color="grid"
          />
          <StatisticsCard
            title={t("statGridExport")}
            value={gridExport}
            unit="kWh"
            icon={<Zap className="size-4" />}
            color="success"
          />
          <StatisticsCard
            title={t("statSelfConsumption")}
            value={selfConsumption}
            format="percentage"
            color="success"
          />
          <StatisticsCard
            title={t("statAutarky")}
            value={Math.max(0, Math.min(100, autarky))}
            format="percentage"
            color="success"
          />
          <StatisticsCard
            title={t("statElectricityCost")}
            value={importCost}
            unit="€"
            format="currency"
            color="danger"
          />
          <StatisticsCard
            title={t("statFeedInRevenue")}
            value={exportRevenue}
            unit="€"
            format="currency"
            color="success"
          />
        </StatisticsGrid>
      </motion.div>

      {/* Charts Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <Card>
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-medium">
                  {chartType === "power" ? t("chartPowerHeading") : t("chartEnergyHeading")}
                </h2>
                <Tabs
                  value={chartType}
                  onValueChange={(v) => setChartType(v as ChartType)}
                >
                  <TabsList className="h-8">
                    <TabsTrigger value="power" className="text-xs px-3 h-6">{t("chartTabPower")}</TabsTrigger>
                    <TabsTrigger value="energy" className="text-xs px-3 h-6">{t("chartTabEnergy")}</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              <Tabs
                value={selectedPeriod}
                onValueChange={(v) => setSelectedPeriod(v as TimePeriod)}
              >
                <TabsList>
                  <TabsTrigger value="today" className="text-xs">{t("tabToday")}</TabsTrigger>
                  <TabsTrigger value="week" className="text-xs">{t("tabWeek")}</TabsTrigger>
                  <TabsTrigger value="month" className="text-xs">{t("tabMonth")}</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {chartType === "power" && (
              <>
                {loadingHistory ? (
                  <div className="flex items-center justify-center h-[280px] text-muted-foreground">
                    <Loader2 className="size-5 mr-2 animate-spin" />
                    {t("chartLoading", { period: periodLabel.toLowerCase() })}
                  </div>
                ) : powerHistory.length > 0 ? (
                  <PowerChart
                    histories={powerHistory}
                    lines={[
                      ...(energyConfig?.solar_power ? [{
                        entityId: energyConfig.solar_power,
                        label: t("chartLineSolar"),
                        color: "hsl(var(--energy-solar))",
                      }] : []),
                      ...(energyConfig?.home_consumption ? [{
                        entityId: energyConfig.home_consumption,
                        label: t("chartLineConsumption"),
                        color: "hsl(var(--energy-consumption))",
                        dashed: true,
                      }] : []),
                      ...(energyConfig?.home_consumption && energyConfig?.solar_power ? [{
                        entityId: "calculated_grid_import",
                        label: t("chartLineGridImport"),
                        color: "hsl(var(--energy-grid))",
                        calculated: {
                          type: "grid_import" as const,
                          homeConsumption: energyConfig.home_consumption,
                          solar: energyConfig.solar_power,
                          battery: energyConfig.battery_power || "",
                        },
                      }] : []),
                      ...(energyConfig?.grid_export_power ? [{
                        entityId: energyConfig.grid_export_power,
                        label: t("chartLineGridExport"),
                        color: "hsl(var(--energy-grid))",
                      }] : []),
                      ...(energyConfig?.battery_power ? [{
                        entityId: energyConfig.battery_power,
                        label: t("chartLineBattery"),
                        color: "hsl(var(--energy-battery))",
                      }] : []),
                    ]}
                    period={selectedPeriod}
                    height={280}
                  />
                ) : (
                  <div className="flex items-center justify-center h-[280px] text-muted-foreground">
                    {t("chartNoData")}
                  </div>
                )}
              </>
            )}

            {chartType === "energy" && (
              <>
                {loadingEnergyHistory ? (
                  <div className="flex items-center justify-center h-[280px] text-muted-foreground">
                    <Loader2 className="size-5 mr-2 animate-spin" />
                    {t("chartLoading", { period: periodLabel.toLowerCase() })}
                  </div>
                ) : energyHistory.length > 0 ? (
                  <EnergyChart
                    histories={energyHistory}
                    lines={[
                      ...(energyConfig?.solar_energy_today ? [{
                        entityId: energyConfig.solar_energy_today,
                        label: t("chartLineSolarYield"),
                        color: "hsl(var(--energy-solar))",
                      }] : []),
                      ...(energyConfig?.grid_import ? [{
                        entityId: energyConfig.grid_import,
                        label: t("chartLineGridImport"),
                        color: "hsl(var(--energy-grid))",
                      }] : []),
                      ...(energyConfig?.grid_export ? [{
                        entityId: energyConfig.grid_export,
                        label: t("chartLineGridExport"),
                        color: "hsl(var(--energy-grid))",
                      }] : []),
                      ...(energyConfig?.battery_energy_in ? [{
                        entityId: energyConfig.battery_energy_in,
                        label: t("chartLineBatteryCharged"),
                        color: "hsl(var(--energy-battery))",
                      }] : []),
                      ...(energyConfig?.battery_energy_out ? [{
                        entityId: energyConfig.battery_energy_out,
                        label: t("chartLineBatteryDischarged"),
                        color: "hsl(var(--energy-battery))",
                      }] : []),
                    ]}
                    period={selectedPeriod}
                    height={280}
                  />
                ) : (
                  <div className="flex items-center justify-center h-[280px] text-muted-foreground">
                    {t("chartNoData")}
                  </div>
                )}
              </>
            )}

            {energyConfig?.battery_soc && batteryHistory.length > 0 && (
              <div className="mt-6 pt-6 border-t border-border/50">
                <div className="flex items-center gap-2 mb-3">
                  <Battery className="size-4 text-energy-battery" />
                  <h3 className="text-sm font-medium">{t("batteryHeading")}</h3>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {t("batteryCurrent", { soc: batterySoc })}
                  </span>
                </div>
                <BatteryChart
                  history={batteryHistory[0]}
                  period={selectedPeriod}
                  height={120}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Battery Insights */}
      {(gridToBattery > 0 || batteryIn > 0) && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <h2 className="text-lg font-medium mb-4">{t("insightsHeading")}</h2>
          <StatisticsGrid columns={4}>
            <StatisticsCard
              title={t("insightSolarToBattery")}
              value={solarToBattery}
              unit="kWh"
              icon={<Sun className="size-4" />}
              color="solar"
            />
            <StatisticsCard
              title={t("insightGridToBattery")}
              value={gridToBattery}
              unit="kWh"
              icon={<Zap className="size-4" />}
              color="grid"
              decimals={2}
            />
            <StatisticsCard
              title={t("insightSolarChargingRatio")}
              value={solarChargingRatio}
              format="percentage"
              color={solarChargingRatio >= 80 ? "success" : solarChargingRatio >= 50 ? "warning" : "danger"}
            />
            <StatisticsCard
              title={t("insightGridChargingCost")}
              value={gridToBatteryCost}
              unit="€"
              format="currency"
              color="danger"
            />
          </StatisticsGrid>
        </motion.div>
      )}

      {/* Footer */}
      <div className="text-center text-xs text-muted-foreground pt-4">
        {t("footerAutoRefresh")}
      </div>

      {/* Refresh button (bottom right, smaller than PageHeader) */}
      <div className="flex justify-end gap-2 -mt-4">
        {isFetching && (
          <Badge variant="outline" className="text-xs">
            <RefreshCw className="size-3 mr-1 animate-spin" />
            {t("refreshingBadge")}
          </Badge>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label={t("refreshAria")}
        >
          <RefreshCw className={`size-5 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// EnergyConfigForm — the /settings/energy form
// (extracted from app/settings/homeassistant/energy/page.tsx)
// ============================================================================

type ColorPresetKey =
  | "colorOrange"
  | "colorBlue"
  | "colorRed"
  | "colorGreen"
  | "colorCyan"
  | "colorPurple"
  | "colorPink"
  | "colorYellow";

const COLOR_PRESETS: { labelKey: ColorPresetKey; value: string }[] = [
  { labelKey: "colorOrange", value: "#FFA500" },
  { labelKey: "colorBlue", value: "#3b82f6" },
  { labelKey: "colorRed", value: "#ef4444" },
  { labelKey: "colorGreen", value: "#22c55e" },
  { labelKey: "colorCyan", value: "#06b6d4" },
  { labelKey: "colorPurple", value: "#8b5cf6" },
  { labelKey: "colorPink", value: "#ec4899" },
  { labelKey: "colorYellow", value: "#eab308" },
];

interface EntitySelectorProps {
  label: string;
  description: string;
  value: string | undefined;
  onChange: (value: string) => void;
  entities: HAEntity[];
  filterDomain?: string;
  filterDeviceClass?: string;
}

function EntitySelector({
  label,
  description,
  value,
  onChange,
  entities,
  filterDomain,
  filterDeviceClass,
}: EntitySelectorProps) {
  const t = useTranslations("settings.homeassistantEnergy");
  const [search, setSearch] = useState("");

  const filteredEntities = entities.filter((entity) => {
    if (filterDomain && !entity.domain.includes(filterDomain)) return false;
    if (filterDeviceClass && entity.attributes.device_class !== filterDeviceClass) return false;
    if (search) {
      const searchLower = search.toLowerCase();
      return (
        entity.name.toLowerCase().includes(searchLower) ||
        entity.entity_id.toLowerCase().includes(searchLower)
      );
    }
    return true;
  });

  const handleChange = (newValue: string) => {
    onChange(newValue === "__none__" ? "" : newValue);
  };

  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <Select value={value || "__none__"} onValueChange={handleChange}>
        <SelectTrigger>
          <SelectValue placeholder={t("entityPlaceholder")} />
        </SelectTrigger>
        <SelectContent>
          <div className="flex items-center px-2 pb-2">
            <Search className="size-4 mr-2 text-muted-foreground" />
            <Input
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8"
            />
          </div>
          <SelectItem value="__none__">{t("noneOption")}</SelectItem>
          {filteredEntities
            .filter((entity) => entity.entity_id)
            .slice(0, 50)
            .map((entity) => (
              <SelectItem key={entity.entity_id} value={entity.entity_id}>
                <div className="flex flex-col">
                  <span>{entity.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {entity.entity_id}
                  </span>
                </div>
              </SelectItem>
            ))}
          {filteredEntities.length > 50 && (
            <div className="px-2 py-1 text-xs text-muted-foreground">
              {t("moreCount", { count: filteredEntities.length - 50 })}
            </div>
          )}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

interface ChartEntityConfig {
  entity_id: string;
  label: string;
  color: string;
}

interface ChartEntityEditorProps {
  label: string;
  description: string;
  entities: ChartEntityConfig[];
  availableEntities: HAEntity[];
  onChange: (entities: ChartEntityConfig[]) => void;
}

function ChartEntityEditor({
  label,
  description,
  entities,
  availableEntities,
  onChange,
}: ChartEntityEditorProps) {
  const t = useTranslations("settings.homeassistantEnergy");
  const [search, setSearch] = useState("");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newEntity, setNewEntity] = useState<ChartEntityConfig>({
    entity_id: "",
    label: "",
    color: COLOR_PRESETS[0].value,
  });

  const filteredEntities = availableEntities.filter((entity) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      entity.name.toLowerCase().includes(searchLower) ||
      entity.entity_id.toLowerCase().includes(searchLower)
    );
  });

  const addEntity = () => {
    if (!newEntity.entity_id) return;
    const entity = availableEntities.find(e => e.entity_id === newEntity.entity_id);
    const finalEntity = {
      ...newEntity,
      label: newEntity.label || entity?.name || newEntity.entity_id,
    };
    onChange([...entities, finalEntity]);
    setNewEntity({ entity_id: "", label: "", color: COLOR_PRESETS[(entities.length + 1) % COLOR_PRESETS.length].value });
    setShowAddDialog(false);
    setSearch("");
  };

  const removeEntity = (index: number) => {
    const updated = [...entities];
    updated.splice(index, 1);
    onChange(updated);
  };

  const updateEntity = (index: number, updates: Partial<ChartEntityConfig>) => {
    const updated = [...entities];
    updated[index] = { ...updated[index], ...updates };
    onChange(updated);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <Label>{label}</Label>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowAddDialog(true)}>
          <Plus className="size-4 mr-1" />
          {t("chartAddButton")}
        </Button>
      </div>

      {entities.length > 0 && (
        <div className="flex flex-col gap-2">
          {entities.map((entity, index) => (
            <div
              key={`${entity.entity_id}-${index}`}
              className="flex items-center gap-2 p-2 rounded-lg border bg-muted/30"
            >
              <div className="size-4 rounded-full shrink-0" style={{ backgroundColor: entity.color }} />
              <div className="flex-1 min-w-0">
                <Input
                  value={entity.label}
                  onChange={(e) => updateEntity(index, { label: e.target.value })}
                  className="h-7 text-sm"
                  placeholder={t("chartLabelPlaceholder")}
                />
              </div>
              <Select value={entity.color} onValueChange={(v) => updateEntity(index, { color: v })}>
                <SelectTrigger className="w-20 h-7">
                  <div className="size-3 rounded-full" style={{ backgroundColor: entity.color }} />
                </SelectTrigger>
                <SelectContent>
                  {COLOR_PRESETS.map((color) => (
                    <SelectItem key={color.value} value={color.value}>
                      <div className="flex items-center gap-2">
                        <div className="size-3 rounded-full" style={{ backgroundColor: color.value }} />
                        <span>{t(color.labelKey)}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={() => removeEntity(index)} aria-label={t("chartRemoveAria")}>
                <X className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {entities.length === 0 && (
        <div className="text-sm text-muted-foreground text-center py-4 border rounded-lg border-dashed">
          {t("chartEmpty")}
        </div>
      )}

      {showAddDialog && (
        <div className="p-3 border rounded-lg flex flex-col gap-3 bg-background">
          <div className="flex items-center gap-2 pb-2 border-b">
            <Search className="size-4 text-muted-foreground" />
            <Input
              placeholder={t("chartEntitySearchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 border-0 p-0 focus-visible:ring-0"
            />
          </div>
          <div className="max-h-40 overflow-y-auto flex flex-col gap-1">
            {filteredEntities.slice(0, 20).map((entity) => (
              <button
                key={entity.entity_id}
                onClick={() => setNewEntity(prev => ({ ...prev, entity_id: entity.entity_id, label: entity.name }))}
                className={`w-full text-left p-2 rounded text-sm hover:bg-muted transition-colors ${
                  newEntity.entity_id === entity.entity_id ? "bg-muted" : ""
                }`}
              >
                <div className="font-medium truncate">{entity.name}</div>
                <div className="text-xs text-muted-foreground truncate">{entity.entity_id}</div>
              </button>
            ))}
          </div>
          {newEntity.entity_id && (
            <div className="flex items-center gap-2 pt-2 border-t">
              <Input
                placeholder={t("chartLabelPlaceholder")}
                value={newEntity.label}
                onChange={(e) => setNewEntity(prev => ({ ...prev, label: e.target.value }))}
                className="h-8 flex-1"
              />
              <Select value={newEntity.color} onValueChange={(v) => setNewEntity(prev => ({ ...prev, color: v }))}>
                <SelectTrigger className="w-20 h-8">
                  <div className="size-3 rounded-full" style={{ backgroundColor: newEntity.color }} />
                </SelectTrigger>
                <SelectContent>
                  {COLOR_PRESETS.map((color) => (
                    <SelectItem key={color.value} value={color.value}>
                      <div className="flex items-center gap-2">
                        <div className="size-3 rounded-full" style={{ backgroundColor: color.value }} />
                        <span>{t(color.labelKey)}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowAddDialog(false);
                setSearch("");
                setNewEntity({ entity_id: "", label: "", color: COLOR_PRESETS[0].value });
              }}
            >
              {t("chartCancelButton")}
            </Button>
            <Button size="sm" onClick={addEntity} disabled={!newEntity.entity_id}>
              {t("chartAddInline")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function EnergyConfigForm() {
  const t = useTranslations("settings.homeassistantEnergy");
  const { data: settings, isLoading: loadingSettings } = useHomeAssistantStatus();
  const existingConfig = useEnergyConfig();
  const saveConfig = useSaveEnergyConfig();
  const { data: entities = [], isLoading: loadingEntities } = useHomeAssistantEntities(
    undefined,
    !!settings?.url
  );
  void loadingEntities;

  const [config, setConfig] = useState<EnergyConfig>({});

  useEffect(() => {
    if (existingConfig) {
      setConfig(existingConfig);
    }
  }, [existingConfig]);

  const isConnected = !!settings?.url && !!settings?.access_token;

  const updateField = (field: keyof EnergyConfig, value: string | number | boolean | undefined) => {
    setConfig((prev) => ({
      ...prev,
      [field]: value === "" ? undefined : value,
    }));
  };

  const handleSave = async () => {
    try {
      await saveConfig.mutateAsync(config);
    } catch {
      toast.error(t("saveFailed"));
    }
  };

  if (loadingSettings) {
    return (
      <Card>
        <div className="p-6">
          <div className="flex items-center gap-3">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">{t("loadingHint")}</span>
          </div>
        </div>
      </Card>
    );
  }

  if (!isConnected) {
    return (
      <Card>
        <div className="p-8 text-center">
          <Zap className="size-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <h2 className="text-lg font-medium mb-2">{t("notConnectedTitle")}</h2>
          <p className="text-muted-foreground mb-4">
            {t("notConnectedDescription")}
          </p>
          <Link href="/settings/homeassistant">
            <Button variant="outline">
              <ArrowLeft className="size-4 mr-2" />
              {t("backLink")}
            </Button>
          </Link>
        </div>
      </Card>
    );
  }

  const powerSensors = entities.filter(
    (e) =>
      e.domain === "sensor" &&
      (e.attributes.device_class === "power" ||
        e.attributes.unit_of_measurement === "W" ||
        e.attributes.unit_of_measurement === "kW")
  );

  const energySensors = entities.filter(
    (e) =>
      e.domain === "sensor" &&
      (e.attributes.device_class === "energy" ||
        e.attributes.unit_of_measurement === "kWh" ||
        e.attributes.unit_of_measurement === "Wh")
  );

  const batterySensors = entities.filter(
    (e) =>
      e.domain === "sensor" &&
      (e.attributes.device_class === "battery" ||
        (e.attributes.unit_of_measurement === "%" &&
          (e.entity_id.includes("battery") || e.entity_id.includes("soc"))))
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Solar Configuration */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <Card>
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg bg-orange-500/10">
                <Sun className="size-5 text-orange-500" />
              </div>
              <h2 className="font-medium">{t("solarHeading")}</h2>
            </div>
            <div className="flex flex-col gap-4">
              <EntitySelector
                label={t("solarPowerLabel")}
                description={t("solarPowerDescription")}
                value={config.solar_power}
                onChange={(v) => updateField("solar_power", v)}
                entities={powerSensors}
              />
              <EntitySelector
                label={t("solarTodayLabel")}
                description={t("solarTodayDescription")}
                value={config.solar_energy_today}
                onChange={(v) => updateField("solar_energy_today", v)}
                entities={energySensors}
              />
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Battery Configuration */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <Card>
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg bg-success/10">
                <Battery className="size-5 text-success" />
              </div>
              <h2 className="font-medium">{t("batteryHeading")}</h2>
            </div>
            <div className="flex flex-col gap-4">
              <EntitySelector
                label={t("batteryPowerCombinedLabel")}
                description={t("batteryPowerCombinedDescription")}
                value={config.battery_power}
                onChange={(v) => updateField("battery_power", v)}
                entities={powerSensors}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <EntitySelector
                  label={t("batteryChargeLabel")}
                  description={t("batteryChargeDescription")}
                  value={config.battery_charge_power}
                  onChange={(v) => updateField("battery_charge_power", v)}
                  entities={powerSensors}
                />
                <EntitySelector
                  label={t("batteryDischargeLabel")}
                  description={t("batteryDischargeDescription")}
                  value={config.battery_discharge_power}
                  onChange={(v) => updateField("battery_discharge_power", v)}
                  entities={powerSensors}
                />
              </div>
              <EntitySelector
                label={t("batterySocLabel")}
                description={t("batterySocDescription")}
                value={config.battery_soc}
                onChange={(v) => updateField("battery_soc", v)}
                entities={batterySensors}
              />
              <EntitySelector
                label={t("batteryEnergyInLabel")}
                description={t("batteryEnergyInDescription")}
                value={config.battery_energy_in}
                onChange={(v) => updateField("battery_energy_in", v)}
                entities={energySensors}
              />
              <EntitySelector
                label={t("batteryEnergyOutLabel")}
                description={t("batteryEnergyOutDescription")}
                value={config.battery_energy_out}
                onChange={(v) => updateField("battery_energy_out", v)}
                entities={energySensors}
              />
              <div className="pt-4 border-t border-border/50">
                <h3 className="text-sm font-medium mb-3 text-muted-foreground">
                  {t("gridChargeHeading")}
                </h3>
                <div className="flex flex-col gap-4">
                  <EntitySelector
                    label={t("gridToBatteryPowerLabel")}
                    description={t("gridToBatteryPowerDescription")}
                    value={config.grid_to_battery_power}
                    onChange={(v) => updateField("grid_to_battery_power", v)}
                    entities={powerSensors}
                  />
                  <EntitySelector
                    label={t("gridToBatteryEnergyLabel")}
                    description={t("gridToBatteryEnergyDescription")}
                    value={config.grid_to_battery_energy}
                    onChange={(v) => updateField("grid_to_battery_energy", v)}
                    entities={energySensors}
                  />
                </div>
              </div>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Grid Configuration */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <Card>
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg bg-destructive/10">
                <Zap className="size-5 text-destructive" />
              </div>
              <h2 className="font-medium">{t("gridHeading")}</h2>
            </div>
            <div className="flex flex-col gap-4">
              <EntitySelector
                label={t("gridPowerCombinedLabel")}
                description={t("gridPowerCombinedDescription")}
                value={config.grid_power}
                onChange={(v) => updateField("grid_power", v)}
                entities={powerSensors}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <EntitySelector
                  label={t("gridImportPowerLabel")}
                  description={t("gridImportPowerDescription")}
                  value={config.grid_import_power}
                  onChange={(v) => updateField("grid_import_power", v)}
                  entities={powerSensors}
                />
                <EntitySelector
                  label={t("gridExportPowerLabel")}
                  description={t("gridExportPowerDescription")}
                  value={config.grid_export_power}
                  onChange={(v) => updateField("grid_export_power", v)}
                  entities={powerSensors}
                />
              </div>
              <EntitySelector
                label={t("gridImportLabel")}
                description={t("gridImportDescription")}
                value={config.grid_import}
                onChange={(v) => updateField("grid_import", v)}
                entities={energySensors}
              />
              <EntitySelector
                label={t("gridExportLabel")}
                description={t("gridExportDescription")}
                value={config.grid_export}
                onChange={(v) => updateField("grid_export", v)}
                entities={energySensors}
              />
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Home Consumption Configuration */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
        <Card>
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg bg-info/10">
                <Home className="size-5 text-info" />
              </div>
              <div>
                <h2 className="font-medium">{t("homeHeading")}</h2>
                <p className="text-xs text-muted-foreground">{t("homeOptional")}</p>
              </div>
            </div>
            <div className="flex flex-col gap-4">
              <EntitySelector
                label={t("homeConsumptionLabel")}
                description={t("homeConsumptionDescription")}
                value={config.home_consumption}
                onChange={(v) => updateField("home_consumption", v)}
                entities={powerSensors}
              />
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Cost Configuration */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
        <Card>
          <div className="p-6">
            <h2 className="font-medium mb-4">{t("costsHeading")}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label>{t("costImportLabel")}</Label>
                <div className="relative">
                  <Input
                    type="number"
                    step="0.01"
                    placeholder={t("costImportPlaceholder")}
                    value={config.cost_per_kwh_import ?? ""}
                    onChange={(e) => updateField("cost_per_kwh_import", parsePrice(e.target.value))}
                    className="pr-16"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                    €/kWh
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label>{t("costExportLabel")}</Label>
                <div className="relative">
                  <Input
                    type="number"
                    step="0.01"
                    placeholder={t("costExportPlaceholder")}
                    value={config.cost_per_kwh_export ?? ""}
                    onChange={(e) => updateField("cost_per_kwh_export", parsePrice(e.target.value))}
                    className="pr-16"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                    €/kWh
                  </span>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Screensaver Display */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
        <Card>
          <div className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-500/10">
                  <Monitor className="size-5 text-purple-500" />
                </div>
                <div>
                  <Label className="font-medium">{t("screensaverLabel")}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t("screensaverDescription")}
                  </p>
                </div>
              </div>
              <Switch
                aria-label={t("screensaverDescription")}
                checked={config.show_on_screensaver ?? false}
                onCheckedChange={(v) => updateField("show_on_screensaver", v)}
              />
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Chart Configuration */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
        <Card>
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg bg-cyan-500/10">
                <LineChart className="size-5 text-cyan-500" />
              </div>
              <div>
                <h2 className="font-medium">{t("chartHeading")}</h2>
                <p className="text-xs text-muted-foreground">
                  {t("chartHeadingDescription")}
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-6">
              <ChartEntityEditor
                label={t("powerChartLabel")}
                description={t("powerChartDescription")}
                entities={config.power_chart_entities || []}
                availableEntities={powerSensors}
                onChange={(ents) => setConfig(prev => ({ ...prev, power_chart_entities: ents.length > 0 ? ents : undefined }))}
              />
              <ChartEntityEditor
                label={t("energyChartLabel")}
                description={t("energyChartDescription")}
                entities={config.energy_chart_entities || []}
                availableEntities={energySensors}
                onChange={(ents) => setConfig(prev => ({ ...prev, energy_chart_entities: ents.length > 0 ? ents : undefined }))}
              />
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saveConfig.isPending}>
          {saveConfig.isPending ? (
            <>
              <Loader2 className="size-4 mr-2 animate-spin" />
              {t("savingLabel")}
            </>
          ) : (
            <>
              <Check className="size-4 mr-2" />
              {t("saveButton")}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// Driver manifest
// ============================================================================

export const genericHaEnergyDriver: EnergyDriver<EnergyConfig> = {
  id: "generic-ha-energy",
  displayNameKey: "displayName",
  icon: Zap,
  Card: EnergyCard,
  ConfigForm: EnergyConfigForm,
  isConfigured: (config) =>
    Boolean(config?.solar_power || config?.battery_power || config?.grid_import),
};
