"use client";

import { useMemo, useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useTranslations, useLocale } from "next-intl";
import {
  Car,
  Battery,
  Zap,
  Thermometer,
  Lock,
  Unlock,
  MapPin,
  Settings,
  RefreshCw,
  Loader2,
  Gauge,
  CircleDot,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useHomeAssistantStatus,
  useTeslaConfig,
  useHomeAssistantEntityStates,
  useMultiEntityHistory,
  useKeyboardShortcuts,
  useSwipeNavigation,
} from "@/hooks";
import { PageHeader } from "@/components/page-header";
import { PowerChart } from "@/components/home-assistant/power-chart";
import { BatteryChart } from "@/components/home-assistant/battery-chart";
import { StatisticsCard, StatisticsGrid } from "@/components/home-assistant/statistics-card";

type TimePeriod = "today" | "week" | "month";

type BinaryStateKey = "off" | "closed" | "on" | "open" | "locked" | "unlocked" | "opening" | "closing" | "unavailable" | "unknown";
type TeslaLocationKey = "home" | "not_home" | "work" | "school" | "unknown" | "unavailable";

const BINARY_STATE_KEYS: readonly string[] = ["off", "closed", "on", "open", "locked", "unlocked", "opening", "closing", "unavailable", "unknown"];
const TESLA_LOCATION_KEYS: readonly string[] = ["home", "not_home", "work", "school", "unknown", "unavailable"];

