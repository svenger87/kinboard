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
  Search,
  Shield,
  Info,
  Monitor,
  Coins,
  Check,
  ArrowLeft,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useHomeAssistantStatus,
  useHomeAssistantEntityStates,
  useMultiEntityHistory,
  useHomeAssistantEntities,
} from "@/hooks";
import { PowerChart } from "@/components/home-assistant/power-chart";
import { BatteryChart } from "@/components/home-assistant/battery-chart";
import { StatisticsCard, StatisticsGrid } from "@/components/home-assistant/statistics-card";
import type { Vehicle } from "@/types/database";
import type { HAEntity } from "@/types/home-assistant";
import type { VehicleDriver } from "./types";

// ---------------------------------------------------------------------------
// TeslaConfig — canonical definition lives here; re-exported from
// @/types/home-assistant for back-compat.
// ---------------------------------------------------------------------------
export interface TeslaConfig {
  // Battery & Charging
  battery_level?: string;           // sensor.xxx_battery_level (%)
  battery_range?: string;           // sensor.xxx_battery_range (km)
  charging_rate?: string;           // sensor.xxx_charging_rate (kW)
  charging_state?: string;          // sensor/binary_sensor for charging state
  charge_limit?: string;            // sensor.xxx_charge_limit (%)
  time_to_full_charge?: string;     // sensor.xxx_time_charge_complete
  charger_power?: string;           // sensor.xxx_charger_power (kW)
  charge_energy_added?: string;     // sensor.xxx_charge_energy_added (kWh)

  // Climate
  inside_temperature?: string;      // sensor.xxx_inside_temperature
  outside_temperature?: string;     // sensor.xxx_outside_temperature
  climate_state?: string;           // climate.xxx or sensor for HVAC state

  // Vehicle Status
  locked?: string;                  // lock.xxx or binary_sensor
  windows?: string;                 // binary_sensor.xxx_windows
  doors?: string;                   // binary_sensor.xxx_doors
  trunk?: string;                   // binary_sensor.xxx_trunk
  frunk?: string;                   // binary_sensor.xxx_frunk

  // Tire Pressure
  tire_pressure_fl?: string;        // sensor.xxx_tire_pressure_front_left
  tire_pressure_fr?: string;        // sensor.xxx_tire_pressure_front_right
  tire_pressure_rl?: string;        // sensor.xxx_tire_pressure_rear_left
  tire_pressure_rr?: string;        // sensor.xxx_tire_pressure_rear_right

  // Vehicle Info
  odometer?: string;                // sensor.xxx_odometer (km)
  location?: string;                // device_tracker.xxx
  state?: string;                   // sensor.xxx_state (online/asleep/driving)

  // Display settings
  show_on_screensaver?: boolean;
  show_on_dashboard?: boolean;

  // Cost (for charging cost calculation)
  cost_per_kwh?: number;
  currency?: string;
}

// ---------------------------------------------------------------------------
// Internal EntitySelector — mirrors the inline component from the legacy
// settings page; kept here so the Tesla driver is self-contained.
// ---------------------------------------------------------------------------
interface EntitySelectorProps {
  label: string;
  description: string;
  value: string | undefined;
  onChange: (value: string) => void;
  entities: HAEntity[];
  allEntities?: HAEntity[];
  filterDomain?: string;
  filterDeviceClass?: string;
}

