"use client";

import {
  DoorOpen,
  DoorClosed,
  Activity,
  Eye,
  EyeOff,
  Droplets,
  AlertTriangle,
  Lock,
  Unlock,
  Flame,
  Snowflake,
  PlugZap,
  Home,
  Sun,
  Moon,
  Volume2,
  VolumeX,
  Vibrate,
  BatteryLow,
  BatteryFull,
} from "lucide-react";
import type { HAEntity, RoomEntity } from "@/types/home-assistant";
import { formatDistanceToNow } from "date-fns";
import { de, enUS } from "date-fns/locale";
import { useTranslations, useLocale } from "next-intl";

interface BinarySensorDisplayItemProps {
  roomEntity: RoomEntity;
  entity: HAEntity;
}

// Get icon based on device class and state
function getBinarySensorIcon(
  deviceClass: string | undefined,
  state: string
): React.ComponentType<{ className?: string }> {
  const isOn = state === "on";

  switch (deviceClass) {
    case "door":
    case "garage_door":
      return isOn ? DoorOpen : DoorClosed;

    case "window":
      return isOn ? DoorOpen : DoorClosed;

    case "motion":
    case "occupancy":
    case "presence":
      return isOn ? Eye : EyeOff;

    case "moisture":
    case "water":
      return Droplets;

    case "smoke":
    case "gas":
    case "carbon_monoxide":
      return AlertTriangle;

    case "lock":
      return isOn ? Unlock : Lock;

    case "heat":
      return Flame;

    case "cold":
      return Snowflake;

    case "plug":
    case "power":
      return PlugZap;

    case "light":
      return isOn ? Sun : Moon;

    case "sound":
      return isOn ? Volume2 : VolumeX;

    case "vibration":
      return Vibrate;

    case "battery":
    case "battery_charging":
      return isOn ? BatteryLow : BatteryFull;

    case "safety":
    case "problem":
    case "tamper":
      return AlertTriangle;

    default:
      return Home;
  }
}

// Get color based on device class and state
function getBinarySensorColor(
  deviceClass: string | undefined,
  state: string
): { bg: string; text: string } {
  const isOn = state === "on";

  // Safety-related sensors - red when triggered
  if (
    [
      "smoke",
      "gas",
      "carbon_monoxide",
      "moisture",
      "water",
      "safety",
      "problem",
      "tamper",
    ].includes(deviceClass || "")
  ) {
    return isOn
      ? { bg: "#ef4444", text: "#ffffff" } // Red background when triggered
      : { bg: "#22c55e20", text: "#22c55e" }; // Green when safe
  }

  // Door/window sensors
  if (["door", "window", "garage_door", "lock"].includes(deviceClass || "")) {
    return isOn
      ? { bg: "#f59e0b20", text: "#f59e0b" } // Orange when open
      : { bg: "#22c55e20", text: "#22c55e" }; // Green when closed
  }

  // Motion/presence sensors
  if (["motion", "occupancy", "presence"].includes(deviceClass || "")) {
    return isOn
      ? { bg: "#3b82f620", text: "#3b82f6" } // Blue when detected
      : { bg: "#6b728020", text: "#6b7280" }; // Gray when clear
  }

  // Default
  return isOn
    ? { bg: "#8b5cf620", text: "#8b5cf6" } // Purple when on
    : { bg: "#6b728020", text: "#6b7280" }; // Gray when off
}

// Get translation key for state label based on device class.
// Returned key is a child of "homeAutomation.binarySensorState".
function getStateLabelKey(deviceClass: string | undefined, state: string): string {
  const isOn = state === "on";

  switch (deviceClass) {
    case "door":
    case "garage_door":
    case "window":
      return isOn ? "doorOpen" : "doorClosed";

    case "motion":
      return isOn ? "motionOn" : "motionOff";

    case "occupancy":
    case "presence":
      return isOn ? "presenceOn" : "presenceOff";

    case "moisture":
    case "water":
      return isOn ? "moistureOn" : "moistureOff";

    case "smoke":
      return isOn ? "smokeOn" : "smokeOff";

    case "gas":
      return isOn ? "gasOn" : "gasOff";

    case "carbon_monoxide":
      return isOn ? "coOn" : "coOff";

    case "lock":
      return isOn ? "lockOn" : "lockOff";

    case "heat":
      return isOn ? "heatOn" : "heatOff";

    case "cold":
      return isOn ? "coldOn" : "coldOff";

    case "plug":
    case "power":
      return isOn ? "plugOn" : "plugOff";

    case "light":
      return isOn ? "lightOn" : "lightOff";

    case "sound":
      return isOn ? "soundOn" : "soundOff";

    case "vibration":
      return isOn ? "vibrationOn" : "vibrationOff";

    case "battery":
      return isOn ? "batteryOn" : "batteryOff";

    case "safety":
    case "problem":
      return isOn ? "problemOn" : "problemOff";

    case "tamper":
      return isOn ? "tamperOn" : "tamperOff";

    default:
      return isOn ? "on" : "off";
  }
}

export function BinarySensorDisplayItem({
  roomEntity,
  entity,
}: BinarySensorDisplayItemProps) {
  const tState = useTranslations("homeAutomation.entityState");
  const tBinary = useTranslations("homeAutomation.binarySensorState");
  const locale = useLocale();
  const dateLocale = locale === "de" ? de : enUS;
  const isUnavailable =
    entity.state === "unavailable" || entity.state === "unknown";
  const label = roomEntity.display_name || entity.name;
  const deviceClass = entity.attributes.device_class as string | undefined;

  const Icon = getBinarySensorIcon(deviceClass, entity.state);
  const colors = isUnavailable
    ? { bg: "#6b728020", text: "#6b7280" }
    : getBinarySensorColor(deviceClass, entity.state);

  const stateLabel = isUnavailable
    ? tState("unavailable")
    : tBinary(getStateLabelKey(deviceClass, entity.state));

  // Format time since last change
  let timeSince = "";
  try {
    if (entity.last_changed && !isUnavailable) {
      timeSince = formatDistanceToNow(new Date(entity.last_changed), {
        addSuffix: true,
        locale: dateLocale,
      });
    }
  } catch {
    // Ignore date parsing errors
  }

  // Safety sensors get special styling when triggered
  const isSafetyAlert =
    entity.state === "on" &&
    [
      "smoke",
      "gas",
      "carbon_monoxide",
      "moisture",
      "water",
      "safety",
      "problem",
      "tamper",
    ].includes(deviceClass || "");

  return (
    <div
      className={`rounded-xl border p-3 transition-all ${
        isUnavailable ? "opacity-50" : ""
      } ${isSafetyAlert ? "border-red-500 animate-pulse" : "bg-card"}`}
      style={
        isSafetyAlert ? { backgroundColor: colors.bg } : undefined
      }
    >
      <div className="flex items-center gap-3">
        <div
          className="p-2 rounded-lg"
          style={{ backgroundColor: colors.bg, color: colors.text }}
        >
          <Icon className="size-4" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{label}</p>
          <p className="text-xs text-muted-foreground truncate">
            {timeSince || (deviceClass ? deviceClass.replace("_", " ") : tState("sensorFallback"))}
          </p>
        </div>

        <div className="text-right shrink-0">
          <p
            className={`font-semibold text-sm ${
              isSafetyAlert ? "text-white" : ""
            }`}
            style={{ color: isSafetyAlert ? undefined : colors.text }}
          >
            {stateLabel}
          </p>
        </div>
      </div>
    </div>
  );
}
