"use client";

import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Power,
  Lightbulb,
  Thermometer,
  Droplets,
  Zap,
  Battery,
  Activity,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { useEntityHistory, useToggleEntity, useLightControl, useCallService } from "@/hooks";
import { MiniChart } from "./mini-chart";
import type { HAEntity, DashboardCard } from "@/types/home-assistant";

type AttributeKey =
  | "brightness" | "color_temp" | "supported_color_modes" | "current_power_w"
  | "today_energy_kwh" | "unit_of_measurement" | "device_class" | "state_class"
  | "temperature" | "current_temperature" | "hvac_modes" | "preset_mode"
  | "current_position" | "percentage" | "preset_modes" | "battery_level"
  | "status" | "fan_speed_list" | "volume_level" | "source" | "source_list";

type DeviceClassKey =
  | "battery" | "temperature" | "humidity" | "power" | "energy" | "voltage"
  | "current" | "pressure" | "illuminance" | "motion" | "door" | "window"
  | "occupancy" | "plug" | "outlet" | "switch";

const ATTRIBUTE_KEYS: readonly string[] = [
  "brightness", "color_temp", "supported_color_modes", "current_power_w",
  "today_energy_kwh", "unit_of_measurement", "device_class", "state_class",
  "temperature", "current_temperature", "hvac_modes", "preset_mode",
  "current_position", "percentage", "preset_modes", "battery_level",
  "status", "fan_speed_list", "volume_level", "source", "source_list",
];

const DEVICE_CLASS_KEYS: readonly string[] = [
  "battery", "temperature", "humidity", "power", "energy", "voltage",
  "current", "pressure", "illuminance", "motion", "door", "window",
  "occupancy", "plug", "outlet", "switch",
];

interface EntityDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card: DashboardCard;
  entity: HAEntity;
}

// Get icon for entity type
function getEntityIcon(entityId: string, deviceClass?: string) {
  const domain = entityId.split(".")[0];

  switch (deviceClass) {
    case "temperature":
      return <Thermometer className="size-5" />;
    case "humidity":
      return <Droplets className="size-5" />;
    case "power":
    case "energy":
      return <Zap className="size-5" />;
    case "battery":
      return <Battery className="size-5" />;
  }

  switch (domain) {
    case "light":
      return <Lightbulb className="size-5" />;
    case "switch":
    case "input_boolean":
      return <Power className="size-5" />;
    default:
      return <Activity className="size-5" />;
  }
}

// Get color for entity
function getEntityColor(entityId: string, state: string, deviceClass?: string): string {
  const domain = entityId.split(".")[0];

  // Color based on device class
  switch (deviceClass) {
    case "temperature":
      return "#f97316"; // orange
    case "humidity":
      return "#3b82f6"; // blue
    case "power":
    case "energy":
      return "#eab308"; // yellow
    case "battery":
      return "#22c55e"; // green
  }

  // Color based on domain and state
  if (domain === "light" && state === "on") return "#eab308";
  if ((domain === "switch" || domain === "input_boolean") && state === "on") return "#22c55e";

  return "#6b7280"; // gray
}

// Attributes to show for different entity types
const IMPORTANT_ATTRIBUTES: Record<string, string[]> = {
  light: ["brightness", "color_temp", "supported_color_modes"],
  switch: ["current_power_w", "today_energy_kwh"],
  sensor: ["unit_of_measurement", "device_class", "state_class"],
  climate: ["temperature", "current_temperature", "hvac_modes", "preset_mode"],
  cover: ["current_position", "device_class"],
  fan: ["percentage", "preset_modes"],
  vacuum: ["battery_level", "status", "fan_speed_list"],
  media_player: ["volume_level", "source", "source_list"],
};

