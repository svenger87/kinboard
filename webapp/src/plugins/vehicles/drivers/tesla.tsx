"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { useTranslations, useLocale } from "next-intl";
import { getIntlLocale } from "@/i18n/intl-locale";
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
  ArrowLeft,
} from "lucide-react";
import { DEFAULT_KWH_PRICE, parsePrice } from "@/lib/tariff";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
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
import { formatReading, READING_DIGITS } from "@/plugins/vehicles/entity-read";
import { readVehicle, vehicleEntityIds } from "@/plugins/vehicles/readings";
import { EntitySelector } from "@/plugins/vehicles/components/entity-selector";

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
  const intlLocale = getIntlLocale(locale);
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

  // The list of ids and the reads below come from the same key list, so a new
  // field cannot be rendered without also being fetched.
  const entityIds = useMemo(() => vehicleEntityIds(teslaConfig), [teslaConfig]);

  const {
    data: entities = [],
    isLoading: loadingEntities,
    isFetching,
  } = useHomeAssistantEntityStates(entityIds, isConnected && isConfigured);

  const entityMap = useMemo(
    () => new Map(entities.map((e) => [e.entity_id, e])),
    [entities]
  );

  // Every read goes through the shared resolver: units come from the entities,
  // "unknown" stays absent instead of becoming 0, and the charging test copes
  // with enum sensors, binary sensors and other vendors' capitalisation.
  const r = useMemo(() => readVehicle(teslaConfig, entityMap), [teslaConfig, entityMap]);

  const batteryLevel = r.battery?.value ?? 0;
  const timeToFull = r.minutesToFull;
  const isCharging = r.charging;
  const isLocked = r.locked === true;
  const isOnline = r.online === true;

  const locationState = r.locationState ?? "unknown";
  const climateState = r.climateState ?? "unknown";
  const vehicleState = r.vehicleState ?? "unknown";
  const doorsState = r.doorsOpen == null ? "unknown" : r.doorsOpen ? "open" : "closed";
  const windowsState = r.windowsOpen == null ? "unknown" : r.windowsOpen ? "open" : "closed";
  const trunkState = r.trunkOpen == null ? "unknown" : r.trunkOpen ? "open" : "closed";
  const frunkState = r.frunkOpen == null ? "unknown" : r.frunkOpen ? "open" : "closed";

  const fmt = (reading: Parameters<typeof formatReading>[0], digits: number) =>
    formatReading(reading, { digits, locale: intlLocale });
  /** The number alone, for grids that print the unit once in their heading. */
  const fmtBare = (reading: Parameters<typeof formatReading>[0], digits: number) =>
    formatReading(reading ? { value: reading.value, unit: null } : null, {
      digits,
      locale: intlLocale,
    });

  // All four corners come from the same integration, so they share a unit —
  // but it is read rather than assumed. It used to be printed as "bar" for
  // everyone, with psi silently converted to match the label.
  const tyreUnit =
    r.tyres.fl?.unit ?? r.tyres.fr?.unit ?? r.tyres.rl?.unit ?? r.tyres.rr?.unit ?? null;

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
      <Card>
        <div className="p-6">
          <div className="flex items-center gap-3">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">
              {t("loadingDashboard")}
            </span>
          </div>
        </div>
      </Card>
    );
  }

  if (!isConnected) {
    return (
      <Card>
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
      </Card>
    );
  }

  if (!isConfigured) {
    return (
      <Card>
        <div className="p-8 text-center">
          <Car className="size-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <h2 className="text-lg font-medium mb-2">
            {t("notConfiguredTitle")}
          </h2>
          <p className="text-muted-foreground mb-6">
            {t("notConfiguredDescription")}
          </p>
          <Link href={`/settings/vehicles/${vehicle.id}`}>
            <Button>
              <Settings className="size-4 mr-2" />
              {t("notConfiguredAction")}
            </Button>
          </Link>
        </div>
      </Card>
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
      </div>

      {/* Hero Card: Car Image + Battery */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <Card>
          <div className="p-6">
            <div className="flex justify-center mb-6">
              <Image
                src={vehicle.image_url ?? "/images/tesla-model-y.png"}
                alt={vehicle.image_url ? vehicle.nickname : "Tesla Model Y"}
                width={400}
                height={170}
                className="drop-shadow-lg"
                priority
                unoptimized={Boolean(vehicle.image_url)}
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
                        {fmt(r.power, READING_DIGITS.power)}
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
                  {fmt(r.range, READING_DIGITS.distance)}
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
              {r.chargeLimit != null && r.chargeLimit.value > 0 && (
                <div
                  className="absolute inset-y-0 w-0.5 bg-foreground/50"
                  style={{ left: `${Math.min(100, r.chargeLimit.value)}%` }}
                  title={t("chargeLimitLabel", { percent: Math.round(r.chargeLimit.value) })}
                />
              )}
            </div>
            {r.chargeLimit != null && r.chargeLimit.value > 0 && (
              <p className="text-xs text-muted-foreground mt-1 text-right">
                {t("chargeLimitLabel", { percent: Math.round(r.chargeLimit.value) })}
              </p>
            )}
          </div>
        </Card>
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
                {fmt(r.insideTemp, READING_DIGITS.temperature)}
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
                {fmt(r.outsideTemp, READING_DIGITS.temperature)}
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
        <Card>
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
        </Card>

        {teslaConfig?.tire_pressure_fl && (
          <Card>
            <div className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <CircleDot className="size-5 text-muted-foreground" />
                <h2 className="text-lg font-medium">
                  {t("tirePressureHeading")}
                </h2>
                {tyreUnit && (
                  <span className="text-xs text-muted-foreground ml-auto">
                    {tyreUnit}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex justify-between p-2.5 rounded-lg bg-muted/50">
                  <span className="text-sm text-muted-foreground">
                    {t("tireFL")}
                  </span>
                  <span className="text-sm font-semibold">
                    {fmtBare(r.tyres.fl, READING_DIGITS.pressure)}
                  </span>
                </div>
                <div className="flex justify-between p-2.5 rounded-lg bg-muted/50">
                  <span className="text-sm text-muted-foreground">
                    {t("tireFR")}
                  </span>
                  <span className="text-sm font-semibold">
                    {fmtBare(r.tyres.fr, READING_DIGITS.pressure)}
                  </span>
                </div>
                <div className="flex justify-between p-2.5 rounded-lg bg-muted/50">
                  <span className="text-sm text-muted-foreground">
                    {t("tireRL")}
                  </span>
                  <span className="text-sm font-semibold">
                    {fmtBare(r.tyres.rl, READING_DIGITS.pressure)}
                  </span>
                </div>
                <div className="flex justify-between p-2.5 rounded-lg bg-muted/50">
                  <span className="text-sm text-muted-foreground">
                    {t("tireRR")}
                  </span>
                  <span className="text-sm font-semibold">
                    {fmtBare(r.tyres.rr, READING_DIGITS.pressure)}
                  </span>
                </div>
              </div>
            </div>
          </Card>
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
              value={fmtBare(r.odometer, READING_DIGITS.distance)}
              unit={r.odometer?.unit ?? undefined}
              icon={<Gauge className="size-4" />}
              color="default"
            />
          )}
          {teslaConfig?.charge_energy_added && (
            <StatisticsCard
              title={t("statSessionEnergy")}
              value={fmtBare(r.energyAdded, READING_DIGITS.energy)}
              unit={r.energyAdded?.unit ?? undefined}
              icon={<Zap className="size-4" />}
              color="grid"
            />
          )}
          {teslaConfig?.charge_energy_added && (
            <StatisticsCard
              title={t("statSessionCost")}
              value={(r.energyAdded?.value ?? 0) * (teslaConfig.cost_per_kwh ?? DEFAULT_KWH_PRICE)}
              unit={teslaConfig.currency || "€"}
              format="currency"
              icon={<Battery className="size-4" />}
              color="danger"
            />
          )}
          {teslaConfig?.charge_limit && (
            <StatisticsCard
              title={t("statChargeLimit")}
              value={r.chargeLimit ? Math.round(r.chargeLimit.value) : 0}
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
        <Card>
          <div className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <h2 className="text-lg font-medium">
                {t("chargingChartHeading")}
              </h2>
              <SegmentedControl value={selectedPeriod}
              onValueChange={(v) => setSelectedPeriod(v as TimePeriod)}>
                
                <SegmentedControlItem value="today" className="text-xs">
                  {t("tabToday")}
                </SegmentedControlItem>
                <SegmentedControlItem value="week" className="text-xs">
                  {t("tabWeek")}
                </SegmentedControlItem>
                <SegmentedControlItem value="month" className="text-xs">
                  {t("tabMonth")}
                </SegmentedControlItem>
              </SegmentedControl>
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
        </Card>
      </motion.div>

      <div className="text-center text-xs text-muted-foreground pt-4">
        {t("footerAutoRefresh")}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TeslaWidgetCard — compact dashboard render: hero only (image + battery + charging/range)
// ---------------------------------------------------------------------------
export function TeslaWidgetCard({ vehicle }: { vehicle: Vehicle }) {
  const t = useTranslations("tesla");
  const locale = useLocale();
  const intlLocale = getIntlLocale(locale);
  const config = vehicle.config as TeslaConfig;
  const { data: settings } = useHomeAssistantStatus();
  const haConnected = Boolean(settings?.url && settings?.access_token);

  const entityIds = useMemo(
    () =>
      [
        config?.battery_level,
        config?.battery_range,
        config?.charging_rate,
        config?.charger_power,
        config?.charging_state,
      ].filter((id): id is string => !!id),
    [config],
  );

  const { data: entities = [] } = useHomeAssistantEntityStates(
    entityIds,
    haConnected && entityIds.length > 0,
  );

  const entityMap = useMemo(
    () => new Map(entities.map((e) => [e.entity_id, e])),
    [entities],
  );

  const r = useMemo(() => readVehicle(config, entityMap), [config, entityMap]);
  const batteryLevel = r.battery?.value ?? 0;
  const isCharging = r.charging;

  const batteryColor =
    batteryLevel > 60
      ? "text-success"
      : batteryLevel > 20
        ? "text-warning"
        : "text-destructive";

  if (!haConnected) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">{t("notConnectedTitle")}</p>
      </Card>
    );
  }
  if (entityIds.length === 0) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">{t("notConfiguredTitle")}</p>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex justify-center mb-3">
        <Image
          src={vehicle.image_url ?? "/images/tesla-model-y.png"}
          alt={vehicle.image_url ? vehicle.nickname : "Tesla Model Y"}
          width={300}
          height={128}
          className="drop-shadow-lg"
          unoptimized={Boolean(vehicle.image_url)}
        />
      </div>
      <div className="flex items-end justify-between">
        <div>
          <p className={`text-3xl font-bold ${batteryColor}`}>
            {Math.round(batteryLevel)}
            <span className="text-base text-muted-foreground">%</span>
          </p>
          <p className="text-xs text-muted-foreground">{vehicle.nickname}</p>
        </div>
        <div className="text-right">
          {isCharging ? (
            <div className="flex items-center gap-1 text-energy-grid">
              <Zap className="size-4" />
              <span className="text-sm font-semibold">
                {formatReading(r.power, { digits: READING_DIGITS.power, locale: intlLocale })}
              </span>
            </div>
          ) : (
            <p className="text-2xl font-semibold">
              {formatReading(r.range, { digits: READING_DIGITS.distance, locale: intlLocale })}
            </p>
          )}
        </div>
      </div>
    </Card>
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

  // Which entities belong to *this* car.
  //
  // This used to be `entity_id.includes("tesla")`, which is true of almost no
  // real installation: Home Assistant names entities after the device, so a
  // Model Y called "Model Y" produces `sensor.model_y_batteriestand` and not a
  // "tesla" in sight. Every curated list below came back empty and the whole
  // picker fell back to "show all entities".
  //
  // The prefix is inferred from whatever is already configured — the first
  // entity the owner picked tells us what the rest are called — and "tesla" is
  // kept as the opening guess for a car that has nothing configured yet.
  const devicePrefix = useMemo(() => {
    for (const id of vehicleEntityIds(editingConfig)) {
      const [, object] = id.split(".", 2);
      if (!object) continue;
      // Two segments is enough to identify a device without matching half the
      // house: "model_y" from "model_y_batteriestand".
      const parts = object.split("_");
      if (parts.length >= 2) return `${parts[0]}_${parts[1]}`;
      if (parts[0]) return parts[0];
    }
    return null;
  }, [editingConfig]);

  // Tracks whether the user has touched the form. Once dirty, server refetches
  // don't clobber in-progress edits.
  const dirtyRef = useRef(false);

  // Sync edit state from server only until the user starts editing.
  useEffect(() => {
    if (dirtyRef.current) return;
    setEditingConfig(vehicle.config as TeslaConfig);
  }, [vehicle.config]);

  // Reset dirty flag when switching to a different vehicle.
  useEffect(() => {
    dirtyRef.current = false;
  }, [vehicle.id]);

  const isConnected = !!settings?.url && !!settings?.access_token;

  const updateEditingConfig = useCallback(
    (updater: TeslaConfig | ((prev: TeslaConfig) => TeslaConfig)) => {
      dirtyRef.current = true;
      setEditingConfig(updater as TeslaConfig);
    },
    []
  );

  const updateField = (
    field: keyof TeslaConfig,
    value: string | number | boolean | undefined
  ) => {
    updateEditingConfig((prev) => {
      const next = { ...prev, [field]: value === "" ? undefined : value };
      onConfigChange(next);
      return next;
    });
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
      </Card>
    );
  }


  const isTesla = (e: HAEntity) => {
    const id = e.entity_id.toLowerCase();
    if (devicePrefix && id.includes(devicePrefix.toLowerCase())) return true;
    return id.includes("tesla");
  };

  const allEntities = entities;

  const batterySensors = entities.filter(
    (e) =>
      ((e.domain === "sensor" || e.domain === "number" || e.domain === "input_number") &&
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
        </Card>
      </motion.div>

      {/* Climate */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <Card>
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
        </Card>
      </motion.div>

      {/* Vehicle Status */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <Card>
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
        </Card>
      </motion.div>

      {/* Tire Pressure */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <Card>
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
        </Card>
      </motion.div>

      {/* Vehicle Info */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <Card>
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
        </Card>
      </motion.div>

      {/* Display toggles */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        <Card>
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
                  aria-label={t("displayScreensaverDescription")}
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
                  aria-label={t("displayDashboardDescription")}
                  checked={editingConfig.show_on_dashboard ?? false}
                  onCheckedChange={(v) =>
                    updateField("show_on_dashboard", v)
                  }
                />
              </div>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Costs */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
      >
        <Card>
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
                    value={editingConfig.cost_per_kwh ?? ""}
                    onChange={(e) => updateField("cost_per_kwh", parsePrice(e.target.value))}
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
        </Card>
      </motion.div>

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
  WidgetCard: TeslaWidgetCard,
  ConfigForm: TeslaConfigForm,
  isConfigured: (c) => Boolean(c.battery_level && c.state),
};
