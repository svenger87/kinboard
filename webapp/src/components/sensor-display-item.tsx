"use client";

import {
  Thermometer,
  Droplets,
  Zap,
  Battery,
  Gauge,
  Activity,
  Wind,
  Sun,
  Signal,
} from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import type { HAEntity, RoomEntity } from "@/types/home-assistant";

interface SensorDisplayItemProps {
  roomEntity: RoomEntity;
  entity: HAEntity;
}

// Get icon based on device class
function getSensorIcon(deviceClass: string | undefined) {
  switch (deviceClass) {
    case "temperature":
      return Thermometer;
    case "humidity":
      return Droplets;
    case "power":
    case "current":
    case "voltage":
    case "energy":
      return Zap;
    case "battery":
      return Battery;
    case "pressure":
      return Gauge;
    case "illuminance":
      return Sun;
    case "signal_strength":
      return Signal;
    case "wind_speed":
      return Wind;
    default:
      return Activity;
  }
}

// Get color based on device class and value
function getSensorColor(
  deviceClass: string | undefined,
  state: string
): string {
  const value = parseFloat(state);

  switch (deviceClass) {
    case "temperature":
      if (value < 15) return "#60a5fa"; // Blue (cold)
      if (value < 22) return "#22c55e"; // Green (comfortable)
      if (value < 28) return "#f59e0b"; // Orange (warm)
      return "#ef4444"; // Red (hot)

    case "humidity":
      if (value < 30) return "#f59e0b"; // Orange (too dry)
      if (value < 60) return "#22c55e"; // Green (comfortable)
      return "#60a5fa"; // Blue (humid)

    case "battery":
      if (value < 20) return "#ef4444"; // Red (low)
      if (value < 50) return "#f59e0b"; // Orange (medium)
      return "#22c55e"; // Green (good)

    case "power":
    case "energy":
      return "#f59e0b"; // Orange

    default:
      return "#8b5cf6"; // Purple (default)
  }
}

// Format sensor value with appropriate precision
function formatSensorValue(state: string, unit: string | undefined, intlLocale: string): string {
  const value = parseFloat(state);

  if (isNaN(value)) {
    return state; // Return as-is if not a number
  }

  // Format based on magnitude
  const fractionDigits = Math.abs(value) >= 1000 ? 0 : 1;
  const formatted = value.toLocaleString(intlLocale, { maximumFractionDigits: fractionDigits });

  return unit ? `${formatted} ${unit}` : formatted;
}

export function SensorDisplayItem({ roomEntity, entity }: SensorDisplayItemProps) {
  const tState = useTranslations("homeAutomation.entityState");
  const locale = useLocale();
  const intlLocale = locale === "de" ? "de-DE" : "en-US";
  const isUnavailable = entity.state === "unavailable" || entity.state === "unknown";
  const label = roomEntity.display_name || entity.name;
  const deviceClass = entity.attributes.device_class as string | undefined;
  const unit = entity.attributes.unit_of_measurement as string | undefined;

  const Icon = getSensorIcon(deviceClass);
  const color = isUnavailable
    ? "#6b7280" // Gray for unavailable
    : getSensorColor(deviceClass, entity.state);

  const formattedValue = isUnavailable
    ? "—"
    : formatSensorValue(entity.state, unit, intlLocale);

  return (
    <div
      className={`rounded-xl border p-3 bg-card transition-all ${
        isUnavailable ? "opacity-50" : ""
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className="p-2 rounded-lg"
          style={{ backgroundColor: `${color}20`, color }}
        >
          <Icon className="size-4" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{label}</p>
          <p className="text-xs text-muted-foreground truncate">
            {isUnavailable ? tState("unavailable") : (deviceClass ? deviceClass.replace("_", " ") : tState("sensorFallback"))}
          </p>
        </div>

        <div className="text-right shrink-0">
          <p
            className="font-semibold text-sm"
            style={{ color: isUnavailable ? undefined : color }}
          >
            {formattedValue}
          </p>
        </div>
      </div>
    </div>
  );
}
