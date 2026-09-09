"use client";

import { useMemo, useState } from "react";
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
import { getIntlLocale } from "@/i18n/intl-locale";
import { useEntityHistory, useToggleEntity, useLightControl, useCallService } from "@/hooks";
import { MiniChart } from "./mini-chart";
import {
  classifyAttributeValue,
  classifyEntityState,
  humanizeAttributeKey,
  isPlumbingAttribute,
} from "@/lib/ha-entity-display";
import type { HAEntity } from "@/types/home-assistant";

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
  displayName?: string;
  imageUrl?: string;
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
      return "hsl(var(--state-light))";
    case "battery":
      return "#22c55e"; // green
  }

  // Color based on domain and state
  if (domain === "light" && state === "on") return "hsl(var(--state-light))";
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

/*
  Device classes the header already spends.

  `getEntityIcon` and `getEntityColor` turn these five into the glyph and the
  colour at the top of the sheet, so repeating them as a row underneath says
  nothing new. Every *other* device class earns its row: "Device class: aqi" is
  often how somebody works out what an unfamiliar entity is even measuring.
*/
const HEADER_DEVICE_CLASSES: readonly string[] = [
  "temperature", "humidity", "power", "energy", "battery",
];

/*
  Domains whose 24h section is not this file's decision.

  RFC-008 R3 classifies history per domain — an area chart for numbers, a step
  band for on/off, nothing at all for enums — and that work owns these. Until
  it lands they keep the chart they have today. Everything else takes the
  fallback rule: chart only when the state is a number, because
  `/api/homeassistant/history` maps a non-numeric state through `parseFloat`
  and falls back to 0, and `MiniChart` then draws a flat line at zero that
  looks exactly like a reading.
*/
const DOMAINS_WITH_OWN_HISTORY: readonly string[] = [
  "light", "switch", "input_boolean", "sensor", "binary_sensor", "climate",
  "cover", "fan", "vacuum", "media_player", "scene", "script", "automation",
];

