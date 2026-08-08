"use client";

/**
 * Every electric car that is not a Tesla.
 *
 * This driver used to read five entities, print their states raw and ask
 * owners to type entity ids into a text box — so a BMW showed "57.0%",
 * "295.94226816 km" and an untranslated "NOT_CHARGING", while a Tesla got a
 * finished card. The car is not the hard part: BMW ConnectedDrive, VW We
 * Connect, Kia/Hyundai Bluelink, Renault, Polestar, Volvo and MG all expose
 * the same handful of things through Home Assistant, under different entity
 * names. Naming which entity fills which slot is the only vendor-specific work
 * there is.
 *
 * So this now uses the same resolver, the same formatting and the same entity
 * picker as the Tesla driver. What it deliberately does not have is Tesla's
 * charts and charging-cost panel, which depend on long-run history the other
 * integrations do not all keep.
 */

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Car,
  MapPin,
  Zap,
  Thermometer,
  Lock,
  Unlock,
  Gauge,
  DoorOpen,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  useHomeAssistantStatus,
  useHomeAssistantEntities,
  useHomeAssistantEntityStates,
} from "@/hooks";
import { Card } from "@/components/ui/card";
import { getIntlLocale } from "@/i18n/intl-locale";
import type { Vehicle } from "@/types/database";
import type { HAEntity } from "@/types/home-assistant";
import type { VehicleDriver } from "./types";
import { formatReading, READING_DIGITS } from "../entity-read";
import { readVehicle, vehicleEntityIds, type VehicleEntityConfig } from "../readings";
import { EntitySelector } from "../components/entity-selector";

/**
 * The shared slots, plus the one legacy key this driver shipped with.
 *
 * `range` predates the shared contract. Configs in the wild still hold it, so
 * it is read as `battery_range` rather than migrated — a settings blob is not
 * worth a migration, and dropping it would blank the range on every existing
 * generic vehicle.
 */
export interface GenericEvConfig extends VehicleEntityConfig {
  /** @deprecated Use `battery_range`. Still read, for configs written before 1.8. */
  range?: string;
}

/** Fold the legacy key into the shared shape. */
function normalise(config: GenericEvConfig | undefined): VehicleEntityConfig {
  if (!config) return {};
  return { ...config, battery_range: config.battery_range ?? config.range };
}

function useVehicle(config: GenericEvConfig | undefined, enabled: boolean) {
  const normalised = useMemo(() => normalise(config), [config]);
  const entityIds = useMemo(() => vehicleEntityIds(normalised), [normalised]);
  const { data: entities = [] } = useHomeAssistantEntityStates(
    entityIds,
    enabled && entityIds.length > 0,
  );
  const entityMap = useMemo(
    () => new Map(entities.map((e) => [e.entity_id, e])),
    [entities],
  );
  const readings = useMemo(
    () => readVehicle(normalised, entityMap),
    [normalised, entityMap],
  );
  return { readings, entityIds };
}