export default function TeslaPage() {
  useKeyboardShortcuts();
  useSwipeNavigation();
  const t = useTranslations("tesla");
  const tBinary = useTranslations("tesla.binaryState");
  const tLocation = useTranslations("tesla.location");
  const locale = useLocale();
  const intlLocale = locale === "de" ? "de-DE" : "en-US";
  const { data: settings, isLoading: loadingSettings, refetch } = useHomeAssistantStatus();
  const teslaConfig = useTeslaConfig();
  const [selectedPeriod, setSelectedPeriod] = useState<TimePeriod>("today");

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
  const isConfigured = !!teslaConfig?.battery_level;

  // Collect all entity IDs for fetching
  const entityIds = useMemo(() => {
    if (!teslaConfig) return [];
    return [
      teslaConfig.battery_level,
      teslaConfig.battery_range,
      teslaConfig.charging_rate,
      teslaConfig.charging_state,
      teslaConfig.charge_limit,
      teslaConfig.time_to_full_charge,
      teslaConfig.charger_power,
      teslaConfig.charge_energy_added,
      teslaConfig.inside_temperature,
      teslaConfig.outside_temperature,
      teslaConfig.climate_state,
      teslaConfig.locked,
      teslaConfig.doors,
      teslaConfig.windows,
      teslaConfig.trunk,
      teslaConfig.frunk,
      teslaConfig.tire_pressure_fl,
      teslaConfig.tire_pressure_fr,
      teslaConfig.tire_pressure_rl,
      teslaConfig.tire_pressure_rr,
      teslaConfig.odometer,
      teslaConfig.location,
      teslaConfig.state,
    ].filter((id): id is string => !!id);
  }, [teslaConfig]);

  const {
    data: entities = [],
    isLoading: loadingEntities,
    isFetching,
  } = useHomeAssistantEntityStates(entityIds, isConnected && isConfigured);

  // Entity value helper
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

  // Parse values
  const batteryLevel = getVal(teslaConfig?.battery_level);
  const batteryRange = getVal(teslaConfig?.battery_range);
  const chargingRate = getVal(teslaConfig?.charging_rate || teslaConfig?.charger_power);
  const chargeLimit = getVal(teslaConfig?.charge_limit);
  const timeToFull = getVal(teslaConfig?.time_to_full_charge);
  const chargeEnergyAdded = getVal(teslaConfig?.charge_energy_added);
  const insideTemp = getVal(teslaConfig?.inside_temperature);
  const outsideTemp = getVal(teslaConfig?.outside_temperature);
  const odometer = getVal(teslaConfig?.odometer);
  // Check if tire pressure is in PSI (Tesla Fleet typically reports PSI)
  const tireUnit = teslaConfig?.tire_pressure_fl
    ? entityMap.get(teslaConfig.tire_pressure_fl)?.attributes?.unit_of_measurement
    : undefined;
  const isPsi = tireUnit === "psi" || tireUnit === "PSI";
  const psiToBar = (psi: number) => psi * 0.0689476;

  const tirePressureFL = isPsi ? psiToBar(getVal(teslaConfig?.tire_pressure_fl)) : getVal(teslaConfig?.tire_pressure_fl);
  const tirePressureFR = isPsi ? psiToBar(getVal(teslaConfig?.tire_pressure_fr)) : getVal(teslaConfig?.tire_pressure_fr);
  const tirePressureRL = isPsi ? psiToBar(getVal(teslaConfig?.tire_pressure_rl)) : getVal(teslaConfig?.tire_pressure_rl);
  const tirePressureRR = isPsi ? psiToBar(getVal(teslaConfig?.tire_pressure_rr)) : getVal(teslaConfig?.tire_pressure_rr);

  const lockState = getState(teslaConfig?.locked);
  const doorsState = getState(teslaConfig?.doors);
  const windowsState = getState(teslaConfig?.windows);
  const trunkState = getState(teslaConfig?.trunk);
  const frunkState = getState(teslaConfig?.frunk);
  const vehicleState = getState(teslaConfig?.state);
  const chargingState = getState(teslaConfig?.charging_state);
  const locationState = getState(teslaConfig?.location);

  const isCharging = chargingState === "charging" || chargingRate > 0;
  const isLocked = lockState === "locked";
  const isOnline = vehicleState === "on" || vehicleState === "online";

  // Battery color based on level
  const batteryColor = batteryLevel > 60 ? "text-success" : batteryLevel > 20 ? "text-warning" : "text-destructive";
  const batteryBg = batteryLevel > 60 ? "bg-success" : batteryLevel > 20 ? "bg-warning" : "bg-destructive";

  // Format time to full
  const formatTimeToFull = (minutes: number): string => {
    if (minutes <= 0) return "";
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    if (hours > 0) return `~${hours}h ${mins}min`;
    return `~${mins}min`;
  };

  // Format door/window/trunk/cover state via translation
  const formatBinaryState = (state: string): string =>
    BINARY_STATE_KEYS.includes(state) ? tBinary(state as BinaryStateKey) : state;

  // Format location state via translation
  const formatLocation = (state: string): string =>
    TESLA_LOCATION_KEYS.includes(state) ? tLocation(state as TeslaLocationKey) : state;

  // History for charging chart
  const chartEntityIds = useMemo(() => {
    if (!teslaConfig) return [];
    return [
      teslaConfig.charging_rate || teslaConfig.charger_power,
      teslaConfig.battery_level,
    ].filter((id): id is string => !!id);
  }, [teslaConfig]);

  const historyStartTime = useMemo(() => {
    // currentDay dependency ensures recomputation at midnight
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
      case "month":
        return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    }
  }, [selectedPeriod, currentDay]);

  const historyEndTime = useMemo(() => {
    if (selectedPeriod === "today") return undefined;
    // currentDay dependency ensures recomputation at midnight
    void currentDay;
    return new Date().toISOString();
  }, [selectedPeriod, currentDay]);

  const { data: chartHistory = [], isLoading: loadingHistory } = useMultiEntityHistory(
    chartEntityIds,
    historyStartTime,
    historyEndTime,
    {
      enabled: isConnected && isConfigured && chartEntityIds.length > 0,
      significantChangesOnly: false,
    }
  );

  // Battery SOC history for chart
  const socEntityIds = useMemo(() => {
    if (!teslaConfig?.battery_level) return [];
    return [teslaConfig.battery_level];
  }, [teslaConfig]);

  const { data: socHistory = [] } = useMultiEntityHistory(
    socEntityIds,
    historyStartTime,
    historyEndTime,
    {
      enabled: isConnected && isConfigured && socEntityIds.length > 0,
      significantChangesOnly: false,
    }
  );

  const periodLabel = selectedPeriod === "today" ? t("periodToday")
    : selectedPeriod === "week" ? t("periodWeek")
    : t("periodMonth");

  // Loading state
  if (loadingSettings) {
    return (
      <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
        <div className="page-gradient" />
        <div className="relative z-10 max-w-6xl mx-auto flex flex-col gap-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-month-primary/10">
              <Car className="size-6 text-month-primary" strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-2xl font-display font-light">{t("title")}</h1>
              <p className="text-sm text-muted-foreground">{t("subtitleLoading")}</p>
            </div>
          </div>
          <GlassCard>
            <div className="p-6">
              <div className="flex items-center gap-3">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
                <span className="text-muted-foreground">{t("loadingDashboard")}</span>
              </div>
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
              <Car className="size-6 text-month-primary" strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-2xl font-display font-light">{t("title")}</h1>
              <p className="text-sm text-muted-foreground">{t("subtitleDashboard")}</p>
            </div>
          </div>
          <GlassCard>
            <div className="p-8 text-center">
              <Car className="size-12 mx-auto mb-4 text-muted-foreground opacity-50" />
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
              <Car className="size-6 text-month-primary" strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-2xl font-display font-light">{t("title")}</h1>
              <p className="text-sm text-muted-foreground">{t("subtitleDashboard")}</p>
            </div>
          </div>
          <GlassCard>
            <div className="p-8 text-center">
              <Car className="size-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h2 className="text-lg font-medium mb-2">{t("notConfiguredTitle")}</h2>
              <p className="text-muted-foreground mb-6">
                {t("notConfiguredDescription")}
              </p>
              <Link href="/settings/tesla">
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

  return (
    <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="page-gradient" />
      <div className="relative z-10 max-w-6xl mx-auto flex flex-col gap-6">
        <PageHeader
          icon={Car}
          title={t("title")}
          subtitle={t("subtitleVehicle")}
          actions={
            <>
              <Badge variant="outline" className={isOnline ? "border-success/50 text-success" : "border-muted-foreground/50 text-muted-foreground"}>
                {isOnline ? t("online") : t("asleep")}
              </Badge>
              {isFetching && (
                <Badge variant="outline" className="text-xs">
                  <RefreshCw className="size-3 mr-1 animate-spin" />
                  {t("refreshingBadge")}
                </Badge>
              )}
              <Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching} aria-label={t("refreshAria")}>
                <RefreshCw className={`size-5 ${isFetching ? "animate-spin" : ""}`} />
              </Button>
              <Link href="/settings/tesla">
                <Button variant="ghost" size="icon" aria-label={t("settingsAria")}>
                  <Settings className="size-5" />
                </Button>
              </Link>
            </>
          }
        />

        {/* Hero Card: Car Image + Battery */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <GlassCard>
            <div className="p-6">
              {/* Car Image - Centerpiece */}
              <div className="flex justify-center mb-6">
                <Image
                  src="/images/tesla-model-y.png"
                  alt="Tesla Model Y"
                  width={400}
                  height={170}
                  className="drop-shadow-lg"
                  priority
                />
              </div>

              {/* SOC / Charging / Range row */}
              <div className="flex items-end justify-between mb-4">
                <div>
                  <p className={`text-4xl font-bold ${batteryColor}`}>
                    {Math.round(batteryLevel)}
                    <span className="text-lg text-muted-foreground">%</span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">{t("chargeLevelLabel")}</p>
                </div>
                <div className="text-center">
                  {isCharging ? (
                    <>
                      <div className="flex items-center gap-1.5 justify-center">
                        <Zap className="size-4 text-energy-grid" />
                        <span className="text-lg font-semibold text-energy-grid">
                          {chargingRate.toFixed(1)} kW
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {timeToFull > 0
                          ? t("chargingTimeFormat", { time: formatTimeToFull(timeToFull) })
                          : t("chargingLabel")}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-lg font-semibold text-muted-foreground">{t("notCharging")}</p>
                      <p className="text-xs text-muted-foreground">{t("standbyLabel")}</p>
                    </>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-3xl font-semibold">
                    {Math.round(batteryRange)}
                    <span className="text-sm text-muted-foreground ml-1">km</span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">{t("rangeLabelFull")}</p>
                </div>
              </div>

              {/* Battery bar */}
              <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`absolute inset-y-0 left-0 ${batteryBg} rounded-full transition-all duration-500`}
                  style={{ width: `${Math.min(100, batteryLevel)}%` }}
                />
                {chargeLimit > 0 && (
                  <div
                    className="absolute inset-y-0 w-0.5 bg-foreground/50"
                    style={{ left: `${Math.min(100, chargeLimit)}%` }}
                    title={t("chargeLimitLabel", { percent: chargeLimit })}
                  />
                )}
              </div>
              {chargeLimit > 0 && (
                <p className="text-xs text-muted-foreground mt-1 text-right">
                  {t("chargeLimitLabel", { percent: Math.round(chargeLimit) })}
                </p>
              )}
            </div>
          </GlassCard>
        </motion.div>

        {/* Status Grid */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-3"
        >
          <div className={`flex items-center gap-3 p-3 rounded-xl ${isLocked ? "bg-success/10 border border-success/20" : "bg-destructive/10 border border-destructive/20"}`}>
            {isLocked ? <Lock className="size-5 text-success" /> : <Unlock className="size-5 text-destructive" />}
            <div>
              <p className="text-xs text-muted-foreground">{t("doorsLabel")}</p>
              <p className={`text-lg font-semibold ${isLocked ? "text-success" : "text-destructive"}`}>
                {isLocked ? t("lockedState") : t("unlockedState")}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-xl bg-month-primary/10 border border-month-primary/20">
            <Car className="size-5 text-month-primary" />
            <div>
              <p className="text-xs text-muted-foreground">{t("windowsLabel")}</p>
              <p className="text-lg font-semibold text-month-primary">
                {formatBinaryState(windowsState)}
              </p>
            </div>
          </div>

          {teslaConfig?.inside_temperature && (
            <div className="flex items-center gap-3 p-3 rounded-xl bg-energy-consumption/10 border border-energy-consumption/20">
              <Thermometer className="size-5 text-energy-consumption" />
              <div>
                <p className="text-xs text-muted-foreground">{t("tempInside")}</p>
                <p className="text-lg font-semibold text-energy-consumption">
                  {insideTemp.toFixed(1)}°C
                </p>
              </div>
            </div>
          )}

          {teslaConfig?.outside_temperature && (
            <div className="flex items-center gap-3 p-3 rounded-xl bg-energy-grid/10 border border-energy-grid/20">
              <Thermometer className="size-5 text-energy-grid" />
              <div>
                <p className="text-xs text-muted-foreground">{t("tempOutside")}</p>
                <p className="text-lg font-semibold text-energy-grid">
                  {outsideTemp.toFixed(1)}°C
                </p>
              </div>
            </div>
          )}
        </motion.div>

        {/* Vehicle Details: Doors, Trunk, Frunk, Tires */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="grid grid-cols-1 md:grid-cols-2 gap-4"
        >
          {/* Doors & Openings */}
          <GlassCard>
            <div className="p-6">
              <h2 className="text-lg font-medium mb-4">{t("vehicleStatusHeading")}</h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50">
                  <span className="text-sm text-muted-foreground">{t("doorsLabel")}</span>
                  <span className="text-sm font-medium ml-auto">{formatBinaryState(doorsState)}</span>
                </div>
                {teslaConfig?.trunk && (
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50">
                    <span className="text-sm text-muted-foreground">{t("trunkLabel")}</span>
                    <span className="text-sm font-medium ml-auto">{formatBinaryState(trunkState)}</span>
                  </div>
                )}
                {teslaConfig?.frunk && (
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50">
                    <span className="text-sm text-muted-foreground">{t("frunkLabel")}</span>
                    <span className="text-sm font-medium ml-auto">{formatBinaryState(frunkState)}</span>
                  </div>
                )}
                {teslaConfig?.location && (
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50">
                    <MapPin className="size-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">{t("locationLabel")}</span>
                    <span className="text-sm font-medium ml-auto">{formatLocation(locationState)}</span>
                  </div>
                )}
              </div>
            </div>
          </GlassCard>

          {/* Tire Pressure */}
          {teslaConfig?.tire_pressure_fl && (
            <GlassCard>
              <div className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <CircleDot className="size-5 text-muted-foreground" />
                  <h2 className="text-lg font-medium">{t("tirePressureHeading")}</h2>
                  <span className="text-xs text-muted-foreground ml-auto">{t("tirePressureUnit")}</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex justify-between p-2.5 rounded-lg bg-muted/50">
                    <span className="text-sm text-muted-foreground">{t("tireFL")}</span>
                    <span className="text-sm font-semibold">{tirePressureFL.toFixed(1)}</span>
                  </div>
                  <div className="flex justify-between p-2.5 rounded-lg bg-muted/50">
                    <span className="text-sm text-muted-foreground">{t("tireFR")}</span>
                    <span className="text-sm font-semibold">{tirePressureFR.toFixed(1)}</span>
                  </div>
                  <div className="flex justify-between p-2.5 rounded-lg bg-muted/50">
                    <span className="text-sm text-muted-foreground">{t("tireRL")}</span>
                    <span className="text-sm font-semibold">{tirePressureRL.toFixed(1)}</span>
                  </div>
                  <div className="flex justify-between p-2.5 rounded-lg bg-muted/50">
                    <span className="text-sm text-muted-foreground">{t("tireRR")}</span>
                    <span className="text-sm font-semibold">{tirePressureRR.toFixed(1)}</span>
                  </div>
                </div>
              </div>
            </GlassCard>
          )}
        </motion.div>

        {/* Vehicle Statistics */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <h2 className="text-lg font-medium mb-4">{t("vehicleAndChargingHeading")}</h2>
          <StatisticsGrid columns={4}>
            {teslaConfig?.odometer && (
              <StatisticsCard
                title={t("statOdometer")}
                value={Math.round(odometer).toLocaleString(intlLocale)}
                unit="km"
                icon={<Gauge className="size-4" />}
                color="default"
              />
            )}
            {teslaConfig?.charge_energy_added && (
              <StatisticsCard
                title={t("statSessionEnergy")}
                value={chargeEnergyAdded}
                unit="kWh"
                icon={<Zap className="size-4" />}
                color="grid"
              />
            )}
            {teslaConfig?.charge_energy_added && (
              <StatisticsCard
                title={t("statSessionCost")}
                value={chargeEnergyAdded * (teslaConfig.cost_per_kwh || 0.35)}
                unit={teslaConfig.currency || "€"}
                format="currency"
                icon={<Battery className="size-4" />}
                color="danger"
              />
            )}
            {teslaConfig?.charge_limit && (
              <StatisticsCard
                title={t("statChargeLimit")}
                value={Math.round(chargeLimit)}
                format="percentage"
                icon={<Battery className="size-4" />}
                color="battery"
              />
            )}
          </StatisticsGrid>
        </motion.div>

        {/* Charging Chart */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
        >
          <GlassCard>
            <div className="p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <h2 className="text-lg font-medium">{t("chargingChartHeading")}</h2>
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

              {loadingHistory ? (
                <div className="flex items-center justify-center h-[280px] text-muted-foreground">
                  <Loader2 className="size-5 mr-2 animate-spin" />
                  {t("chartLoading", { period: periodLabel.toLowerCase() })}
                </div>
              ) : chartHistory.length > 0 ? (
                <PowerChart
                  histories={chartHistory}
                  lines={[
                    ...(teslaConfig?.charging_rate || teslaConfig?.charger_power ? [{
                      entityId: (teslaConfig.charging_rate || teslaConfig.charger_power)!,
                      label: t("chartLineChargingPower"),
                      color: "#3b82f6",
                    }] : []),
                  ]}
                  period={selectedPeriod}
                  height={280}
                  unitKw
                  curveType="stepAfter"
                  aggregation="max"
                />
              ) : (
                <div className="flex items-center justify-center h-[280px] text-muted-foreground">
                  {t("chartNoData")}
                </div>
              )}

              {/* Battery SOC Chart */}
              {teslaConfig?.battery_level && socHistory.length > 0 && (
                <div className="mt-6 pt-6 border-t border-border/50">
                  <div className="flex items-center gap-2 mb-3">
                    <Battery className="size-4 text-energy-battery" />
                    <h3 className="text-sm font-medium">{t("batteryHeading")}</h3>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {t("batteryCurrent", { soc: Math.round(batteryLevel) })}
                    </span>
                  </div>
                  <BatteryChart
                    history={socHistory[0]}
                    period={selectedPeriod}
                    height={120}
                  />
                </div>
              )}
            </div>
          </GlassCard>
        </motion.div>

        {/* Footer */}
        <div className="text-center text-xs text-muted-foreground pt-4">
          {t("footerAutoRefresh")}
        </div>
      </div>
    </main>
  );
}
