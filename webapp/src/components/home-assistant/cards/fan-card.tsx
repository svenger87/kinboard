"use client";

import { Fan as FanIcon, Loader2, Power } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useFanControl } from "@/hooks";
import type { HAEntity, DashboardCard } from "@/types/home-assistant";

interface FanCardProps {
  card: DashboardCard;
  entity: HAEntity;
}

export function FanCard({ card, entity }: FanCardProps) {
  const t = useTranslations("homeAutomation.cards.fan");
  const tState = useTranslations("homeAutomation.entityState");
  const { turnOn, turnOff, setSpeed, setPresetMode, isPending } = useFanControl();

  const label = card.display_name || entity.name;
  const isUnavailable = entity.state === "unavailable";
  const isOn = entity.state === "on";

  // Fan attributes
  const percentage = entity.attributes.percentage as number | undefined;
  const speedList = entity.attributes.preset_modes as string[] | undefined;
  const currentSpeed = entity.attributes.preset_mode as string | undefined;
  const supportsSpeed = percentage !== undefined || speedList !== undefined;

  const handleToggle = async () => {
    if (isUnavailable) return;
    if (isOn) {
      await turnOff(entity.entity_id);
    } else {
      await turnOn(entity.entity_id);
    }
  };

  const handleSpeedChange = async (value: number[]) => {
    await setSpeed(entity.entity_id, value[0]);
  };

  const handlePresetMode = async (mode: string) => {
    await setPresetMode(entity.entity_id, mode);
  };

  return (
    <div
      className={`rounded-xl border p-4 transition-all ${
        isOn
          ? "bg-cyan-500/10 border-cyan-500/30"
          : "bg-card hover:border-month-primary/30"
      } ${isUnavailable ? "opacity-50" : ""}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <button
          onClick={handleToggle}
          disabled={isPending || isUnavailable}
          className={`p-2 rounded-lg transition-colors ${
            isOn ? "bg-cyan-500/20 text-cyan-500" : "bg-muted text-muted-foreground"
          } hover:bg-cyan-500/30 disabled:opacity-50`}
        >
          {isPending ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <FanIcon className={`size-5 ${isOn ? "animate-spin" : ""}`} style={{ animationDuration: "2s" }} />
          )}
        </button>
        <span className={`text-sm font-medium ${isOn ? "text-cyan-500" : "text-muted-foreground"}`}>
          {isUnavailable ? tState("unavailable") : isOn ? tState("on") : tState("off")}
        </span>
      </div>

      {/* Label */}
      <p className="text-sm font-medium truncate mb-2">{label}</p>

      {/* Current Speed */}
      {isOn && (percentage !== undefined || currentSpeed) && (
        <p className="text-xs text-muted-foreground mb-3">
          {percentage !== undefined ? `${percentage}%` : currentSpeed}
        </p>
      )}

      {/* Speed Slider (if percentage-based) */}
      {supportsSpeed && isOn && percentage !== undefined && !isUnavailable && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t("speed")}</span>
            <span>{percentage}%</span>
          </div>
          <Slider
            value={[percentage]}
            min={0}
            max={100}
            step={10}
            onValueCommit={handleSpeedChange}
            disabled={isPending}
            className="cursor-pointer"
          />
        </div>
      )}

      {/* Preset Modes (if available) */}
      {speedList && speedList.length > 0 && !isUnavailable && (
        <div className="mt-3 pt-3 border-t">
          <p className="text-xs text-muted-foreground mb-2">{t("mode")}</p>
          <div className="flex flex-wrap gap-1">
            {speedList.map((mode) => (
              <Button
                key={mode}
                variant={currentSpeed === mode ? "default" : "outline"}
                size="sm"
                className="text-xs h-7"
                onClick={() => handlePresetMode(mode)}
                disabled={isPending}
              >
                {mode}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
