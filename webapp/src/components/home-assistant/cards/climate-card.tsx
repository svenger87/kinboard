"use client";

import { Thermometer, Loader2, ChevronUp, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useCallService } from "@/hooks";
import type { HAEntity, DashboardCard } from "@/types/home-assistant";

interface ClimateCardProps {
  card: DashboardCard;
  entity: HAEntity;
}

type HvacModeKey = "auto" | "heat" | "cool" | "heat_cool" | "dry" | "fan_only" | "off";
type HvacActionKey = "heating" | "cooling" | "drying" | "idle" | "off";

const HVAC_MODE_KEYS: readonly string[] = ["auto", "heat", "cool", "heat_cool", "dry", "fan_only", "off"];
const HVAC_ACTION_KEYS: readonly string[] = ["heating", "cooling", "drying", "idle", "off"];

export function ClimateCard({ card, entity }: ClimateCardProps) {
  const t = useTranslations("homeAutomation.cards.climate");
  const tState = useTranslations("homeAutomation.entityState");
  const tHvacMode = useTranslations("homeAutomation.hvacMode");
  const tHvacAction = useTranslations("homeAutomation.hvacAction");
  const { mutateAsync: callService, isPending } = useCallService();

  const label = card.display_name || entity.name;
  const isUnavailable = entity.state === "unavailable";

  const currentTemp = entity.attributes.current_temperature as number | undefined;
  const targetTemp = entity.attributes.temperature as number | undefined;
  const hvacMode = entity.state;
  const hvacAction = entity.attributes.hvac_action as string | undefined;

  const isOff = hvacMode === "off";
  const isHeating = hvacAction === "heating";
  const isCooling = hvacAction === "cooling";

  const getStatusColor = () => {
    if (isHeating) return "text-orange-500";
    if (isCooling) return "text-blue-500";
    if (!isOff) return "text-green-500";
    return "text-muted-foreground";
  };

  const handleTempChange = async (delta: number) => {
    if (isUnavailable || targetTemp === undefined) return;
    await callService({
      domain: "climate",
      service: "set_temperature",
      entity_id: entity.entity_id,
      service_data: { temperature: targetTemp + delta },
    });
  };

  return (
    <div
      className={`rounded-2xl border bg-card elev-sm p-4 transition-all ${
        isHeating
          ? "bg-orange-500/10 border-orange-500/30"
          : isCooling
          ? "bg-blue-500/10 border-blue-500/30"
          : "bg-card hover:border-primary/30"
      } ${isUnavailable ? "opacity-50" : ""}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div
          className={`p-2 rounded-lg ${
            isHeating
              ? "bg-orange-500/20 text-orange-500"
              : isCooling
              ? "bg-blue-500/20 text-blue-500"
              : "bg-muted text-muted-foreground"
          }`}
        >
          <Thermometer className="size-5" />
        </div>
        {currentTemp !== undefined && (
          <div className="text-right">
            <span className="text-2xl font-semibold">{currentTemp}°</span>
            <p className="text-xs text-muted-foreground">{t("currentLabel")}</p>
          </div>
        )}
      </div>

      {/* Label and Status */}
      <div className="mb-3">
        <p className="text-sm font-medium truncate">{label}</p>
        <p className={`text-xs ${getStatusColor()}`}>
          {isUnavailable
            ? tState("unavailable")
            : hvacAction
              ? HVAC_ACTION_KEYS.includes(hvacAction)
                ? tHvacAction(hvacAction as HvacActionKey)
                : hvacAction
              : HVAC_MODE_KEYS.includes(hvacMode)
                ? tHvacMode(hvacMode as HvacModeKey)
                : hvacMode}
        </p>
      </div>

      {/* Target Temperature Controls */}
      {!isUnavailable && !isOff && targetTemp !== undefined && (
        <div className="flex items-center justify-between pt-3 border-t">
          <span className="text-xs text-muted-foreground">{t("targetLabel")}</span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="size-7"
              onClick={() => handleTempChange(-0.5)}
              disabled={isPending}
              aria-label={t("decreaseAria")}
            >
              {isPending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <ChevronDown className="size-4" />
              )}
            </Button>
            <span className="text-lg font-medium w-12 text-center">{targetTemp}°</span>
            <Button
              variant="outline"
              size="icon"
              className="size-7"
              onClick={() => handleTempChange(0.5)}
              disabled={isPending}
              aria-label={t("increaseAria")}
            >
              {isPending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <ChevronUp className="size-4" />
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