function GenericEvCard({ vehicle }: { vehicle: Vehicle }) {
  const t = useTranslations("vehicles.drivers.generic-ev");
  const tState = useTranslations("vehicles.state");
  const locale = useLocale();
  const intlLocale = getIntlLocale(locale);
  const config = vehicle.config as GenericEvConfig;
  const { data: ha } = useHomeAssistantStatus();
  const haConnected = Boolean(ha?.url && ha?.access_token);
  const { readings: r, entityIds } = useVehicle(config, haConnected);

  const fmt = (reading: Parameters<typeof formatReading>[0], digits: number) =>
    formatReading(reading, { digits, locale: intlLocale });

  if (!haConnected) {
    return <Card className="p-6 text-muted-foreground">{t("haNotConnected")}</Card>;
  }
  if (entityIds.length === 0) {
    return <Card className="p-6 text-muted-foreground">{t("notConfigured")}</Card>;
  }

  const battery = r.battery?.value ?? 0;
  const batteryColor =
    battery > 60 ? "text-success" : battery > 20 ? "text-warning" : "text-destructive";
  const batteryBg =
    battery > 60 ? "bg-success" : battery > 20 ? "bg-warning" : "bg-destructive";

  const hours = Math.floor(r.minutesToFull / 60);
  const mins = r.minutesToFull % 60;
  const eta = hours > 0 ? `~${hours}h ${mins}min` : `~${mins}min`;

  const openState = (open: boolean | null) =>
    open == null ? tState("unknown") : open ? tState("open") : tState("closed");

  // device_tracker states are `home` / `not_home` plus whatever zones the
  // household has named. The two standard ones get translated; a zone name is
  // already human-readable and is shown as-is.
  const locationLabel = (state: string | null) => {
    if (!state) return tState("unknown");
    if (state === "home") return tState("home");
    if (state === "not_home") return tState("away");
    return state;
  };

  return (
    <div className="space-y-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="overflow-hidden">
          {vehicle.image_url && (
            <img
              src={vehicle.image_url}
              alt={vehicle.nickname}
              className="w-full max-h-48 object-contain bg-muted/30"
            />
          )}
          <div className="p-6 space-y-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-2xl font-display font-light truncate">
                {vehicle.nickname}
              </h2>
              {r.online != null && (
                <span className="text-xs text-muted-foreground">
                  {r.online ? tState("online") : tState("asleep")}
                </span>
              )}
            </div>

            <div className="grid grid-cols-3 gap-4 items-end">
              <div>
                <p className={`text-4xl font-semibold ${batteryColor}`}>
                  {r.battery ? `${Math.round(r.battery.value)}%` : "—"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">{t("batteryLabel")}</p>
              </div>

              <div className="text-center">
                {r.charging ? (
                  <>
                    <div className="flex items-center gap-1.5 justify-center">
                      <Zap className="size-4 text-energy-grid" />
                      <span className="text-lg font-semibold text-energy-grid">
                        {fmt(r.power, READING_DIGITS.power)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {r.minutesToFull > 0 ? `${t("charging")} · ${eta}` : t("charging")}
                    </p>
                  </>
                ) : (
                  <p className="text-lg font-semibold text-muted-foreground">
                    {t("notCharging")}
                  </p>
                )}
              </div>

              <div className="text-right">
                <p className="text-3xl font-semibold">
                  {fmt(r.range, READING_DIGITS.distance)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">{t("rangeLabel")}</p>
              </div>
            </div>

            <div className="relative h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={`absolute inset-y-0 left-0 ${batteryBg} rounded-full transition-all duration-500`}
                style={{ width: `${Math.min(100, battery)}%` }}
              />
              {r.chargeLimit != null && r.chargeLimit.value > 0 && (
                <div
                  className="absolute inset-y-0 w-0.5 bg-foreground/50"
                  style={{ left: `${Math.min(100, r.chargeLimit.value)}%` }}
                />
              )}
            </div>
          </div>
        </Card>
      </motion.div>

      {(config.inside_temperature || config.outside_temperature) && (
        <div className="grid grid-cols-2 gap-3">
          {config.inside_temperature && (
            <Card className="flex items-center gap-3 p-4">
              <Thermometer className="size-5 text-energy-consumption" />
              <div>
                <p className="text-xs text-muted-foreground">{t("tempInside")}</p>
                <p className="text-lg font-semibold">
                  {fmt(r.insideTemp, READING_DIGITS.temperature)}
                </p>
              </div>
            </Card>
          )}
          {config.outside_temperature && (
            <Card className="flex items-center gap-3 p-4">
              <Thermometer className="size-5 text-energy-grid" />
              <div>
                <p className="text-xs text-muted-foreground">{t("tempOutside")}</p>
                <p className="text-lg font-semibold">
                  {fmt(r.outsideTemp, READING_DIGITS.temperature)}
                </p>
              </div>
            </Card>
          )}
        </div>
      )}

      {(config.locked || config.doors || config.windows || config.trunk || config.odometer ||
        config.location) && (
        <Card className="p-6 space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("statusHeading")}
          </h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {config.locked && (
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/50">
                <span className="flex items-center gap-2 text-muted-foreground">
                  {r.locked ? <Lock className="size-4" /> : <Unlock className="size-4" />}
                  {t("lockLabel")}
                </span>
                <span className="font-semibold">
                  {r.locked == null
                    ? tState("unknown")
                    : r.locked
                      ? tState("locked")
                      : tState("unlocked")}
                </span>
              </div>
            )}
            {config.doors && (
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/50">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <DoorOpen className="size-4" />
                  {t("doorsLabel")}
                </span>
                <span className="font-semibold">{openState(r.doorsOpen)}</span>
              </div>
            )}
            {config.windows && (
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/50">
                <span className="text-muted-foreground">{t("windowsLabel")}</span>
                <span className="font-semibold">{openState(r.windowsOpen)}</span>
              </div>
            )}
            {config.trunk && (
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/50">
                <span className="text-muted-foreground">{t("trunkLabel")}</span>
                <span className="font-semibold">{openState(r.trunkOpen)}</span>
              </div>
            )}
            {config.odometer && (
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/50">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Gauge className="size-4" />
                  {t("odometerLabel")}
                </span>
                <span className="font-semibold">
                  {fmt(r.odometer, READING_DIGITS.distance)}
                </span>
              </div>
            )}
            {config.location && (
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/50">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <MapPin className="size-4" />
                  {t("locationLabel")}
                </span>
                <span className="font-semibold truncate">
                  {locationLabel(r.locationState)}
                </span>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

function GenericEvWidgetCard({ vehicle }: { vehicle: Vehicle }) {
  const t = useTranslations("vehicles.drivers.generic-ev");
  const locale = useLocale();
  const intlLocale = getIntlLocale(locale);
  const config = vehicle.config as GenericEvConfig;
  const { data: ha } = useHomeAssistantStatus();
  const haConnected = Boolean(ha?.url && ha?.access_token);
  const { readings: r, entityIds } = useVehicle(config, haConnected);

  if (!haConnected) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">{t("haNotConnected")}</p>
      </Card>
    );
  }
  if (entityIds.length === 0) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">{t("notConfigured")}</p>
      </Card>
    );
  }

  const battery = r.battery?.value ?? 0;
  const batteryColor =
    battery > 60 ? "text-success" : battery > 20 ? "text-warning" : "text-destructive";

  return (
    <Card className="p-4">
      {vehicle.image_url ? (
        <img
          src={vehicle.image_url}
          alt={vehicle.nickname}
          className="w-full max-h-24 object-contain mb-2"
        />
      ) : (
        <div className="flex justify-center mb-2">
          <Car className="size-12 text-muted-foreground" />
        </div>
      )}
      <div className="flex items-end justify-between">
        <div>
          <p className={`text-3xl font-bold ${batteryColor}`}>
            {r.battery ? Math.round(r.battery.value) : "—"}
            <span className="text-base text-muted-foreground">%</span>
          </p>
          <p className="text-xs text-muted-foreground">{vehicle.nickname}</p>
        </div>
        <div className="text-right">
          {r.charging ? (
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

/** The slots this driver offers, in the order the form shows them. */
const FIELDS: Array<{
  key: keyof VehicleEntityConfig;
  labelKey: string;
  /** Domains and device classes worth suggesting first. */
  match?: (e: HAEntity) => boolean;
}> = [
  { key: "battery_level", labelKey: "field.batteryLevel",
    match: (e) => e.attributes.device_class === "battery" || e.attributes.unit_of_measurement === "%" },
  { key: "battery_range", labelKey: "field.range",
    match: (e) => e.attributes.device_class === "distance" },
  { key: "charging_state", labelKey: "field.chargingState",
    match: (e) => e.domain === "binary_sensor" || e.attributes.device_class === "enum" },
  { key: "charger_power", labelKey: "field.chargePower",
    match: (e) => e.attributes.device_class === "power" },
  { key: "time_to_full_charge", labelKey: "field.timeToFull",
    match: (e) => e.attributes.device_class === "timestamp" || e.attributes.device_class === "duration" },
  { key: "charge_limit", labelKey: "field.chargeLimit",
    match: (e) => e.domain === "number" || e.attributes.unit_of_measurement === "%" },
  { key: "inside_temperature", labelKey: "field.insideTemperature",
    match: (e) => e.attributes.device_class === "temperature" },
  { key: "outside_temperature", labelKey: "field.outsideTemperature",
    match: (e) => e.attributes.device_class === "temperature" },
  { key: "locked", labelKey: "field.locked", match: (e) => e.domain === "lock" },
  { key: "doors", labelKey: "field.doors",
    match: (e) => e.attributes.device_class === "door" || e.domain === "cover" },
  { key: "windows", labelKey: "field.windows",
    match: (e) => e.attributes.device_class === "window" || e.domain === "cover" },
  { key: "trunk", labelKey: "field.trunk", match: (e) => e.domain === "cover" },
  { key: "odometer", labelKey: "field.odometer",
    match: (e) => e.attributes.device_class === "distance" },
  { key: "location", labelKey: "field.location", match: (e) => e.domain === "device_tracker" },
  { key: "state", labelKey: "field.state" },
];

function GenericEvConfigForm({
  vehicle,
  onConfigChange,
}: {
  vehicle: Vehicle;
  onConfigChange: (config: GenericEvConfig) => void;
}) {
  const t = useTranslations("vehicles.drivers.generic-ev");
  const config = useMemo(() => (vehicle.config ?? {}) as GenericEvConfig, [vehicle.config]);
  const { data: ha } = useHomeAssistantStatus();
  const haConnected = Boolean(ha?.url && ha?.access_token);
  const { data: entities = [] } = useHomeAssistantEntities(undefined, haConnected);

  // Same trick as the Tesla driver: the entities already configured say what
  // this car's are called, so the suggestions narrow to that device.
  const devicePrefix = useMemo(() => {
    for (const id of vehicleEntityIds(normalise(config))) {
      const object = id.split(".", 2)[1];
      const parts = object?.split("_") ?? [];
      if (parts.length >= 2) return `${parts[0]}_${parts[1]}`;
      if (parts[0]) return parts[0];
    }
    return null;
  }, [config]);

  const update = (key: keyof GenericEvConfig, value: string) =>
    onConfigChange({ ...config, [key]: value || undefined });

  if (!haConnected) {
    return <p className="text-sm text-muted-foreground">{t("haNotConnected")}</p>;
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {t("section.entities")}
      </h3>
      <p className="text-xs text-muted-foreground">{t("section.entitiesHint")}</p>
      {FIELDS.map((f) => {
        const suggested = entities.filter(
          (e) =>
            (!devicePrefix || e.entity_id.toLowerCase().includes(devicePrefix)) &&
            (!f.match || f.match(e)),
        );
        return (
          <EntitySelector
            key={f.key}
            label={t(f.labelKey)}
            description=""
            value={config[f.key] ?? (f.key === "battery_range" ? config.range : undefined)}
            onChange={(v) => update(f.key, v)}
            entities={suggested.length > 0 ? suggested : entities}
            allEntities={entities}
          />
        );
      })}
    </div>
  );
}

export const genericEvDriver: VehicleDriver<GenericEvConfig> = {
  id: "generic-ev",
  displayNameKey: "generic-ev",
  icon: Car,
  defaultConfig: {},
  Card: GenericEvCard,
  WidgetCard: GenericEvWidgetCard,
  ConfigForm: GenericEvConfigForm,
  isConfigured: (c) => Boolean(c.battery_level),
};
