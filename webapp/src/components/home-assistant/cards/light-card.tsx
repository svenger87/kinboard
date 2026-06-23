"use client";

import { useState } from "react";
import { Lightbulb, Loader2, ChevronRight, Sun, Snowflake, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { Slider } from "@/components/ui/slider";
import { getColorTempColor } from "@/lib/ha-color";
import { useLightControl } from "@/hooks";
import type { HAEntity, DashboardCard } from "@/types/home-assistant";
import { EntityDetailSheet } from "../entity-detail-sheet";

interface LightCardProps {
  card: DashboardCard;
  entity: HAEntity;
}

export function LightCard({ card, entity }: LightCardProps) {
  const t = useTranslations("homeAutomation.cards.light");
  const tState = useTranslations("homeAutomation.entityState");
  const tLight = useTranslations("homeAutomation.light");
  const [detailOpen, setDetailOpen] = useState(false);
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

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
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

  const handleSliderClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-label={t("ariaLabel", { label, state: isOn ? t("stateOnAria") : t("stateOffAria") })}
        className={`rounded-2xl border bg-card elev-sm p-4 transition-all cursor-pointer ${
          isOn
            ? "border-yellow-500/30"
            : "border-border hover:border-primary/30"
        } ${isUnavailable ? "opacity-50" : ""}`}
        style={isOn && iconColor ? { backgroundColor: `${iconColor}15` } : undefined}
        onClick={() => setDetailOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setDetailOpen(true);
          }
        }}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <button
              onClick={handleToggle}
              disabled={isPending || isUnavailable}
              className={`p-2 rounded-lg transition-colors ${
                isOn ? "bg-yellow-500/20 icon-badge" : "bg-muted text-muted-foreground"
              } hover:bg-yellow-500/30 disabled:opacity-50`}
              style={
                isOn && iconColor
                  ? { color: iconColor, boxShadow: `0 0 16px ${iconColor}66` }
                  : undefined
              }
            >
              {isPending ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <Lightbulb className="size-5" />
              )}
            </button>
            {isGroupedLight && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Users className="size-3" />
                <span>{groupedEntityCount}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            <span
              className={`text-sm font-medium ${!isOn ? "text-muted-foreground" : ""}`}
              style={isOn && iconColor ? { color: iconColor } : undefined}
            >
              {isUnavailable ? tState("unavailable") : isOn ? tState("on") : tState("off")}
            </span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </div>
        </div>

        <p className="text-sm text-muted-foreground truncate mb-2">{label}</p>

        {supportsBrightness && !isUnavailable && (
          <div className="mt-3 flex flex-col gap-2" onClick={handleSliderClick} role="group" aria-label={tLight("brightness")}>
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

        {supportsColorTemp && !isUnavailable && (
          <div className="mt-3 flex flex-col gap-2" onClick={handleSliderClick} role="group" aria-label={tLight("colorTemp")}>
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

      <EntityDetailSheet
        open={detailOpen}
        onOpenChange={setDetailOpen}
        card={card}
        entity={entity}
      />
    </>
  );
}
