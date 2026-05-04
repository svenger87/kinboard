"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useTranslations, useLocale } from "next-intl";
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
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useHomeAssistantStatus,
  useEnergyConfig,
  useHomeAssistantEntityStates,
  useMultiEntityHistory,
  useEnergyPeriodStats,
  useKeyboardShortcuts,
  useSwipeNavigation,
} from "@/hooks";
import { PageHeader } from "@/components/page-header";
import { EnergyFlow } from "@/components/home-assistant/energy-flow";
import { PowerChart } from "@/components/home-assistant/power-chart";
import { EnergyChart } from "@/components/home-assistant/energy-chart";
import { BatteryChart } from "@/components/home-assistant/battery-chart";
import { StatisticsCard, StatisticsGrid } from "@/components/home-assistant/statistics-card";

type TimePeriod = "today" | "week" | "month" | "year";
type ChartType = "power" | "energy";

export default function EnergiePage() {
  useKeyboardShortcuts();
  useSwipeNavigation();
  const t = useTranslations("energy");
  const locale = useLocale();
  const intlLocale = locale === "de" ? "de-DE" : "en-US";
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
      energyConfig.battery_soc, // Needed for current SoC display
      energyConfig.grid_to_battery_power, // Needed for energy flow
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

  // Create entity map for quick lookup of power values
  const entityMap = useMemo(
    () => new Map(powerEntities.map((e) => [e.entity_id, e])),
    [powerEntities]
  );

  // Get current power values
  const getCurrentValue = useCallback((entityId: string | undefined): number => {
    if (!entityId) return 0;
    const entity = entityMap.get(entityId);
    if (!entity) return 0;
    const value = parseFloat(entity.state);
    return isNaN(value) ? 0 : value;
  }, [entityMap]);

  const solarPower = getCurrentValue(energyConfig?.solar_power);
  const batterySoc = getCurrentValue(energyConfig?.battery_soc);

  // Battery power: support separate charge/discharge sensors or combined sensor
  const batteryChargePower = energyConfig?.battery_charge_power
    ? getCurrentValue(energyConfig.battery_charge_power)
    : Math.max(getCurrentValue(energyConfig?.battery_power), 0);
  const batteryDischargePower = energyConfig?.battery_discharge_power
    ? getCurrentValue(energyConfig.battery_discharge_power)
    : Math.abs(Math.min(getCurrentValue(energyConfig?.battery_power), 0));
  // Combined battery power for display (positive = charge, negative = discharge)
  const batteryPower = batteryChargePower - batteryDischargePower;

  // Grid power: support separate import/export sensors or combined sensor
  const gridImportPower = energyConfig?.grid_import_power
    ? getCurrentValue(energyConfig.grid_import_power)
    : Math.max(getCurrentValue(energyConfig?.grid_power), 0);
  const gridExportPower = energyConfig?.grid_export_power
    ? getCurrentValue(energyConfig.grid_export_power)
    : Math.abs(Math.min(getCurrentValue(energyConfig?.grid_power), 0));
  // Combined grid power for display (positive = import, negative = export)
  const gridPower = gridImportPower - gridExportPower;

  // Grid-to-battery power (from dedicated sensor if available)
  const gridToBatteryPower = getCurrentValue(energyConfig?.grid_to_battery_power);

  // Home consumption calculation
  // Home = Grid + Solar - Battery Power
  // - Grid: net grid flow (import - export)
  // - Solar: total solar production
  // - Battery Power: positive = charging (takes from home), negative = discharging (adds to home)
  // When battery charges: batteryPower > 0, we subtract it (less goes to home)
  // When battery discharges: batteryPower < 0, subtracting negative adds it (battery feeds home)
  const homePower = Math.max(0, gridImportPower - gridExportPower + solarPower - batteryPower);

  // Energy totals for selected period (from statistics API)
  const solarTotal = periodStats.solarToday;
  const gridImport = periodStats.gridImport;
  const gridExport = periodStats.gridExport;
  const batteryIn = periodStats.batteryIn;
  const batteryOut = periodStats.batteryOut;
  const gridToBattery = periodStats.gridToBattery;

  // Calculate statistics using period energy values (kWh), not current power
  const selfConsumption = solarTotal > 0 ? ((solarTotal - gridExport) / solarTotal) * 100 : 0;
  // Period home consumption = grid import + solar + battery discharge - grid export - battery charge
  // This correctly accounts for energy stored in/released from the battery
  const periodHomeConsumption = gridImport + solarTotal + batteryOut - gridExport - batteryIn;
  // Autarky = percentage of home consumption NOT from grid = (consumption - grid import) / consumption
  const autarky = periodHomeConsumption > 0 ? ((periodHomeConsumption - gridImport) / periodHomeConsumption) * 100 : 0;

  // Cost calculations
  const importCost = (energyConfig?.cost_per_kwh_import || 0.35) * gridImport;
  const exportRevenue = (energyConfig?.cost_per_kwh_export || 0.08) * gridExport;
  const netCost = importCost - exportRevenue;

  // Grid-to-battery calculations
  const gridToBatteryCost = (energyConfig?.cost_per_kwh_import || 0.35) * gridToBattery;
  // Solar charging = total battery in - grid to battery
  const solarToBattery = Math.max(0, batteryIn - gridToBattery);
  // Solar charging ratio (percentage of battery charging that came from solar)
  const solarChargingRatio = batteryIn > 0 ? (solarToBattery / batteryIn) * 100 : 100;

  // Calculate start time for history based on selected period
  const historyStartTime = useMemo(() => {
    // currentDay dependency ensures recomputation at midnight
    const now = new Date(currentDay);
    switch (selectedPeriod) {
      case "today":
        return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      case "week":
        // Start from Monday of the current week (German week starts on Monday)
        const startOfWeek = new Date(now);
        const dayOfWeek = startOfWeek.getDay();
        // Sunday = 0, Monday = 1, so we need to go back (dayOfWeek + 6) % 7 days to get to Monday
        const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        startOfWeek.setDate(startOfWeek.getDate() - daysToMonday);
        startOfWeek.setHours(0, 0, 0, 0);
        return startOfWeek.toISOString();
      case "month":
        // Start from the 1st of the current month
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        startOfMonth.setHours(0, 0, 0, 0);
        return startOfMonth.toISOString();
      case "year":
        // Start from January 1st of the current year
        const startOfYear = new Date(now.getFullYear(), 0, 1);
        startOfYear.setHours(0, 0, 0, 0);
        return startOfYear.toISOString();
    }
  }, [selectedPeriod, currentDay]);

  // HA history API defaults to 1 day if no end_time is passed, so we must
  // provide an explicit end time for multi-day periods (week/month/year)
  const historyEndTime = useMemo(() => {
    if (selectedPeriod === "today") return undefined;
    // currentDay dependency ensures recomputation at midnight
    void currentDay;
    return new Date().toISOString();
  }, [selectedPeriod, currentDay]);

  // Fetch history for chart
  const { data: powerHistory = [], isLoading: loadingHistory } = useMultiEntityHistory(
    powerEntityIds,
    historyStartTime,
    historyEndTime,
    {
      enabled: isConnected && isConfigured && powerEntityIds.length > 0,
      // Don't use significantChangesOnly - it creates gaps in the chart
      significantChangesOnly: false
    }
  );

  // Fetch battery SoC history separately (different scale - percentage)
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
      significantChangesOnly: false
    }
  );

  // Collect entity IDs for energy chart (kWh sensors)
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

  // Fetch energy history (kWh sensors)
  const { data: energyHistory = [], isLoading: loadingEnergyHistory } = useMultiEntityHistory(
    energyEntityIds,
    historyStartTime,
    historyEndTime,
    {
      enabled: isConnected && isConfigured && energyEntityIds.length > 0,
      significantChangesOnly: false
    }
  );

  // Calculate period label for statistics
  const periodLabel = selectedPeriod === "today" ? t("periodToday")
    : selectedPeriod === "week" ? t("periodWeek")
    : selectedPeriod === "year" ? t("periodYear")
    : t("periodMonth");

  // Loading state
  if (loadingSettings) {
    return (
      <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
        <div className="page-gradient" />
        <div className="relative z-10 max-w-6xl mx-auto flex flex-col gap-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-month-primary/10">
              <Zap className="size-6 text-month-primary" strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-2xl font-display font-light">{t("title")}</h1>
              <p className="text-sm text-muted-foreground">{t("subtitleLoading")}</p>
            </div>
          </div>
          {/* Quick Stats Skeleton */}
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
          {/* Power Flow Skeleton */}
          <GlassCard>
            <div className="p-6 flex flex-col items-center gap-4">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-40 w-full max-w-md rounded-xl" />
            </div>
          </GlassCard>
          {/* Chart Skeleton */}
          <GlassCard>
            <div className="p-6">
              <Skeleton className="h-5 w-40 mb-4" />
              <Skeleton className="h-48 w-full rounded-xl" />
            </div>
          </GlassCard>
        </div>
      </main>
    );
  }

  // Not connected state
  if (!isConnected) {
    return (
      <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
        <div className="page-gradient" />
        <div className="relative z-10 max-w-6xl mx-auto flex flex-col gap-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-month-primary/10">
              <Zap className="size-6 text-month-primary" strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-2xl font-display font-light">{t("title")}</h1>
              <p className="text-sm text-muted-foreground">{t("subtitleDashboard")}</p>
            </div>
          </div>

          <GlassCard>
            <div className="p-8 text-center">
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
            </div>
          </GlassCard>
        </div>
      </main>
    );
  }

  // Not configured state
  if (!isConfigured) {
    return (
      <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
        <div className="page-gradient" />
        <div className="relative z-10 max-w-6xl mx-auto flex flex-col gap-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-month-primary/10">
              <Zap className="size-6 text-month-primary" strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-2xl font-display font-light">{t("title")}</h1>
              <p className="text-sm text-muted-foreground">{t("subtitleDashboard")}</p>
            </div>
          </div>

          <GlassCard>
            <div className="p-8 text-center">
              <Sun className="size-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h2 className="text-lg font-medium mb-2">{t("notConfiguredTitle")}</h2>
              <p className="text-muted-foreground mb-6">
                {t("notConfiguredDescription")}
              </p>
              <Link href="/settings/homeassistant/energy">
                <Button>
                  <Settings className="size-4 mr-2" />
                  {t("notConfiguredAction")}
                </Button>
              </Link>
            </div>
          </GlassCard>
        </div>
      </main>
    );
  }

  // Main dashboard
  return (
    <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="page-gradient" />
      <div className="relative z-10 max-w-6xl mx-auto flex flex-col gap-6">
        <PageHeader
          icon={Zap}
          title={t("title")}
          backHref="/"
          subtitle={new Date().toLocaleDateString(intlLocale, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
          actions={
            <>
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
              <Link href="/settings/homeassistant/energy">
                <Button variant="ghost" size="icon" aria-label={t("settingsAria")}>
                  <Settings className="size-5" />
                </Button>
              </Link>
            </>
          }
        />

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
            {/* Autarky mini ring */}
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

        {/* Energy Flow Visualization */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <GlassCard>
            <div className="p-6">
              <h2 className="text-lg font-medium mb-4">{t("energyFlowHeading")}</h2>
              <EnergyFlow
                solarPower={solarPower}
                batteryPower={batteryPower}
                batterySoc={batterySoc}
                gridPower={gridPower}
                homePower={homePower}
                gridToBatteryPower={gridToBatteryPower}
              />
            </div>
          </GlassCard>
        </motion.div>

        {/* Statistics Cards (promoted above chart for first-fold visibility) */}
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
          <GlassCard>
            <div className="p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-medium">
                    {chartType === "power" ? t("chartPowerHeading") : t("chartEnergyHeading")}
                  </h2>
                  {/* Chart type toggle */}
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
                {/* Period selector */}
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

              {/* Power Chart (Watts) */}
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
                        // Power chart configuration - always use configured sensors
                        // 1. Solar production (orange) - PV input power
                        ...(energyConfig?.solar_power ? [{
                          entityId: energyConfig.solar_power,
                          label: t("chartLineSolar"),
                          color: "#f97316", // Orange-500
                        }] : []),
                        // 2. Home consumption (blue) - Smart meter total power
                        ...(energyConfig?.home_consumption ? [{
                          entityId: energyConfig.home_consumption,
                          label: t("chartLineConsumption"),
                          color: "#3b82f6", // Blue-500
                        }] : []),
                        // 3. Grid import (red) - Calculated: smart_meter - solar + battery
                        ...(energyConfig?.home_consumption && energyConfig?.solar_power ? [{
                          entityId: "calculated_grid_import", // Virtual entity ID for calculated value
                          label: t("chartLineGridImport"),
                          color: "#ef4444", // Red-500
                          calculated: {
                            type: "grid_import" as const,
                            homeConsumption: energyConfig.home_consumption,
                            solar: energyConfig.solar_power,
                            battery: energyConfig.battery_power || "",
                          },
                        }] : []),
                        // 4. Grid export (green) - Power to grid
                        ...(energyConfig?.grid_export_power ? [{
                          entityId: energyConfig.grid_export_power,
                          label: t("chartLineGridExport"),
                          color: "#22c55e", // Green-500
                        }] : []),
                        // 5. Battery power (cyan) - Charge/discharge
                        ...(energyConfig?.battery_power ? [{
                          entityId: energyConfig.battery_power,
                          label: t("chartLineBattery"),
                          color: "#06b6d4", // Cyan-500
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

              {/* Energy Chart (kWh) */}
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
                        // Energy chart configuration (kWh sensors)
                        // 1. Solar energy (orange) - Total solar production
                        ...(energyConfig?.solar_energy_today ? [{
                          entityId: energyConfig.solar_energy_today,
                          label: t("chartLineSolarYield"),
                          color: "#f97316", // Orange-500
                        }] : []),
                        // 2. Grid import energy (red) - Energy from grid
                        ...(energyConfig?.grid_import ? [{
                          entityId: energyConfig.grid_import,
                          label: t("chartLineGridImport"),
                          color: "#ef4444", // Red-500
                        }] : []),
                        // 3. Grid export energy (green) - Energy to grid
                        ...(energyConfig?.grid_export ? [{
                          entityId: energyConfig.grid_export,
                          label: t("chartLineGridExport"),
                          color: "#22c55e", // Green-500
                        }] : []),
                        // 4. Battery charge energy (cyan) - Energy into battery
                        ...(energyConfig?.battery_energy_in ? [{
                          entityId: energyConfig.battery_energy_in,
                          label: t("chartLineBatteryCharged"),
                          color: "#06b6d4", // Cyan-500
                        }] : []),
                        // 5. Battery discharge energy (violet) - Energy from battery
                        ...(energyConfig?.battery_energy_out ? [{
                          entityId: energyConfig.battery_energy_out,
                          label: t("chartLineBatteryDischarged"),
                          color: "#8b5cf6", // Violet-500
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

              {/* Battery SoC Chart */}
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
            </div>
          </GlassCard>
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
      </div>
    </main>
  );
}