function EntitySelector({
  label,
  description,
  value,
  onChange,
  entities,
  allEntities,
}: EntitySelectorProps) {
  const t = useTranslations("settings.tesla");
  const [search, setSearch] = useState("");

  const currentEntity = value
    ? (entities.find((e) => e.entity_id === value) ||
       allEntities?.find((e) => e.entity_id === value))
    : undefined;

  const entitiesWithCurrent =
    currentEntity && !entities.find((e) => e.entity_id === value)
      ? [currentEntity, ...entities]
      : entities;

  const filteredEntities = entitiesWithCurrent.filter((entity) => {
    if (value && entity.entity_id === value) return true;
    if (search) {
      const q = search.toLowerCase();
      return (
        entity.name.toLowerCase().includes(q) ||
        entity.entity_id.toLowerCase().includes(q)
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
            .sort((a, b) => {
              const aT = a.entity_id.toLowerCase().includes("tesla") ? 0 : 1;
              const bT = b.entity_id.toLowerCase().includes("tesla") ? 0 : 1;
              return aT - bT || a.name.localeCompare(b.name);
            })
            .slice(0, 100)
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
          {filteredEntities.length > 100 && (
            <div className="px-2 py-1 text-xs text-muted-foreground">
              {t("moreCount", { count: filteredEntities.length - 100 })}
            </div>
          )}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TeslaCard
// ---------------------------------------------------------------------------
type TimePeriod = "today" | "week" | "month";
type BinaryStateKey =
  | "off"
  | "closed"
  | "on"
  | "open"
  | "locked"
  | "unlocked"
  | "opening"
  | "closing"
  | "unavailable"
  | "unknown";
type TeslaLocationKey =
  | "home"
  | "not_home"
  | "work"
  | "school"
  | "unknown"
  | "unavailable";

const BINARY_STATE_KEYS: readonly string[] = [
  "off", "closed", "on", "open", "locked", "unlocked",
  "opening", "closing", "unavailable", "unknown",
];
const TESLA_LOCATION_KEYS: readonly string[] = [
  "home", "not_home", "work", "school", "unknown", "unavailable",
];

export function TeslaCard({ vehicle }: { vehicle: Vehicle }) {
  const t = useTranslations("tesla");
  const tBinary = useTranslations("tesla.binaryState");
  const tLocation = useTranslations("tesla.location");
  const locale = useLocale();
  const intlLocale = locale === "de" ? "de-DE" : "en-US";
  const { data: settings, isLoading: loadingSettings, refetch } =
    useHomeAssistantStatus();
  const teslaConfig = vehicle.config as TeslaConfig;
  const [selectedPeriod, setSelectedPeriod] = useState<TimePeriod>("today");

  const [currentDay, setCurrentDay] = useState(() => new Date().toDateString());
  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date().toDateString();
      if (now !== currentDay) setCurrentDay(now);
    }, 60000);
    return () => clearInterval(interval);
  }, [currentDay]);

  const isConnected = !!settings?.url && !!settings?.access_token;
  const isConfigured =
    Object.keys(teslaConfig).length > 0 && !!teslaConfig.battery_level;

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

  const batteryLevel = getVal(teslaConfig?.battery_level);
  const batteryRange = getVal(teslaConfig?.battery_range);
  const chargingRate = getVal(
    teslaConfig?.charging_rate || teslaConfig?.charger_power
  );
  const chargeLimit = getVal(teslaConfig?.charge_limit);
  const timeToFull = getVal(teslaConfig?.time_to_full_charge);
  const chargeEnergyAdded = getVal(teslaConfig?.charge_energy_added);
  const insideTemp = getVal(teslaConfig?.inside_temperature);
  const outsideTemp = getVal(teslaConfig?.outside_temperature);
  const odometer = getVal(teslaConfig?.odometer);

  const tireUnit = teslaConfig?.tire_pressure_fl
    ? entityMap.get(teslaConfig.tire_pressure_fl)?.attributes
        ?.unit_of_measurement
    : undefined;
  const isPsi = tireUnit === "psi" || tireUnit === "PSI";
  const psiToBar = (psi: number) => psi * 0.0689476;

  const tirePressureFL = isPsi
    ? psiToBar(getVal(teslaConfig?.tire_pressure_fl))
    : getVal(teslaConfig?.tire_pressure_fl);
  const tirePressureFR = isPsi
    ? psiToBar(getVal(teslaConfig?.tire_pressure_fr))
    : getVal(teslaConfig?.tire_pressure_fr);
  const tirePressureRL = isPsi
    ? psiToBar(getVal(teslaConfig?.tire_pressure_rl))
    : getVal(teslaConfig?.tire_pressure_rl);
  const tirePressureRR = isPsi
    ? psiToBar(getVal(teslaConfig?.tire_pressure_rr))
    : getVal(teslaConfig?.tire_pressure_rr);

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

  const formatTimeToFull = (minutes: number): string => {
    if (minutes <= 0) return "";
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    if (hours > 0) return `~${hours}h ${mins}min`;
    return `~${mins}min`;
  };

  const formatBinaryState = (state: string): string =>
    BINARY_STATE_KEYS.includes(state)
      ? tBinary(state as BinaryStateKey)
      : state;

  const formatLocation = (state: string): string =>
    TESLA_LOCATION_KEYS.includes(state)
      ? tLocation(state as TeslaLocationKey)
      : state;

  const chartEntityIds = useMemo(() => {
    if (!teslaConfig) return [];
    return [
      teslaConfig.charging_rate || teslaConfig.charger_power,
      teslaConfig.battery_level,
    ].filter((id): id is string => !!id);
  }, [teslaConfig]);

  const historyStartTime = useMemo(() => {
    const now = new Date(currentDay);
    switch (selectedPeriod) {
      case "today":
        return new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate()
        ).toISOString();
      case "week": {
        const startOfWeek = new Date(now);
        const dayOfWeek = startOfWeek.getDay();
        const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        startOfWeek.setDate(startOfWeek.getDate() - daysToMonday);
        startOfWeek.setHours(0, 0, 0, 0);
        return startOfWeek.toISOString();
      }
      case "month":
        return new Date(
          now.getFullYear(),
          now.getMonth(),
          1
        ).toISOString();
    }
  }, [selectedPeriod, currentDay]);

  const historyEndTime = useMemo(() => {
    if (selectedPeriod === "today") return undefined;
    void currentDay;
    return new Date().toISOString();
  }, [selectedPeriod, currentDay]);

  const { data: chartHistory = [], isLoading: loadingHistory } =
    useMultiEntityHistory(chartEntityIds, historyStartTime, historyEndTime, {
      enabled: isConnected && isConfigured && chartEntityIds.length > 0,
      significantChangesOnly: false,
    });

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

  const periodLabel =
    selectedPeriod === "today"
      ? t("periodToday")
      : selectedPeriod === "week"
      ? t("periodWeek")
      : t("periodMonth");

  // Suppress unused variable warning — loadingEntities is used implicitly
  void loadingEntities;

  if (loadingSettings) {
    return (
      <GlassCard>
        <div className="p-6">
          <div className="flex items-center gap-3">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">
              {t("loadingDashboard")}
            </span>
          </div>
        </div>
      </GlassCard>
    );
  }

  if (!isConnected) {
    return (
      <GlassCard>
        <div className="p-8 text-center">
          <Car className="size-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <h2 className="text-lg font-medium mb-2">
            {t("notConnectedTitle")}
          </h2>
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
    );
  }

  if (!isConfigured) {
    return (
      <GlassCard>
        <div className="p-8 text-center">
          <Car className="size-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <h2 className="text-lg font-medium mb-2">
            {t("notConfiguredTitle")}
          </h2>
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
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Online badge + refresh */}
      <div className="flex items-center gap-2 justify-end">
        <Badge
          variant="outline"
          className={
            isOnline
              ? "border-success/50 text-success"
              : "border-muted-foreground/50 text-muted-foreground"
          }
        >
          {isOnline ? t("online") : t("asleep")}
        </Badge>
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
        <Link href="/settings/tesla">
          <Button variant="ghost" size="icon" aria-label={t("settingsAria")}>
            <Settings className="size-5" />
          </Button>
        </Link>
      </div>

      {/* Hero Card: Car Image + Battery */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <GlassCard>
          <div className="p-6">
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

            <div className="flex items-end justify-between mb-4">
              <div>
                <p className={`text-4xl font-bold ${batteryColor}`}>
                  {Math.round(batteryLevel)}
                  <span className="text-lg text-muted-foreground">%</span>
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("chargeLevelLabel")}
                </p>
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
                        ? t("chargingTimeFormat", {
                            time: formatTimeToFull(timeToFull),
                          })
                        : t("chargingLabel")}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-lg font-semibold text-muted-foreground">
                      {t("notCharging")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("standbyLabel")}
                    </p>
                  </>
                )}
              </div>
              <div className="text-right">
                <p className="text-3xl font-semibold">
                  {Math.round(batteryRange)}
                  <span className="text-sm text-muted-foreground ml-1">km</span>
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("rangeLabelFull")}
                </p>
              </div>
            </div>

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
        <div
          className={`flex items-center gap-3 p-3 rounded-xl ${
            isLocked
              ? "bg-success/10 border border-success/20"
              : "bg-destructive/10 border border-destructive/20"
          }`}
        >
          {isLocked ? (
            <Lock className="size-5 text-success" />
          ) : (
            <Unlock className="size-5 text-destructive" />
          )}
          <div>
            <p className="text-xs text-muted-foreground">{t("doorsLabel")}</p>
            <p
              className={`text-lg font-semibold ${
                isLocked ? "text-success" : "text-destructive"
              }`}
            >
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
              <p className="text-xs text-muted-foreground">
                {t("tempOutside")}
              </p>
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
        <GlassCard>
          <div className="p-6">
            <h2 className="text-lg font-medium mb-4">
              {t("vehicleStatusHeading")}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50">
                <span className="text-sm text-muted-foreground">
                  {t("doorsLabel")}
                </span>
                <span className="text-sm font-medium ml-auto">
                  {formatBinaryState(doorsState)}
                </span>
              </div>
              {teslaConfig?.trunk && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50">
                  <span className="text-sm text-muted-foreground">
                    {t("trunkLabel")}
                  </span>
                  <span className="text-sm font-medium ml-auto">
                    {formatBinaryState(trunkState)}
                  </span>
                </div>
              )}
              {teslaConfig?.frunk && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50">
                  <span className="text-sm text-muted-foreground">
                    {t("frunkLabel")}
                  </span>
                  <span className="text-sm font-medium ml-auto">
                    {formatBinaryState(frunkState)}
                  </span>
                </div>
              )}
              {teslaConfig?.location && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50">
                  <MapPin className="size-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {t("locationLabel")}
                  </span>
                  <span className="text-sm font-medium ml-auto">
                    {formatLocation(locationState)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </GlassCard>

        {teslaConfig?.tire_pressure_fl && (
          <GlassCard>
            <div className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <CircleDot className="size-5 text-muted-foreground" />
                <h2 className="text-lg font-medium">
                  {t("tirePressureHeading")}
                </h2>
                <span className="text-xs text-muted-foreground ml-auto">
                  {t("tirePressureUnit")}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex justify-between p-2.5 rounded-lg bg-muted/50">
                  <span className="text-sm text-muted-foreground">
                    {t("tireFL")}
                  </span>
                  <span className="text-sm font-semibold">
                    {tirePressureFL.toFixed(1)}
                  </span>
                </div>
                <div className="flex justify-between p-2.5 rounded-lg bg-muted/50">
                  <span className="text-sm text-muted-foreground">
                    {t("tireFR")}
                  </span>
                  <span className="text-sm font-semibold">
                    {tirePressureFR.toFixed(1)}
                  </span>
                </div>
                <div className="flex justify-between p-2.5 rounded-lg bg-muted/50">
                  <span className="text-sm text-muted-foreground">
                    {t("tireRL")}
                  </span>
                  <span className="text-sm font-semibold">
                    {tirePressureRL.toFixed(1)}
                  </span>
                </div>
                <div className="flex justify-between p-2.5 rounded-lg bg-muted/50">
                  <span className="text-sm text-muted-foreground">
                    {t("tireRR")}
                  </span>
                  <span className="text-sm font-semibold">
                    {tirePressureRR.toFixed(1)}
                  </span>
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
        <h2 className="text-lg font-medium mb-4">
          {t("vehicleAndChargingHeading")}
        </h2>
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
              <h2 className="text-lg font-medium">
                {t("chargingChartHeading")}
              </h2>
              <Tabs
                value={selectedPeriod}
                onValueChange={(v) => setSelectedPeriod(v as TimePeriod)}
              >
                <TabsList>
                  <TabsTrigger value="today" className="text-xs">
                    {t("tabToday")}
                  </TabsTrigger>
                  <TabsTrigger value="week" className="text-xs">
                    {t("tabWeek")}
                  </TabsTrigger>
                  <TabsTrigger value="month" className="text-xs">
                    {t("tabMonth")}
                  </TabsTrigger>
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
                  ...(teslaConfig?.charging_rate || teslaConfig?.charger_power
                    ? [
                        {
                          entityId: (teslaConfig.charging_rate ||
                            teslaConfig.charger_power)!,
                          label: t("chartLineChargingPower"),
                          color: "#3b82f6",
                        },
                      ]
                    : []),
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

      <div className="text-center text-xs text-muted-foreground pt-4">
        {t("footerAutoRefresh")}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TeslaConfigForm
// ---------------------------------------------------------------------------
export function TeslaConfigForm({
  vehicle,
  onConfigChange,
}: {
  vehicle: Vehicle;
  onConfigChange: (config: TeslaConfig) => void;
}) {
  const t = useTranslations("settings.tesla");
  const { data: settings, isLoading: loadingSettings } =
    useHomeAssistantStatus();
  const { data: entities = [] } = useHomeAssistantEntities(
    undefined,
    !!settings?.url
  );

  const [editingConfig, setEditingConfig] = useState<TeslaConfig>(
    vehicle.config as TeslaConfig
  );

  // Keep local state in sync if the vehicle row is refreshed externally
  useEffect(() => {
    setEditingConfig(vehicle.config as TeslaConfig);
  }, [vehicle.config]);

  const isConnected = !!settings?.url && !!settings?.access_token;

  const updateField = (
    field: keyof TeslaConfig,
    value: string | number | boolean | undefined
  ) => {
    setEditingConfig((prev) => {
      const next = { ...prev, [field]: value === "" ? undefined : value };
      onConfigChange(next);
      return next;
    });
  };

  if (loadingSettings) {
    return (
      <GlassCard>
        <div className="p-6">
          <div className="flex items-center gap-3">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">{t("loadingHint")}</span>
          </div>
        </div>
      </GlassCard>
    );
  }

  if (!isConnected) {
    return (
      <GlassCard>
        <div className="p-8 text-center">
          <Car className="size-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <h2 className="text-lg font-medium mb-2">
            {t("notConnectedTitle")}
          </h2>
          <p className="text-muted-foreground">
            {t("notConnectedDescription")}
          </p>
          <div className="mt-4">
            <Link href="/settings/homeassistant">
              <Button variant="outline" size="sm">
                <ArrowLeft className="size-4 mr-2" />
                {t("backLink")}
              </Button>
            </Link>
          </div>
        </div>
      </GlassCard>
    );
  }

  const isTesla = (e: HAEntity) =>
    e.entity_id.toLowerCase().includes("tesla");

  const allEntities = entities;

  const batterySensors = entities.filter(
    (e) =>
      (e.domain === "sensor" &&
        (e.attributes.device_class === "battery" ||
          e.attributes.unit_of_measurement === "%" ||
          e.entity_id.includes("battery") ||
          e.entity_id.includes("charge"))) ||
      isTesla(e)
  );

  const temperatureSensors = entities.filter(
    (e) =>
      (e.domain === "sensor" &&
        (e.attributes.device_class === "temperature" ||
          e.attributes.unit_of_measurement === "°C" ||
          e.attributes.unit_of_measurement === "°F")) ||
      (isTesla(e) &&
        (e.entity_id.includes("temp") || e.entity_id.includes("climate")))
  );

  const powerSensors = entities.filter(
    (e) =>
      (e.domain === "sensor" &&
        (e.attributes.device_class === "power" ||
          e.attributes.unit_of_measurement === "W" ||
          e.attributes.unit_of_measurement === "kW")) ||
      (isTesla(e) &&
        (e.entity_id.includes("power") ||
          e.entity_id.includes("charg") ||
          e.entity_id.includes("rate")))
  );

  const energySensors = entities.filter(
    (e) =>
      (e.domain === "sensor" &&
        (e.attributes.device_class === "energy" ||
          e.attributes.unit_of_measurement === "kWh" ||
          e.attributes.unit_of_measurement === "Wh")) ||
      (isTesla(e) &&
        (e.entity_id.includes("energy") || e.entity_id.includes("added")))
  );

  const distanceSensors = entities.filter(
    (e) =>
      (e.domain === "sensor" &&
        (e.attributes.device_class === "distance" ||
          e.attributes.unit_of_measurement === "km" ||
          e.attributes.unit_of_measurement === "mi" ||
          e.entity_id.includes("range") ||
          e.entity_id.includes("odometer"))) ||
      (isTesla(e) &&
        (e.entity_id.includes("range") ||
          e.entity_id.includes("odometer") ||
          e.entity_id.includes("distance")))
  );

  const pressureSensors = entities.filter(
    (e) =>
      (e.domain === "sensor" &&
        (e.attributes.device_class === "pressure" ||
          e.attributes.unit_of_measurement === "bar" ||
          e.attributes.unit_of_measurement === "psi" ||
          e.attributes.unit_of_measurement === "kPa" ||
          e.entity_id.includes("tire_pressure"))) ||
      (isTesla(e) && e.entity_id.includes("tire"))
  );

  const vehicleStatusEntities = entities.filter(
    (e) =>
      e.domain === "lock" ||
      (e.domain === "binary_sensor" && isTesla(e)) ||
      isTesla(e)
  );

  const locationEntities = entities.filter(
    (e) =>
      e.domain === "device_tracker" ||
      (isTesla(e) &&
        (e.entity_id.includes("location") ||
          e.entity_id.includes("destination") ||
          e.entity_id.includes("park")))
  );

  const teslaEntities = entities.filter((e) => isTesla(e));

  const climateEntities = entities.filter(
    (e) =>
      e.domain === "climate" ||
      (isTesla(e) &&
        (e.entity_id.includes("climate") || e.entity_id.includes("hvac")))
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Battery & Charging */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <GlassCard>
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg bg-success/10">
                <Battery className="size-5 text-success" />
              </div>
              <h2 className="font-medium">{t("batteryHeading")}</h2>
            </div>

            <div className="flex flex-col gap-4">
              <EntitySelector
                label={t("batteryLevelLabel")}
                description={t("batteryLevelDescription")}
                value={editingConfig.battery_level}
                onChange={(v) => updateField("battery_level", v)}
                entities={batterySensors}
                allEntities={allEntities}
              />
              <EntitySelector
                label={t("rangeLabel")}
                description={t("rangeDescription")}
                value={editingConfig.battery_range}
                onChange={(v) => updateField("battery_range", v)}
                entities={distanceSensors}
                allEntities={allEntities}
              />
              <EntitySelector
                label={t("chargeRateLabel")}
                description={t("chargeRateDescription")}
                value={editingConfig.charging_rate}
                onChange={(v) => updateField("charging_rate", v)}
                entities={powerSensors}
                allEntities={allEntities}
              />
              <EntitySelector
                label={t("chargeStateLabel")}
                description={t("chargeStateDescription")}
                value={editingConfig.charging_state}
                onChange={(v) => updateField("charging_state", v)}
                entities={teslaEntities}
                allEntities={allEntities}
              />
              <EntitySelector
                label={t("chargeLimitLabel")}
                description={t("chargeLimitDescription")}
                value={editingConfig.charge_limit}
                onChange={(v) => updateField("charge_limit", v)}
                entities={batterySensors}
                allEntities={allEntities}
              />
              <EntitySelector
                label={t("timeToFullLabel")}
                description={t("timeToFullDescription")}
                value={editingConfig.time_to_full_charge}
                onChange={(v) => updateField("time_to_full_charge", v)}
                entities={teslaEntities}
                allEntities={allEntities}
              />
              <EntitySelector
                label={t("chargerPowerLabel")}
                description={t("chargerPowerDescription")}
                value={editingConfig.charger_power}
                onChange={(v) => updateField("charger_power", v)}
                entities={powerSensors}
                allEntities={allEntities}
              />
              <EntitySelector
                label={t("chargeEnergyAddedLabel")}
                description={t("chargeEnergyAddedDescription")}
                value={editingConfig.charge_energy_added}
                onChange={(v) => updateField("charge_energy_added", v)}
                entities={energySensors}
                allEntities={allEntities}
              />
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* Climate */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <GlassCard>
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg bg-orange-500/10">
                <Thermometer className="size-5 text-orange-500" />
              </div>
              <h2 className="font-medium">{t("climateHeading")}</h2>
            </div>

            <div className="flex flex-col gap-4">
              <EntitySelector
                label={t("insideTempLabel")}
                description={t("insideTempDescription")}
                value={editingConfig.inside_temperature}
                onChange={(v) => updateField("inside_temperature", v)}
                entities={temperatureSensors}
                allEntities={allEntities}
              />
              <EntitySelector
                label={t("outsideTempLabel")}
                description={t("outsideTempDescription")}
                value={editingConfig.outside_temperature}
                onChange={(v) => updateField("outside_temperature", v)}
                entities={temperatureSensors}
                allEntities={allEntities}
              />
              <EntitySelector
                label={t("climateStateLabel")}
                description={t("climateStateDescription")}
                value={editingConfig.climate_state}
                onChange={(v) => updateField("climate_state", v)}
                entities={climateEntities}
                allEntities={allEntities}
              />
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* Vehicle Status */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <GlassCard>
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg bg-destructive/10">
                <Shield className="size-5 text-destructive" />
              </div>
              <h2 className="font-medium">{t("vehicleStatusHeading")}</h2>
            </div>

            <div className="flex flex-col gap-4">
              <EntitySelector
                label={t("lockedLabel")}
                description={t("lockedDescription")}
                value={editingConfig.locked}
                onChange={(v) => updateField("locked", v)}
                entities={vehicleStatusEntities}
                allEntities={allEntities}
              />
              <EntitySelector
                label={t("windowsLabel")}
                description={t("windowsDescription")}
                value={editingConfig.windows}
                onChange={(v) => updateField("windows", v)}
                entities={vehicleStatusEntities}
                allEntities={allEntities}
              />
              <EntitySelector
                label={t("doorsLabel")}
                description={t("doorsDescription")}
                value={editingConfig.doors}
                onChange={(v) => updateField("doors", v)}
                entities={vehicleStatusEntities}
                allEntities={allEntities}
              />
              <EntitySelector
                label={t("trunkLabel")}
                description={t("trunkDescription")}
                value={editingConfig.trunk}
                onChange={(v) => updateField("trunk", v)}
                entities={vehicleStatusEntities}
                allEntities={allEntities}
              />
              <EntitySelector
                label={t("frunkLabel")}
                description={t("frunkDescription")}
                value={editingConfig.frunk}
                onChange={(v) => updateField("frunk", v)}
                entities={vehicleStatusEntities}
                allEntities={allEntities}
              />
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* Tire Pressure */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <GlassCard>
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg bg-warning/10">
                <Gauge className="size-5 text-warning" />
              </div>
              <h2 className="font-medium">{t("tirePressureHeading")}</h2>
            </div>

            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <EntitySelector
                  label={t("tireFLLabel")}
                  description={t("tireFLDescription")}
                  value={editingConfig.tire_pressure_fl}
                  onChange={(v) => updateField("tire_pressure_fl", v)}
                  entities={pressureSensors}
                  allEntities={allEntities}
                />
                <EntitySelector
                  label={t("tireFRLabel")}
                  description={t("tireFRDescription")}
                  value={editingConfig.tire_pressure_fr}
                  onChange={(v) => updateField("tire_pressure_fr", v)}
                  entities={pressureSensors}
                  allEntities={allEntities}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <EntitySelector
                  label={t("tireRLLabel")}
                  description={t("tireRLDescription")}
                  value={editingConfig.tire_pressure_rl}
                  onChange={(v) => updateField("tire_pressure_rl", v)}
                  entities={pressureSensors}
                  allEntities={allEntities}
                />
                <EntitySelector
                  label={t("tireRRLabel")}
                  description={t("tireRRDescription")}
                  value={editingConfig.tire_pressure_rr}
                  onChange={(v) => updateField("tire_pressure_rr", v)}
                  entities={pressureSensors}
                  allEntities={allEntities}
                />
              </div>
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* Vehicle Info */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <GlassCard>
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg bg-info/10">
                <Info className="size-5 text-info" />
              </div>
              <h2 className="font-medium">{t("vehicleInfoHeading")}</h2>
            </div>

            <div className="flex flex-col gap-4">
              <EntitySelector
                label={t("odometerLabel")}
                description={t("odometerDescription")}
                value={editingConfig.odometer}
                onChange={(v) => updateField("odometer", v)}
                entities={distanceSensors}
                allEntities={allEntities}
              />
              <EntitySelector
                label={t("locationLabel")}
                description={t("locationDescription")}
                value={editingConfig.location}
                onChange={(v) => updateField("location", v)}
                entities={locationEntities}
                allEntities={allEntities}
              />
              <EntitySelector
                label={t("stateLabel")}
                description={t("stateDescription")}
                value={editingConfig.state}
                onChange={(v) => updateField("state", v)}
                entities={teslaEntities}
                allEntities={allEntities}
              />
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* Display toggles */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        <GlassCard>
          <div className="p-6">
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-purple-500/10">
                    <Monitor className="size-5 text-purple-500" />
                  </div>
                  <div>
                    <Label className="font-medium">
                      {t("displayScreensaverLabel")}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {t("displayScreensaverDescription")}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={editingConfig.show_on_screensaver ?? false}
                  onCheckedChange={(v) =>
                    updateField("show_on_screensaver", v)
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-purple-500/10">
                    <Monitor className="size-5 text-purple-500" />
                  </div>
                  <div>
                    <Label className="font-medium">
                      {t("displayDashboardLabel")}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {t("displayDashboardDescription")}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={editingConfig.show_on_dashboard ?? false}
                  onCheckedChange={(v) =>
                    updateField("show_on_dashboard", v)
                  }
                />
              </div>
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* Costs */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
      >
        <GlassCard>
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg bg-cyan-500/10">
                <Coins className="size-5 text-cyan-500" />
              </div>
              <h2 className="font-medium">{t("costsHeading")}</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label>{t("costPerKwhLabel")}</Label>
                <div className="relative">
                  <Input
                    type="number"
                    step="0.01"
                    placeholder={t("costPerKwhPlaceholder")}
                    value={editingConfig.cost_per_kwh || ""}
                    onChange={(e) =>
                      updateField(
                        "cost_per_kwh",
                        parseFloat(e.target.value) || undefined
                      )
                    }
                    className="pr-16"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                    €/kWh
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label>{t("currencyLabel")}</Label>
                <Input
                  type="text"
                  placeholder={t("currencyPlaceholder")}
                  value={editingConfig.currency || ""}
                  onChange={(e) => updateField("currency", e.target.value)}
                />
              </div>
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* Saved indicator — parent controls actual persistence */}
      <div className="flex justify-end">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Check className="size-4" />
          {t("autoSaveHint", { defaultMessage: "Changes saved automatically" })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Driver export
// ---------------------------------------------------------------------------
export const teslaDriver: VehicleDriver<TeslaConfig> = {
  id: "tesla",
  displayNameKey: "tesla",
  icon: Car,
  defaultConfig: {},
  Card: TeslaCard,
  ConfigForm: TeslaConfigForm,
  isConfigured: (c) => Boolean(c.battery_level && c.state),
};
