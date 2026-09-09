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
import { useEntityHistory } from "@/hooks";
import { MiniChart } from "./mini-chart";
import { EntityActions } from "./entity-actions";
import {
  classifyAttributeValue,
  classifyEntityHistory,
  classifyEntityState,
  isRestingUnknown,
  restingUnknownCopyKey,
  binarySensorStateKey,
  humanizeAttributeKey,
  isPlumbingAttribute,
} from "@/lib/ha-entity-display";
import type { HAEntity } from "@/types/home-assistant";

type DeviceClassKey =
  | "battery" | "temperature" | "humidity" | "power" | "energy" | "voltage"
  | "current" | "pressure" | "illuminance" | "motion" | "door" | "window"
  | "occupancy" | "plug" | "outlet" | "switch";

/**
 * Attribute keys that have a hand-written label in `entityDetail.attributes`.
 * Anything else falls back to {@link humanizeAttributeKey}, which is honest
 * but English-shaped.
 */
const ATTRIBUTE_KEYS: readonly string[] = [
  "brightness", "color_temp", "color_temp_kelvin", "supported_color_modes",
  "effect", "effect_list", "current_power_w", "today_energy_kwh",
  "unit_of_measurement", "device_class", "state_class", "temperature",
  "current_temperature", "target_temp_low", "target_temp_high", "min_temp",
  "max_temp", "target_temp_step", "hvac_modes", "preset_mode", "preset_modes",
  "fan_mode", "fan_modes", "swing_mode", "swing_modes",
  "swing_horizontal_mode", "current_humidity", "humidity", "min_humidity",
  "max_humidity", "mode", "available_modes", "current_position",
  "current_tilt_position", "percentage", "percentage_step", "oscillating",
  "direction", "changed_by", "code_format", "code_arm_required",
  "battery_level", "status", "fan_speed", "fan_speed_list", "volume_level",
  "is_volume_muted", "source", "source_list", "sound_mode", "shuffle",
  "repeat", "media_title", "media_artist",
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

/*
  Attributes worth surfacing, per domain — RFC-008 §4.1's "attributes worth
  surfacing" column, in the order it lists them.

  Curated order is authored, not alphabetical: a thermostat's current
  temperature belongs above its swing modes however the two happen to sort. A
  domain with no list here falls through to §5.2 — every attribute the entity
  carries, minus plumbing, sorted by the label the household actually reads.
*/
const IMPORTANT_ATTRIBUTES: Record<string, string[]> = {
  light: ["brightness", "color_temp_kelvin", "supported_color_modes", "effect", "effect_list"],
  switch: ["current_power_w", "today_energy_kwh"],
  sensor: ["unit_of_measurement", "device_class", "state_class"],
  binary_sensor: ["device_class"],
  fan: [
    "percentage", "percentage_step", "preset_mode", "preset_modes", "oscillating",
    "direction",
  ],
  cover: ["current_position", "current_tilt_position", "device_class"],
  lock: ["changed_by", "code_format"],
  media_player: [
    "media_title", "media_artist", "volume_level", "is_volume_muted", "source",
    "source_list", "sound_mode", "shuffle", "repeat",
  ],
  climate: [
    "current_temperature", "temperature", "target_temp_low", "target_temp_high",
    "min_temp", "max_temp", "target_temp_step", "hvac_modes", "preset_mode",
    "preset_modes", "fan_mode", "fan_modes", "swing_mode", "swing_modes",
    "current_humidity", "humidity",
  ],
  vacuum: ["battery_level", "fan_speed", "fan_speed_list", "status"],
  alarm_control_panel: ["code_format", "code_arm_required", "changed_by"],
  humidifier: [
    "current_humidity", "humidity", "mode", "available_modes", "min_humidity",
    "max_humidity",
  ],
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
  The enum states each domain has words for — RFC-008 R5.

  `heat_cool`, `armed_custom_bypass` and `docked` are identifiers, not words,
  and the shape-based reading of §5.1 would print them verbatim because all it
  can see is a string it does not recognise. These lists say which strings a
  namespace can translate; a value outside its list falls through to the shape
  reading rather than throwing a missing-key error, which is how a vendor's
  extra state stays readable.
*/
const HVAC_MODE_KEYS: readonly string[] = [
  "auto", "heat", "cool", "heat_cool", "dry", "fan_only", "off",
];
const HVAC_ACTION_KEYS: readonly string[] = ["heating", "cooling", "drying", "idle", "off"];
const LOCK_STATE_KEYS: readonly string[] = [
  "locked", "unlocked", "locking", "unlocking", "jammed",
];
const COVER_STATE_KEYS: readonly string[] = ["open", "opening", "closed", "closing"];
const MEDIA_PLAYER_STATE_KEYS: readonly string[] = [
  "playing", "paused", "idle", "off", "standby", "buffering",
];
const VACUUM_STATUS_KEYS: readonly string[] = [
  "cleaning", "docked", "paused", "idle", "returning", "error", "charging",
];
const ALARM_STATE_KEYS: readonly string[] = [
  "disarmed", "armed_home", "armed_away", "armed_night", "armed_vacation",
  "armed_custom_bypass", "pending", "arming", "disarming", "triggered",
];
const HUMIDIFIER_ACTION_KEYS: readonly string[] = ["humidifying", "drying", "idle", "off"];

function numberAttribute(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringAttribute(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

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
  const tHvacMode = useTranslations("homeAutomation.hvacMode");
  const tHvacAction = useTranslations("homeAutomation.hvacAction");
  const tLockState = useTranslations("homeAutomation.lockState");
  const tCoverState = useTranslations("homeAutomation.coverState");
  const tMediaPlayerState = useTranslations("homeAutomation.mediaPlayerState");
  const tVacuumStatus = useTranslations("homeAutomation.vacuumStatus");
  const tAlarmState = useTranslations("homeAutomation.alarmState");
  const tHumidifierAction = useTranslations("homeAutomation.humidifierAction");
  const tBinarySensorState = useTranslations("homeAutomation.binarySensorState");
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

  const shapeStateText = (() => {
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

  /*
    RFC-008 R5 — the domains that have their own vocabulary.

    The shape reading above is right for a domain nobody wrote a case for and
    wrong here: a lock is not "Off", and a thermostat reporting `heat_cool`
    must never say so out loud. Each of these namespaces was already complete
    in all three locales; what was missing was the sheet asking for them.
  */
  const domainStateText = (() => {
    switch (domain) {
      case "climate": {
        // The *action* when the thermostat is doing something ("Heating"),
        // and the configured mode when it is not — RFC-008 §4.1.
        const action = stringAttribute(entity.attributes.hvac_action);
        if (action && HVAC_ACTION_KEYS.includes(action)) return tHvacAction(action);
        return HVAC_MODE_KEYS.includes(entity.state) ? tHvacMode(entity.state) : null;
      }
      case "lock":
        return LOCK_STATE_KEYS.includes(entity.state) ? tLockState(entity.state) : null;
      case "cover":
        return COVER_STATE_KEYS.includes(entity.state) ? tCoverState(entity.state) : null;
      case "media_player":
        return MEDIA_PLAYER_STATE_KEYS.includes(entity.state)
          ? tMediaPlayerState(entity.state)
          : null;
      case "vacuum":
        return VACUUM_STATUS_KEYS.includes(entity.state) ? tVacuumStatus(entity.state) : null;
      case "alarm_control_panel":
        return ALARM_STATE_KEYS.includes(entity.state) ? tAlarmState(entity.state) : null;
      case "binary_sensor":
        /*
          A motion sensor reading "Off" is the same defect as a thermostat
          reading `heat_cool`: HA's vocabulary, not the household's. The pair
          comes from `device_class` — Open/Closed for a door, Motion/No motion
          for a PIR — and a class `binarySensorState` has no words for falls
          back to its own plain on/off, which is what the shape reading would
          have said anyway. Shared with the room screen's tile so the two
          cannot drift apart.
        */
        return entity.state === "on" || entity.state === "off"
          ? tBinarySensorState(binarySensorStateKey(deviceClass, entity.state))
          : null;
      default:
        return null;
    }
  })();

  /*
    RFC-008 R1 — the domains whose resting state is `unknown`.

    A scene's state is the timestamp it was last activated, and Home Assistant
    does not restore it: after a restart every scene in the house reports
    `unknown`. Saying "Not reachable" about a scene that works perfectly, next
    to an Activate button that also works, is a screen contradicting itself.
    `unavailable` is still unreachable, here as everywhere.

    The condition is `isRestingUnknown`, the same list the two *action* gates
    read, rather than a third hand-rolled `domain === "scene"`. Three copies is
    how the state card comes to say "Not reachable" over a working Press button
    when phase two adds `button` — the card and the control disagreeing about
    one entity, which is the failure this block was written to stop.
  */
  const restingUnknown =
    stateShape.kind === "unavailable" && isRestingUnknown(domain, entity.state);

  // Otherwise `unavailable` outranks every domain vocabulary: a lock we cannot
  // reach is not "Locked", it is unreachable.
  const stateText = restingUnknown
    ? t(restingUnknownCopyKey(domain))
    : stateShape.kind === "unavailable"
      ? shapeStateText
      : (domainStateText ?? shapeStateText);

  /*
    A second line under the reading, for the three domains where the state
    alone is not the interesting part: a thermostat's temperatures, a
    humidifier's `action` (its own state is only on/off), and what a speaker is
    actually playing.
  */
  const stateDetail = (() => {
    switch (domain) {
      case "climate": {
        const current = numberAttribute(entity.attributes.current_temperature);
        const target = numberAttribute(entity.attributes.temperature);
        const parts: string[] = [];
        if (current !== undefined) {
          parts.push(`${tAttr("current_temperature")} ${current.toLocaleString(intlLocale)}°`);
        }
        if (target !== undefined) {
          parts.push(`${tAttr("temperature")} ${target.toLocaleString(intlLocale)}°`);
        }
        return parts.length > 0 ? parts.join(" · ") : null;
      }
      case "humidifier": {
        const action = stringAttribute(entity.attributes.action);
        return action && HUMIDIFIER_ACTION_KEYS.includes(action)
          ? tHumidifierAction(action)
          : null;
      }
      case "media_player": {
        const title = stringAttribute(entity.attributes.media_title);
        const artist = stringAttribute(entity.attributes.media_artist);
        if (!title) return null;
        return artist ? `${title} — ${artist}` : title;
      }
      default:
        return null;
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

  const isUnavailable = stateShape.kind === "unavailable";

  /** `null` when the caller had no `last_changed` to give — see the header. */
  const lastChangedAt = Date.parse(entity.last_changed);
  const lastChanged = Number.isNaN(lastChangedAt) ? null : new Date(lastChangedAt);

  /*
    Curated attributes for the domains that have a list; everything the entity
    carries for the ones that do not (RFC-008 §5.2), minus plumbing. Showing
    all of them is the one place the thin sheet beat this one: for an
    unfamiliar entity the attributes are frequently the only thing on screen
    that says what it is.
  */
  const curatedKeys = IMPORTANT_ATTRIBUTES[domain];
  const attributeKeys = curatedKeys
    ? curatedKeys.filter((key) => entity.attributes[key] !== undefined)
    : Object.keys(entity.attributes).filter((key) => {
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
      });

  /*
    Attribute *values* that are HA identifiers rather than words — R5 again.

    The state card and the mode buttons both render `heat_cool` as "Heat/Cool",
    and then the attributes list printed the raw `hvac_modes` array underneath
    them: the same leak, one row further down. Everything else in these lists
    (`preset_modes`, `source_list`, `effect_list`) is author-defined text that
    is already human, and is left exactly as its author wrote it.
  */
  const translateAttributeValue = (key: string, rawValue: unknown): string | null => {
    if (
      key === "device_class" &&
      typeof rawValue === "string" &&
      DEVICE_CLASS_KEYS.includes(rawValue)
    ) {
      return tDC(rawValue as DeviceClassKey);
    }
    if (key === "hvac_modes" && Array.isArray(rawValue)) {
      return rawValue
        .map((mode) =>
          typeof mode === "string" && HVAC_MODE_KEYS.includes(mode)
            ? tHvacMode(mode)
            : String(mode),
        )
        .join(", ");
    }
    if (key === "repeat" && rawValue === "off") return t("repeatOff");
    if (key === "repeat" && rawValue === "all") return t("repeatAll");
    if (key === "repeat" && rawValue === "one") return t("repeatOne");
    if (key === "direction" && rawValue === "forward") return t("directionForward");
    if (key === "direction" && rawValue === "reverse") return t("directionReverse");
    return null;
  };

  const displayAttributes = attributeKeys.map((key) => {
    const rawValue = entity.attributes[key];
    const shape = classifyAttributeValue(rawValue);
    const label = ATTRIBUTE_KEYS.includes(key) ? tAttr(key) : humanizeAttributeKey(key);
    return { key, label, shape, translated: translateAttributeValue(key, rawValue) };
  });

  /*
    Sorted by the label, not by the key.

    HA hands attributes over in whatever order the integration built them, so
    *some* order is needed to put the same entity in the same order twice
    running — but sorting by `current_position` while the reader sees "Current
    position" is a sort nobody can see, and in German the two orders are barely
    related. Curated domains keep their authored order instead: that one is
    deliberate.
  */
  if (!curatedKeys) {
    displayAttributes.sort((a, b) => a.label.localeCompare(b.label, intlLocale));
  }

  /*
    RFC-008 R3. Omitted entirely rather than shown empty: an entity whose
    history is fine and simply is not a number or on/off should not be told
    it has "no history data" — a `climate` entity's `heat_cool` history would
    otherwise draw a flat line at zero that reads exactly like a reading.
  */
  const historyKind = classifyEntityHistory(domain, entity.state, entity.attributes);
  const showHistory = historyKind !== "none";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] p-0">
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
              {stateDetail && (
                <p className="text-sm text-muted-foreground mt-1 text-right">{stateDetail}</p>
              )}
              {/*
                Omitted rather than guessed. A caller that has never had a
                reading for this entity — the automation page opening a tile
                whose entity Home Assistant has never reported — has no moment
                to name, and "Last updated: <this second>" under "Not reachable"
                would be dating our own ignorance.
              */}
              {lastChanged && (
                <p className="text-xs text-muted-foreground mt-2">
                  {t("lastUpdatedLabel")} {lastChanged.toLocaleString(intlLocale)}
                </p>
              )}
            </div>

            {/*
              Actions — RFC-008 §4.1, one component per domain. Renders nothing
              at all (no separator, no heading) for a read-only domain, or for
              a device whose every feature gate came back false.
            */}
            <EntityActions entity={entity} displayName={label} />

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
