"use client";

import { useState } from "react";
import { Lightbulb, Loader2, Sun, Snowflake, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useLightControl } from "@/hooks";
import type { HAEntity, DashboardCard } from "@/types/home-assistant";

interface LightControlItemProps {
  card: DashboardCard;
  entity: HAEntity;
}

// Calculate color based on color temperature in Kelvin
// Returns a CSS color string from warm orange to cool blue-white
function getColorTempColor(kelvin: number, minK: number, maxK: number): string {
  // Normalize to 0-1 range
  const normalized = Math.max(0, Math.min(1, (kelvin - minK) / (maxK - minK)));

  // Warm (2700K): #FF9F43 (orange)
  // Neutral (4000K): #FFEAA7 (warm white)
  // Cool (6500K): #74B9FF (cool blue-white)

  if (normalized < 0.5) {
    // Warm to neutral (0-0.5)
    const t = normalized * 2;
    const r = Math.round(255);
    const g = Math.round(159 + (234 - 159) * t);
    const b = Math.round(67 + (167 - 67) * t);
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    // Neutral to cool (0.5-1)
    const t = (normalized - 0.5) * 2;
    const r = Math.round(255 - (255 - 116) * t);
    const g = Math.round(234 - (234 - 185) * t);
    const b = Math.round(167 + (255 - 167) * t);
    return `rgb(${r}, ${g}, ${b})`;
  }
}

export function LightControlItem({ card, entity }: LightControlItemProps) {
  const tState = useTranslations("homeAutomation.entityState");
  const tLight = useTranslations("homeAutomation.light");
  const { turnOn, turnOff, setBrightness, setColorTemp, isPending } = useLightControl();
  const [localBrightness, setLocalBrightness] = useState<number | null>(null);
  const [localColorTemp, setLocalColorTemp] = useState<number | null>(null);

  const isOn = entity.state === "on";
  const isUnavailable = entity.state === "unavailable";
  const label = card.display_name || entity.name;

  // Brightness is 0-255 in HA
  const currentBrightness = entity.attributes.brightness || 0;
  const brightnessPercent = Math.round((currentBrightness / 255) * 100);
  const displayBrightness = localBrightness !== null ? localBrightness : brightnessPercent;

  const supportedColorModes = entity.attributes.supported_color_modes as string[] | undefined;
  const supportsBrightness = supportedColorModes?.some(
    (mode) => mode !== "onoff"
  );

  // Color temperature support
  const supportsColorTemp = supportedColorModes?.includes("color_temp");
  const minMireds = entity.attributes.min_mireds as number | undefined;
  const maxMireds = entity.attributes.max_mireds as number | undefined;
  const currentColorTempKelvin = entity.attributes.color_temp_kelvin as number | undefined;

  // Convert mireds to kelvin for range (kelvin = 1000000 / mireds)
  // Note: min mireds = max kelvin, max mireds = min kelvin
  const minKelvin = maxMireds ? Math.round(1000000 / maxMireds) : 2700;
  const maxKelvin = minMireds ? Math.round(1000000 / minMireds) : 6500;
  const displayColorTemp = localColorTemp !== null ? localColorTemp : (currentColorTempKelvin || minKelvin);

  // Calculate icon color based on color temperature
  const iconColor = isOn && supportsColorTemp && displayColorTemp
    ? getColorTempColor(displayColorTemp, minKelvin, maxKelvin)
    : isOn ? "#eab308" : undefined; // Default yellow-500 when on without color temp

  // Check if this is a grouped light (has entity_id array attribute)
  const isGroupedLight = Array.isArray(entity.attributes.entity_id);
  const groupedEntityCount = isGroupedLight ? (entity.attributes.entity_id as string[]).length : 0;

  const handleToggle = async () => {
    if (isUnavailable) return;
    if (isOn) {
      await turnOff(entity.entity_id);
    } else {
      await turnOn(entity.entity_id);
    }
  };

  const handleBrightnessChange = (value: number[]) => {
    setLocalBrightness(value[0]);
  };

  const handleBrightnessCommit = async (value: number[]) => {
    const percent = value[0];
    const haValue = Math.round((percent / 100) * 255);
    await setBrightness(entity.entity_id, haValue);
    setLocalBrightness(null);
  };

  const handleColorTempChange = (value: number[]) => {
    setLocalColorTemp(value[0]);
  };

  const handleColorTempCommit = async (value: number[]) => {
    await setColorTemp(entity.entity_id, value[0]);
    setLocalColorTemp(null);
  };

  return (
    <div
      className={`rounded-xl border p-4 transition-all ${
        isOn
          ? "border-yellow-500/30"
          : "bg-card"
      } ${isUnavailable ? "opacity-50" : ""}`}
      style={isOn && iconColor ? { backgroundColor: `${iconColor}15` } : undefined}
    >
      {/* Header row: icon, name, group indicator, toggle */}
      <div className="flex items-center gap-3">
        <div
          className={`p-2 rounded-lg transition-colors ${
            isOn ? "bg-yellow-500/20" : "bg-muted text-muted-foreground"
          }`}
          style={isOn && iconColor ? { color: iconColor } : undefined}
        >
          {isPending ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <Lightbulb className="size-5" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium text-sm truncate">{label}</p>
            {isGroupedLight && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                <Users className="size-3" />
                <span>{groupedEntityCount}</span>
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {isUnavailable ? tState("unavailable") : isOn ? tState("on") : tState("off")}
          </p>
        </div>

        <Switch
          checked={isOn}
          onCheckedChange={handleToggle}
          disabled={isPending || isUnavailable}
        />
      </div>

      {/* Brightness slider */}
      {supportsBrightness && !isUnavailable && isOn && (
        <div className="mt-3 flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{tLight("brightness")}</span>
            <span>{displayBrightness}%</span>
          </div>
          <Slider
            value={[displayBrightness]}
            min={0}
            max={100}
            step={5}
            onValueChange={handleBrightnessChange}
            onValueCommit={handleBrightnessCommit}
            disabled={isPending}
            className="cursor-pointer"
          />
        </div>
      )}

      {/* Color temperature slider */}
      {supportsColorTemp && !isUnavailable && isOn && (
        <div className="mt-3 flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Sun className="size-3 text-orange-400" />
              <span>{tLight("colorTemp")}</span>
              <Snowflake className="size-3 text-blue-400" />
            </div>
            <span>{displayColorTemp}K</span>
          </div>
          <Slider
            value={[displayColorTemp]}
            min={minKelvin}
            max={maxKelvin}
            step={100}
            onValueChange={handleColorTempChange}
            onValueCommit={handleColorTempCommit}
            disabled={isPending}
            className="cursor-pointer"
          />
        </div>
      )}
    </div>
  );
}