export function EntityDetailSheet({
  open,
  onOpenChange,
  displayName,
  imageUrl,
  entity,
}: EntityDetailModalProps) {
  const t = useTranslations("homeAutomation.entityDetail");
  const tAttr = useTranslations("homeAutomation.entityDetail.attributes");
  const tDC = useTranslations("homeAutomation.entityDetail.deviceClasses");
  const tState = useTranslations("homeAutomation.entityState");
  const tHomeAutomation = useTranslations("homeAutomation");
  const locale = useLocale();
  const intlLocale = getIntlLocale(locale);

  /*
    Which image url failed, not whether one did.

    The sheet is mounted once and re-pointed as the household opens one tile
    after another, so a boolean would outlive the image that set it and drop
    every entity after a single broken thumbnail to the Lucide glyph. Keying it
    to the url resets on its own when the url changes — no effect, no extra
    render.
  */
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const imageFailed = failedImageUrl !== null && failedImageUrl === imageUrl;

  // Format attribute value (locale-aware)
  const formatAttributeValue = (value: unknown): string => {
    if (value === null || value === undefined) return "-";
    if (typeof value === "boolean") return value ? t("yes") : t("no");
    if (typeof value === "number") return value.toLocaleString(intlLocale);
    if (Array.isArray(value)) return value.map(formatAttributeValue).join(", ");
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };

  const domain = entity.entity_id.split(".")[0];
  const label = displayName || entity.name;
  const deviceClass = entity.attributes.device_class;
  const unit = entity.attributes.unit_of_measurement;
  const color = getEntityColor(entity.entity_id, entity.state, deviceClass);

  /*
    RFC-008 §5.1 — read the state by the shape of the value, not by the domain
    name. A number is a number whether it came from `sensor` or from an
    integration written last week, and `heat_pump` is a word either way.
  */
  const stateShape = classifyEntityState(entity.state);
  const showsUnitWithState = stateShape.kind === "number" && !!unit;

  const stateText = (() => {
    switch (stateShape.kind) {
      case "unavailable":
        return tHomeAutomation("unavailable");
      case "number":
        return stateShape.value.toLocaleString(intlLocale);
      case "datetime":
        if (stateShape.parts === "date") {
          return stateShape.date.toLocaleDateString(intlLocale);
        }
        if (stateShape.parts === "time") {
          return stateShape.date.toLocaleTimeString(intlLocale, {
            hour: "2-digit",
            minute: "2-digit",
          });
        }
        return stateShape.date.toLocaleString(intlLocale);
      case "toggle":
        return stateShape.on ? tState("on") : tState("off");
      default:
        return stateShape.value;
    }
  })();

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
  const isOn = stateShape.kind === "toggle" && stateShape.on;
  const isUnavailable = stateShape.kind === "unavailable";

  /*
    Curated attributes for the eight domains that have a list; everything the
    entity carries for the ones that do not (RFC-008 §5.2), minus plumbing.
    Showing all of them is the one place the thin sheet beat this one: for an
    unfamiliar entity the attributes are frequently the only thing on screen
    that says what it is.
  */
  const curatedKeys = IMPORTANT_ATTRIBUTES[domain];
  const attributeKeys = curatedKeys
    ? curatedKeys.filter((key) => entity.attributes[key] !== undefined)
    : Object.keys(entity.attributes)
        .filter((key) => {
          if (entity.attributes[key] === undefined) return false;
          if (isPlumbingAttribute(key)) return false;
          // Already spent: the unit sits beside the state, and the device
          // class chose the header icon.
          if (key === "unit_of_measurement" && showsUnitWithState) return false;
          if (
            key === "device_class" &&
            typeof deviceClass === "string" &&
            HEADER_DEVICE_CLASSES.includes(deviceClass)
          ) {
            return false;
          }
          return true;
        })
        // HA hands attributes over in whatever order the integration built
        // them; alphabetical at least puts the same entity in the same order
        // twice running.
        .sort((a, b) => a.localeCompare(b));

  const displayAttributes = attributeKeys.map((key) => {
    const rawValue = entity.attributes[key];
    const shape = classifyAttributeValue(rawValue);
    const label = ATTRIBUTE_KEYS.includes(key)
      ? tAttr(key as AttributeKey)
      : humanizeAttributeKey(key);
    // `device_class` is an identifier, not a word. Translate the ones we have
    // words for; the rest are still more use to the reader than nothing.
    const translated =
      key === "device_class" &&
      typeof rawValue === "string" &&
      DEVICE_CLASS_KEYS.includes(rawValue)
        ? tDC(rawValue as DeviceClassKey)
        : null;
    return { key, label, shape, translated };
  });

  /*
    RFC-008 §5.4 / R3. Omitted entirely rather than shown empty: an entity
    whose history is fine and simply is not numeric should not be told it has
    "no history data".
  */
  const showHistory =
    stateShape.kind === "number" || DOMAINS_WITH_OWN_HISTORY.includes(domain);

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
        /*
          RFC-008 §5.3 — the domain is one nobody here has heard of.

          `supported_features` is a bitmask whose meaning comes from that
          domain's own IntFlag, so reading bits without knowing the enum ships
          buttons that do something else entirely. `homeassistant.turn_on` /
          `turn_off` is the one pair Home Assistant guarantees for anything
          with on/off semantics — the same pair `group` uses across mixed
          members — and an entity that is neither on nor off has no such
          semantics, so it gets nothing rather than a button that fails.
        */
        if (stateShape.kind !== "toggle") return null;
        return (
          <Button
            className="w-full"
            variant={isOn ? "default" : "outline"}
            onClick={() =>
              callService({
                domain: "homeassistant",
                service: isOn ? "turn_off" : "turn_on",
                entity_id: entity.entity_id,
              })
            }
            disabled={isPending}
          >
            {isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
            {isOn ? t("turnOffButton") : t("turnOnButton")}
          </Button>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] p-0">
        <DialogHeader className="p-6 pb-0">
          <div className="flex items-center gap-3">
            {imageUrl && !imageFailed ? (
              <div className="relative size-12 shrink-0 overflow-hidden rounded-xl bg-muted">
                <img
                  src={imageUrl}
                  alt=""
                  className="size-full object-cover"
                  onError={() => setFailedImageUrl(imageUrl)}
                />
              </div>
            ) : (
              <div
                className="p-3 rounded-xl"
                style={{ backgroundColor: `${color}20`, color }}
              >
                {getEntityIcon(entity.entity_id, deviceClass)}
              </div>
            )}
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
                  className="text-2xl font-semibold text-right break-words max-w-[65%]"
                  style={{ color: isUnavailable ? undefined : color }}
                >
                  {stateText}
                  {showsUnitWithState && (
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
            {showHistory && (
              <>
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
              </>
            )}

            {/* Attributes */}
            {displayAttributes.length > 0 && (
              <>
                <Separator />
                <div>
                  <h3 className="text-sm font-medium mb-3">{t("attributesHeading")}</h3>
                  <div className="flex flex-col gap-2">
                    {displayAttributes.map(({ key, label, shape, translated }) => (
                      <div
                        key={key}
                        className="flex items-start justify-between gap-3 text-sm py-1"
                      >
                        <span className="text-muted-foreground shrink-0">{label}</span>
                        {shape.kind === "complex" ? (
                          /*
                            An object in a row is `[object Object]` at best and
                            a wall of JSON at worst, so it goes behind a
                            disclosure and stays out of the way until asked
                            for.
                          */
                          <details className="max-w-[60%] text-right">
                            <summary className="cursor-pointer list-none font-medium underline underline-offset-4 [&::-webkit-details-marker]:hidden">
                              {t("showDetails")}
                            </summary>
                            <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-muted p-2 text-left font-mono text-xs whitespace-pre-wrap break-words">
                              {shape.json}
                            </pre>
                          </details>
                        ) : (
                          <span className="font-medium text-right max-w-[60%] break-words">
                            {translated ??
                              formatAttributeValue(
                                shape.kind === "list" ? shape.items : shape.value
                              )}
                          </span>
                        )}
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
