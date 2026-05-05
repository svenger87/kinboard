"use client";

import { useState } from "react";
import {
  Thermometer,
  Droplets,
  Zap,
  Sun,
  Gauge,
  Battery,
  Activity,
  ChevronRight,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { HAEntity, DashboardCard } from "@/types/home-assistant";
import { EntityDetailSheet } from "../entity-detail-sheet";

const SENSOR_DEVICE_CLASS_KEYS = [
  "battery",
  "carbon_dioxide",
  "carbon_monoxide",
  "current",
  "energy",
  "humidity",
  "illuminance",
  "power",
  "power_factor",
  "pressure",
  "signal_strength",
  "temperature",
  "voltage",
  "gas",
  "moisture",
  "pm1",
  "pm10",
  "pm25",
  "timestamp",
  "monetary",
] as const;
type SensorDeviceClassKey = typeof SENSOR_DEVICE_CLASS_KEYS[number];

interface SensorCardProps {
  card: DashboardCard;
  entity: HAEntity;
}

// Get icon based on device class
function getSensorIcon(deviceClass?: string) {
  switch (deviceClass) {
    case "temperature":
      return <Thermometer className="size-5" />;
    case "humidity":
      return <Droplets className="size-5" />;
    case "power":
    case "energy":
      return <Zap className="size-5" />;
    case "illuminance":
      return <Sun className="size-5" />;
    case "battery":
      return <Battery className="size-5" />;
    case "pressure":
      return <Gauge className="size-5" />;
    default:
      return <Activity className="size-5" />;
  }
}

// Get color based on device class
function getSensorColor(deviceClass?: string): string {
  switch (deviceClass) {
    case "temperature":
      return "text-orange-500";
    case "humidity":
      return "text-blue-500";
    case "power":
    case "energy":
      return "text-yellow-500";
    case "illuminance":
      return "text-amber-400";
    case "battery":
      return "text-green-500";
    default:
      return "text-month-primary";
  }
}

// Format value for display
function formatValue(value: string, unit?: string): string {
  const numValue = parseFloat(value);
  if (isNaN(numValue)) return value;

  // Round to reasonable precision
  let formatted: string;
  if (numValue >= 1000) {
    formatted = numValue.toFixed(0);
  } else if (numValue >= 100) {
    formatted = numValue.toFixed(1);
  } else {
    formatted = numValue.toFixed(1);
  }

  return formatted;
}

export function SensorCard({ card, entity }: SensorCardProps) {
  const tDC = useTranslations("homeAutomation.sensorDeviceClass");
  const [detailOpen, setDetailOpen] = useState(false);

  const deviceClass = entity.attributes.device_class;
  const unit = entity.attributes.unit_of_measurement;
  const icon = getSensorIcon(deviceClass);
  const colorClass = getSensorColor(deviceClass);
  const label = card.display_name || entity.name;
  const isKnownDC = deviceClass && (SENSOR_DEVICE_CLASS_KEYS as readonly string[]).includes(deviceClass);
  const deviceLabel = isKnownDC ? tDC(deviceClass as SensorDeviceClassKey) : deviceClass?.replace(/_/g, " ");

  const isUnavailable = entity.state === "unavailable" || entity.state === "unknown";
  const displayValue = isUnavailable ? "---" : formatValue(entity.state, unit);

  return (
    <>
      <div
        className="rounded-xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-sm p-4 hover:border-month-primary/30 hover:bg-white/[0.05] transition-all cursor-pointer"
        onClick={() => setDetailOpen(true)}
      >
        <div className="flex items-start justify-between mb-2">
          <div className={`p-2.5 rounded-xl bg-white/[0.06] ${colorClass}`}>
            {icon}
          </div>
          <div className="flex items-center gap-1">
            {deviceLabel && (
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">{deviceLabel}</span>
            )}
            <ChevronRight className="size-4 text-muted-foreground/40" />
          </div>
        </div>

        <div className="mt-3">
          <p className="text-sm text-muted-foreground truncate">{label}</p>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className={`text-2xl font-semibold tabular-nums ${isUnavailable ? "text-muted-foreground" : ""}`}>
              {displayValue}
            </span>
            {unit && !isUnavailable && (
              <span className="text-sm text-muted-foreground/60">{unit}</span>
            )}
          </div>
        </div>
      </div>

      <EntityDetailSheet
        open={detailOpen}
        onOpenChange={setDetailOpen}
        card={card}
        entity={entity}
      />
    </>
  );
}