export function EntityDetailSheet({
  open,
  onOpenChange,
  card,
  entity,
}: EntityDetailModalProps) {
  const t = useTranslations("homeAutomation.entityDetail");
  const tAttr = useTranslations("homeAutomation.entityDetail.attributes");
  const tDC = useTranslations("homeAutomation.entityDetail.deviceClasses");
  const locale = useLocale();
  const intlLocale = locale === "de" ? "de-DE" : "en-US";

  // Format attribute value (locale-aware)
  const formatAttributeValue = (value: unknown): string => {
    if (value === null || value === undefined) return "-";
    if (typeof value === "boolean") return value ? t("yes") : t("no");
    if (typeof value === "number") return value.toLocaleString(intlLocale);
    if (Array.isArray(value)) return value.join(", ");
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };

  const domain = entity.entity_id.split(".")[0];
  const label = card.display_name || entity.name;
  const deviceClass = entity.attributes.device_class;
  const unit = entity.attributes.unit_of_measurement;
  const color = getEntityColor(entity.entity_id, entity.state, deviceClass);

  // Fetch 24h history
  const startTime = useMemo(() => {
    const date = new Date();
    date.setHours(date.getHours() - 24);
    return date.toISOString();
  }, []);

  const { data: history, isLoading: historyLoading, refetch: refetchHistory } = useEntityHistory(
    entity.entity_id,
    startTime,
    undefined,
    { enabled: open }
  );

  // Control hooks
  const { toggle, isPending: togglePending } = useToggleEntity();
  const { turnOn, turnOff, setBrightness, isPending: lightPending } = useLightControl();
  const { mutateAsync: callService, isPending: servicePending } = useCallService();

  const isPending = togglePending || lightPending || servicePending;
  const isOn = entity.state === "on";
  const isUnavailable = entity.state === "unavailable" || entity.state === "unknown";

  // Get important attributes for this entity type
  const attributeKeys = IMPORTANT_ATTRIBUTES[domain] || [];
  const displayAttributes = attributeKeys
    .filter((key) => entity.attributes[key] !== undefined)
    .map((key) => {
      const rawValue = entity.attributes[key];
      // Translate device_class values
      let value = formatAttributeValue(rawValue);
      if (key === "device_class" && typeof rawValue === "string") {
        value = DEVICE_CLASS_KEYS.includes(rawValue) ? tDC(rawValue as DeviceClassKey) : rawValue;
      }
      const attrLabel = ATTRIBUTE_KEYS.includes(key)
        ? tAttr(key as AttributeKey)
        : key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
      return {
        key,
        label: attrLabel,
        value,
      };
    });

  // Light brightness control
  const brightness = entity.attributes.brightness || 0;
  const brightnessPercent = Math.round((brightness / 255) * 100);
  const supportsBrightness =
    domain === "light" &&
    (entity.attributes.supported_color_modes as string[] | undefined)?.some(
      (mode) => mode !== "onoff"
    );

  const handleBrightnessCommit = async (value: number[]) => {
    const percent = value[0];
    const haValue = Math.round((percent / 100) * 255);
    await setBrightness(entity.entity_id, haValue);
  };

  // Render actions based on entity type
  const renderActions = () => {
    if (isUnavailable) {
      return (
        <p className="text-sm text-muted-foreground text-center py-4">
          {t("unavailableNotice")}
        </p>
      );
    }

    switch (domain) {
      case "light":
        return (
          <div className="flex flex-col gap-4">
            <div className="flex gap-2">
              <Button
                className="flex-1"
                variant={isOn ? "default" : "outline"}
                onClick={() => turnOn(entity.entity_id)}
                disabled={isPending}
              >
                {isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
                {t("turnOnButton")}
              </Button>
              <Button
                className="flex-1"
                variant={!isOn ? "default" : "outline"}
                onClick={() => turnOff(entity.entity_id)}
                disabled={isPending}
              >
                {t("turnOffButton")}
              </Button>
            </div>
            {supportsBrightness && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-sm">
                  <span>{tAttr("brightness")}</span>
                  <span>{brightnessPercent}%</span>
                </div>
                <Slider
                  value={[brightnessPercent]}
                  min={0}
                  max={100}
                  step={5}
                  onValueCommit={handleBrightnessCommit}
                  disabled={isPending}
                />
              </div>
            )}
          </div>
        );

      case "switch":
      case "input_boolean":
        return (
          <div className="flex gap-2">
            <Button
              className="flex-1"
              variant={isOn ? "default" : "outline"}
              onClick={() => toggle(entity.entity_id, entity.state)}
              disabled={isPending}
            >
              {isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
              {isOn ? t("turnOffButton") : t("turnOnButton")}
            </Button>
          </div>
        );

      case "scene":
      case "script":
        return (
          <Button
            className="w-full"
            onClick={() =>
              callService({
                domain,
                service: "turn_on",
                entity_id: entity.entity_id,
              })
            }
            disabled={isPending}
          >
            {isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
            {t("activateButton")}
          </Button>
        );

      case "automation":
        return (
          <div className="flex gap-2">
            <Button
              className="flex-1"
              variant="outline"
              onClick={() =>
                callService({
                  domain: "automation",
                  service: "trigger",
                  entity_id: entity.entity_id,
                })
              }
              disabled={isPending}
            >
              {isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
              {t("triggerButton")}
            </Button>
            <Button
              className="flex-1"
              variant={isOn ? "default" : "outline"}
              onClick={() => toggle(entity.entity_id, entity.state)}
              disabled={isPending}
            >
              {isOn ? t("disableButton") : t("enableButton")}
            </Button>
          </div>
        );

      case "sensor":
      case "binary_sensor":
        return null; // Sensors don't have actions

      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] p-0">
        <DialogHeader className="p-6 pb-0">
          <div className="flex items-center gap-3">
            <div
              className="p-3 rounded-xl"
              style={{ backgroundColor: `${color}20`, color }}
            >
              {getEntityIcon(entity.entity_id, deviceClass)}
            </div>
            <div>
              <DialogTitle className="text-left">{label}</DialogTitle>
              <p className="text-sm text-muted-foreground">{entity.entity_id}</p>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(85vh-100px)]">
          <div className="p-6 pt-4 flex flex-col gap-6">
            {/* Current State */}
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t("currentStateLabel")}</span>
                <span
                  className="text-2xl font-semibold"
                  style={{ color: isUnavailable ? undefined : color }}
                >
                  {entity.state}
                  {unit && !isUnavailable && (
                    <span className="text-sm text-muted-foreground ml-1">{unit}</span>
                  )}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {t("lastUpdatedLabel")}{" "}
                {new Date(entity.last_changed).toLocaleString(intlLocale)}
              </p>
            </div>

            {/* Actions */}
            {renderActions() && (
              <>
                <Separator />
                <div>
                  <h3 className="text-sm font-medium mb-3">{t("actionsHeading")}</h3>
                  {renderActions()}
                </div>
              </>
            )}

            {/* History Chart */}
            <Separator />
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium">{t("history24hHeading")}</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => refetchHistory()}
                  disabled={historyLoading}
                >
                  <RefreshCw className={`size-4 ${historyLoading ? "animate-spin" : ""}`} />
                </Button>
              </div>
              {historyLoading ? (
                <div className="h-24 flex items-center justify-center">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
              ) : history?.history && history.history.length > 0 ? (
                <MiniChart
                  history={history}
                  color={color}
                  unit={unit}
                  height={100}
                  showTooltip
                />
              ) : (
                <div className="h-24 flex items-center justify-center text-sm text-muted-foreground">
                  {t("noHistoryData")}
                </div>
              )}
            </div>

            {/* Attributes */}
            {displayAttributes.length > 0 && (
              <>
                <Separator />
                <div>
                  <h3 className="text-sm font-medium mb-3">{t("attributesHeading")}</h3>
                  <div className="flex flex-col gap-2">
                    {displayAttributes.map(({ key, label, value }) => (
                      <div
                        key={key}
                        className="flex items-center justify-between text-sm py-1"
                      >
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-medium text-right max-w-[60%] truncate">
                          {value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
