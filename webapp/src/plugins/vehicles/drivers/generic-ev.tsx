"use client";

import { Car, Battery, MapPin } from "lucide-react";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  useHomeAssistantStatus,
  useHomeAssistantEntityStates,
} from "@/hooks";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Vehicle } from "@/types/database";
import type { VehicleDriver } from "./types";

export interface GenericEvConfig {
  battery_level?: string; // sensor.* — battery percentage
  charging_state?: string; // sensor.* | binary_sensor.*
  range?: string; // sensor.* — remaining range
  location?: string; // device_tracker.*
  state?: string; // sensor.* — overall vehicle state
}

function GenericEvCard({ vehicle }: { vehicle: Vehicle }) {
  const t = useTranslations("vehicles.drivers.generic-ev");
  const config = vehicle.config as GenericEvConfig;
  const { data: ha } = useHomeAssistantStatus();
  const haConnected = Boolean(ha?.url && ha?.access_token);

  const entityIds = useMemo(
    () =>
      [
        config.battery_level,
        config.charging_state,
        config.range,
        config.location,
        config.state,
      ].filter((v): v is string => Boolean(v)),
    [config],
  );
  const { data: entityList = [] } = useHomeAssistantEntityStates(entityIds);

  // Build entity_id → entity lookup map
  const states = useMemo(
    () =>
      Object.fromEntries(entityList.map((e) => [e.entity_id, e])) as Record<
        string,
        (typeof entityList)[number]
      >,
    [entityList],
  );

  if (!haConnected) {
    return (
      <Card className="p-6 text-muted-foreground">
        {t("haNotConnected")}
      </Card>
    );
  }
  if (entityIds.length === 0) {
    return (
      <Card className="p-6 text-muted-foreground">
        {t("notConfigured")}
      </Card>
    );
  }

  const battery = config.battery_level
    ? states[config.battery_level]?.state
    : null;
  const range = config.range ? states[config.range]?.state : null;
  const rangeUnit = config.range
    ? (
        states[config.range]?.attributes as
          | { unit_of_measurement?: string }
          | undefined
      )?.unit_of_measurement ?? null
    : null;
  const charging = config.charging_state
    ? states[config.charging_state]?.state
    : null;
  const location = config.location
    ? (
        states[config.location]?.attributes as
          | { friendly_name?: string }
          | undefined
      )?.friendly_name
    : null;
  const state = config.state ? states[config.state]?.state : null;

  return (
    <Card className="p-6 space-y-4">
      {vehicle.image_url ? (
        <img
          src={vehicle.image_url}
          alt={vehicle.nickname}
          className="w-full max-h-32 object-contain rounded-md mb-2"
        />
      ) : null}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">{vehicle.nickname}</h2>
        {state ? (
          <span className="text-sm text-muted-foreground">{state}</span>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-4">
        {battery && (
          <div className="flex items-center gap-2">
            <Battery className="size-5 text-green-500" />
            <span className="text-3xl font-bold">{battery}%</span>
          </div>
        )}
        {range && (
          <div className="text-2xl text-muted-foreground">
            {range}{rangeUnit ? ` ${rangeUnit}` : ""}
          </div>
        )}
        {charging && (
          <div className="text-sm">
            {t("charging")}: {charging}
          </div>
        )}
        {location && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="size-4" />
            {location}
          </div>
        )}
      </div>
    </Card>
  );
}

function GenericEvWidgetCard({ vehicle }: { vehicle: Vehicle }) {
  const t = useTranslations("vehicles.drivers.generic-ev");
  const config = vehicle.config as GenericEvConfig;
  const { data: ha } = useHomeAssistantStatus();
  const haConnected = Boolean(ha?.url && ha?.access_token);

  const entityIds = useMemo(
    () =>
      [config.battery_level, config.charging_state].filter(
        (v): v is string => Boolean(v),
      ),
    [config],
  );
  const { data: entityList = [] } = useHomeAssistantEntityStates(entityIds);

  const states = useMemo(
    () =>
      Object.fromEntries(entityList.map((e) => [e.entity_id, e])) as Record<
        string,
        (typeof entityList)[number]
      >,
    [entityList],
  );

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

  const battery = config.battery_level
    ? states[config.battery_level]?.state
    : null;
  const charging = config.charging_state
    ? states[config.charging_state]?.state
    : null;

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
          {battery && (
            <p className="text-3xl font-bold text-foreground">
              {battery}
              <span className="text-base text-muted-foreground">%</span>
            </p>
          )}
          <p className="text-xs text-muted-foreground">{vehicle.nickname}</p>
        </div>
        {charging && (
          <div className="text-xs text-muted-foreground">
            {t("charging")}: {charging}
          </div>
        )}
      </div>
    </Card>
  );
}

function GenericEvConfigForm({
  vehicle,
  onConfigChange,
}: {
  vehicle: Vehicle;
  onConfigChange: (config: GenericEvConfig) => void;
}) {
  const t = useTranslations("vehicles.drivers.generic-ev");
  const config = vehicle.config as GenericEvConfig;

  // Plain text-input version — users paste HA entity IDs. Richer
  // entity-picker UX is reserved for the Tesla driver where the field
  // count justifies it; for Generic-EV's 5 fields, simpler is better.
  const fields: Array<{
    key: keyof GenericEvConfig;
    labelKey: string;
    placeholder: string;
  }> = [
    {
      key: "battery_level",
      labelKey: "field.batteryLevel",
      placeholder: "sensor.car_battery_level",
    },
    {
      key: "charging_state",
      labelKey: "field.chargingState",
      placeholder: "binary_sensor.car_charging",
    },
    {
      key: "range",
      labelKey: "field.range",
      placeholder: "sensor.car_range",
    },
    {
      key: "location",
      labelKey: "field.location",
      placeholder: "device_tracker.car",
    },
    {
      key: "state",
      labelKey: "field.state",
      placeholder: "sensor.car_state",
    },
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {t("section.entities")}
      </h3>
      {fields.map((f) => (
        <div key={f.key} className="grid grid-cols-[1fr_2fr] gap-3 items-center">
          <Label>{t(f.labelKey)}</Label>
          <Input
            value={config[f.key] ?? ""}
            placeholder={f.placeholder}
            onChange={(e) =>
              onConfigChange({
                ...config,
                [f.key]: e.target.value || undefined,
              })
            }
          />
        </div>
      ))}
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
