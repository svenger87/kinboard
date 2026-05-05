"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  Car,
  Battery,
  Thermometer,
  Shield,
  Gauge,
  Info,
  Monitor,
  ArrowLeft,
  Loader2,
  Check,
  Search,
  Coins,
} from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { GlassCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useHomeAssistantStatus,
  useTeslaConfig,
  useSaveTeslaConfig,
  useHomeAssistantEntities,
} from "@/hooks";
import { toast } from "sonner";
import type { TeslaConfig, HAEntity } from "@/types/home-assistant";

// Entity selector component
interface EntitySelectorProps {
  label: string;
  description: string;
  value: string | undefined;
  onChange: (value: string) => void;
  entities: HAEntity[];
  allEntities?: HAEntity[];
  filterDomain?: string;
  filterDeviceClass?: string;
}

function EntitySelector({
  label,
  description,
  value,
  onChange,
  entities,
  allEntities,
  filterDomain,
  filterDeviceClass,
}: EntitySelectorProps) {
  const t = useTranslations("settings.tesla");
  const [search, setSearch] = useState("");

  // If current value isn't in the filtered entity list, find it in allEntities
  const currentEntity = value ? (entities.find(e => e.entity_id === value) || allEntities?.find(e => e.entity_id === value)) : undefined;
  const entitiesWithCurrent = currentEntity && !entities.find(e => e.entity_id === value)
    ? [currentEntity, ...entities]
    : entities;

  const filteredEntities = entitiesWithCurrent.filter((entity) => {
    // Always include the currently selected entity so it shows in the dropdown
    if (value && entity.entity_id === value) return true;

    // Domain filter
    if (filterDomain && !entity.domain.includes(filterDomain)) return false;

    // Device class filter (for sensors)
    if (filterDeviceClass && entity.attributes.device_class !== filterDeviceClass) return false;

    // Search filter
    if (search) {
      const searchLower = search.toLowerCase();
      return (
        entity.name.toLowerCase().includes(searchLower) ||
        entity.entity_id.toLowerCase().includes(searchLower)
      );
    }

    return true;
  });

  const handleChange = (newValue: string) => {
    // Convert special "none" value back to empty string for clearing
    onChange(newValue === "__none__" ? "" : newValue);
  };

  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <Select value={value || "__none__"} onValueChange={handleChange}>
        <SelectTrigger>
          <SelectValue placeholder={t("entityPlaceholder")} />
        </SelectTrigger>
        <SelectContent>
          <div className="flex items-center px-2 pb-2">
            <Search className="size-4 mr-2 text-muted-foreground" />
            <Input
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8"
            />
          </div>
          <SelectItem value="__none__">{t("noneOption")}</SelectItem>
          {filteredEntities
            .filter((entity) => entity.entity_id) // Filter out any entities with empty IDs
            .sort((a, b) => {
              // Prioritize Tesla entities
              const aT = a.entity_id.toLowerCase().includes("tesla") ? 0 : 1;
              const bT = b.entity_id.toLowerCase().includes("tesla") ? 0 : 1;
              return aT - bT || a.name.localeCompare(b.name);
            })
            .slice(0, 100)
            .map((entity) => (
              <SelectItem key={entity.entity_id} value={entity.entity_id}>
                <div className="flex flex-col">
                  <span>{entity.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {entity.entity_id}
                  </span>
                </div>
              </SelectItem>
            ))}
          {filteredEntities.length > 100 && (
            <div className="px-2 py-1 text-xs text-muted-foreground">
              {t("moreCount", { count: filteredEntities.length - 100 })}
            </div>
          )}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

export default function TeslaConfigPage() {
  const t = useTranslations("settings.tesla");
  const { data: settings, isLoading: loadingSettings } = useHomeAssistantStatus();
  const existingConfig = useTeslaConfig();
  const saveConfig = useSaveTeslaConfig();
  const { data: entities = [] } = useHomeAssistantEntities(
    undefined,
    !!settings?.url
  );

  // Local state for form
  const [config, setConfig] = useState<TeslaConfig>({});

  // Initialize form with existing config
  useEffect(() => {
    if (existingConfig) {
      setConfig(existingConfig);
    }
  }, [existingConfig]);

  const isConnected = !!settings?.url && !!settings?.access_token;

  // Helper to update config field
  const updateField = (field: keyof TeslaConfig, value: string | number | boolean | undefined) => {
    setConfig((prev) => ({
      ...prev,
      [field]: value === "" ? undefined : value,
    }));
  };

  const handleSave = async () => {
    try {
      await saveConfig.mutateAsync(config);
    } catch {
      toast.error(t("saveFailed"));
    }
  };

  if (loadingSettings) {
    return (
      <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
        <div className="relative z-10 max-w-2xl mx-auto flex flex-col gap-6">
          <PageHeader
            iconSlot={
              <div className="p-2.5 rounded-xl bg-info/10 shrink-0">
                <Car className="size-6 text-info" strokeWidth={1.5} />
              </div>
            }
            title={t("title")}
            subtitle={t("subtitleLoading")}
            backHref="/settings/homeassistant"
          />
          <GlassCard>
            <div className="p-6">
              <div className="flex items-center gap-3">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
                <span className="text-muted-foreground">{t("loadingHint")}</span>
              </div>
            </div>
          </GlassCard>
        </div>
      </main>
    );
  }

  if (!isConnected) {
    return (
      <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
        <div className="relative z-10 max-w-2xl mx-auto flex flex-col gap-6">
          <Link href="/settings/homeassistant" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4 mr-2" />
            {t("backLink")}
          </Link>
          <GlassCard>
            <div className="p-8 text-center">
              <Car className="size-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h2 className="text-lg font-medium mb-2">{t("notConnectedTitle")}</h2>
              <p className="text-muted-foreground">
                {t("notConnectedDescription")}
              </p>
            </div>
          </GlassCard>
        </div>
      </main>
    );
  }

  // Helper: include entity if it matches the filter OR contains "tesla" in entity_id
  const isTesla = (e: HAEntity) => e.entity_id.toLowerCase().includes("tesla");

  // All entities for general selection
  const allEntities = entities;

  // Filter entities for battery/percentage sensors
  const batterySensors = entities.filter(
    (e) =>
      (e.domain === "sensor" &&
        (e.attributes.device_class === "battery" ||
          e.attributes.unit_of_measurement === "%" ||
          e.entity_id.includes("battery") ||
          e.entity_id.includes("charge"))) ||
      isTesla(e)
  );

  // Filter entities for temperature sensors
  const temperatureSensors = entities.filter(
    (e) =>
      (e.domain === "sensor" &&
        (e.attributes.device_class === "temperature" ||
          e.attributes.unit_of_measurement === "°C" ||
          e.attributes.unit_of_measurement === "°F")) ||
      (isTesla(e) && (e.entity_id.includes("temp") || e.entity_id.includes("climate")))
  );

  // Filter entities for power sensors
  const powerSensors = entities.filter(
    (e) =>
      (e.domain === "sensor" &&
        (e.attributes.device_class === "power" ||
          e.attributes.unit_of_measurement === "W" ||
          e.attributes.unit_of_measurement === "kW")) ||
      (isTesla(e) && (e.entity_id.includes("power") || e.entity_id.includes("charg") || e.entity_id.includes("rate")))
  );

  // Filter entities for energy sensors
  const energySensors = entities.filter(
    (e) =>
      (e.domain === "sensor" &&
        (e.attributes.device_class === "energy" ||
          e.attributes.unit_of_measurement === "kWh" ||
          e.attributes.unit_of_measurement === "Wh")) ||
      (isTesla(e) && (e.entity_id.includes("energy") || e.entity_id.includes("added")))
  );

  // Filter entities for distance sensors
  const distanceSensors = entities.filter(
    (e) =>
      (e.domain === "sensor" &&
        (e.attributes.device_class === "distance" ||
          e.attributes.unit_of_measurement === "km" ||
          e.attributes.unit_of_measurement === "mi" ||
          e.entity_id.includes("range") ||
          e.entity_id.includes("odometer"))) ||
      (isTesla(e) && (e.entity_id.includes("range") || e.entity_id.includes("odometer") || e.entity_id.includes("distance")))
  );

  // Filter entities for pressure sensors
  const pressureSensors = entities.filter(
    (e) =>
      (e.domain === "sensor" &&
        (e.attributes.device_class === "pressure" ||
          e.attributes.unit_of_measurement === "bar" ||
          e.attributes.unit_of_measurement === "psi" ||
          e.attributes.unit_of_measurement === "kPa" ||
          e.entity_id.includes("tire_pressure"))) ||
      (isTesla(e) && e.entity_id.includes("tire"))
  );

  // Binary sensors, locks, and Tesla entities for vehicle status
  const vehicleStatusEntities = entities.filter(
    (e) =>
      e.domain === "lock" ||
      (e.domain === "binary_sensor" && isTesla(e)) ||
      isTesla(e)
  );

  // Device trackers and Tesla location entities
  const locationEntities = entities.filter(
    (e) =>
      e.domain === "device_tracker" ||
      (isTesla(e) && (e.entity_id.includes("location") || e.entity_id.includes("destination") || e.entity_id.includes("park")))
  );

  // Tesla-specific entities (for selectors that need broad Tesla access)
  const teslaEntities = entities.filter((e) => isTesla(e));

  // Climate entities (climate domain + Tesla climate sensors)
  const climateEntities = entities.filter(
    (e) =>
      e.domain === "climate" ||
      (isTesla(e) && (e.entity_id.includes("climate") || e.entity_id.includes("hvac")))
  );

  return (
    <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="relative z-10 max-w-2xl mx-auto flex flex-col gap-6">
        <PageHeader
          iconSlot={
            <div className="p-2.5 rounded-xl bg-info/10 shrink-0">
              <Car className="size-6 text-info" strokeWidth={1.5} />
            </div>
          }
          title={t("title")}
          subtitle={t("subtitle")}
          backHref="/settings/homeassistant"
        />

        {/* Battery & Charging */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <GlassCard>
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-success/10">
                  <Battery className="size-5 text-success" />
                </div>
                <h2 className="font-medium">{t("batteryHeading")}</h2>
              </div>

              <div className="flex flex-col gap-4">
                <EntitySelector
                  label={t("batteryLevelLabel")}
                  description={t("batteryLevelDescription")}
                  value={config.battery_level}
                  onChange={(v) => updateField("battery_level", v)}
                  entities={batterySensors}
                  allEntities={allEntities}
                />

                <EntitySelector
                  label={t("rangeLabel")}
                  description={t("rangeDescription")}
                  value={config.battery_range}
                  onChange={(v) => updateField("battery_range", v)}
                  entities={distanceSensors}
                  allEntities={allEntities}
                />

                <EntitySelector
                  label={t("chargeRateLabel")}
                  description={t("chargeRateDescription")}
                  value={config.charging_rate}
                  onChange={(v) => updateField("charging_rate", v)}
                  entities={powerSensors}
                  allEntities={allEntities}
                />

                <EntitySelector
                  label={t("chargeStateLabel")}
                  description={t("chargeStateDescription")}
                  value={config.charging_state}
                  onChange={(v) => updateField("charging_state", v)}
                  entities={teslaEntities}
                  allEntities={allEntities}
                />

                <EntitySelector
                  label={t("chargeLimitLabel")}
                  description={t("chargeLimitDescription")}
                  value={config.charge_limit}
                  onChange={(v) => updateField("charge_limit", v)}
                  entities={batterySensors}
                  allEntities={allEntities}
                />

                <EntitySelector
                  label={t("timeToFullLabel")}
                  description={t("timeToFullDescription")}
                  value={config.time_to_full_charge}
                  onChange={(v) => updateField("time_to_full_charge", v)}
                  entities={teslaEntities}
                  allEntities={allEntities}
                />

                <EntitySelector
                  label={t("chargerPowerLabel")}
                  description={t("chargerPowerDescription")}
                  value={config.charger_power}
                  onChange={(v) => updateField("charger_power", v)}
                  entities={powerSensors}
                  allEntities={allEntities}
                />

                <EntitySelector
                  label={t("chargeEnergyAddedLabel")}
                  description={t("chargeEnergyAddedDescription")}
                  value={config.charge_energy_added}
                  onChange={(v) => updateField("charge_energy_added", v)}
                  entities={energySensors}
                  allEntities={allEntities}
                />
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* Climate */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <GlassCard>
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-orange-500/10">
                  <Thermometer className="size-5 text-orange-500" />
                </div>
                <h2 className="font-medium">{t("climateHeading")}</h2>
              </div>

              <div className="flex flex-col gap-4">
                <EntitySelector
                  label={t("insideTempLabel")}
                  description={t("insideTempDescription")}
                  value={config.inside_temperature}
                  onChange={(v) => updateField("inside_temperature", v)}
                  entities={temperatureSensors}
                  allEntities={allEntities}
                />

                <EntitySelector
                  label={t("outsideTempLabel")}
                  description={t("outsideTempDescription")}
                  value={config.outside_temperature}
                  onChange={(v) => updateField("outside_temperature", v)}
                  entities={temperatureSensors}
                  allEntities={allEntities}
                />

                <EntitySelector
                  label={t("climateStateLabel")}
                  description={t("climateStateDescription")}
                  value={config.climate_state}
                  onChange={(v) => updateField("climate_state", v)}
                  entities={climateEntities}
                  allEntities={allEntities}
                />
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* Vehicle Status */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <GlassCard>
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-destructive/10">
                  <Shield className="size-5 text-destructive" />
                </div>
                <h2 className="font-medium">{t("vehicleStatusHeading")}</h2>
              </div>

              <div className="flex flex-col gap-4">
                <EntitySelector
                  label={t("lockedLabel")}
                  description={t("lockedDescription")}
                  value={config.locked}
                  onChange={(v) => updateField("locked", v)}
                  entities={vehicleStatusEntities}
                  allEntities={allEntities}
                />

                <EntitySelector
                  label={t("windowsLabel")}
                  description={t("windowsDescription")}
                  value={config.windows}
                  onChange={(v) => updateField("windows", v)}
                  entities={vehicleStatusEntities}
                  allEntities={allEntities}
                />

                <EntitySelector
                  label={t("doorsLabel")}
                  description={t("doorsDescription")}
                  value={config.doors}
                  onChange={(v) => updateField("doors", v)}
                  entities={vehicleStatusEntities}
                  allEntities={allEntities}
                />

                <EntitySelector
                  label={t("trunkLabel")}
                  description={t("trunkDescription")}
                  value={config.trunk}
                  onChange={(v) => updateField("trunk", v)}
                  entities={vehicleStatusEntities}
                  allEntities={allEntities}
                />

                <EntitySelector
                  label={t("frunkLabel")}
                  description={t("frunkDescription")}
                  value={config.frunk}
                  onChange={(v) => updateField("frunk", v)}
                  entities={vehicleStatusEntities}
                  allEntities={allEntities}
                />
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* Tire pressure */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <GlassCard>
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-warning/10">
                  <Gauge className="size-5 text-warning" />
                </div>
                <h2 className="font-medium">{t("tirePressureHeading")}</h2>
              </div>

              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <EntitySelector
                    label={t("tireFLLabel")}
                    description={t("tireFLDescription")}
                    value={config.tire_pressure_fl}
                    onChange={(v) => updateField("tire_pressure_fl", v)}
                    entities={pressureSensors}
                    allEntities={allEntities}
                  />
                  <EntitySelector
                    label={t("tireFRLabel")}
                    description={t("tireFRDescription")}
                    value={config.tire_pressure_fr}
                    onChange={(v) => updateField("tire_pressure_fr", v)}
                    entities={pressureSensors}
                    allEntities={allEntities}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <EntitySelector
                    label={t("tireRLLabel")}
                    description={t("tireRLDescription")}
                    value={config.tire_pressure_rl}
                    onChange={(v) => updateField("tire_pressure_rl", v)}
                    entities={pressureSensors}
                    allEntities={allEntities}
                  />
                  <EntitySelector
                    label={t("tireRRLabel")}
                    description={t("tireRRDescription")}
                    value={config.tire_pressure_rr}
                    onChange={(v) => updateField("tire_pressure_rr", v)}
                    entities={pressureSensors}
                    allEntities={allEntities}
                  />
                </div>
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* Vehicle info */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <GlassCard>
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-info/10">
                  <Info className="size-5 text-info" />
                </div>
                <h2 className="font-medium">{t("vehicleInfoHeading")}</h2>
              </div>

              <div className="flex flex-col gap-4">
                <EntitySelector
                  label={t("odometerLabel")}
                  description={t("odometerDescription")}
                  value={config.odometer}
                  onChange={(v) => updateField("odometer", v)}
                  entities={distanceSensors}
                  allEntities={allEntities}
                />

                <EntitySelector
                  label={t("locationLabel")}
                  description={t("locationDescription")}
                  value={config.location}
                  onChange={(v) => updateField("location", v)}
                  entities={locationEntities}
                  allEntities={allEntities}
                />

                <EntitySelector
                  label={t("stateLabel")}
                  description={t("stateDescription")}
                  value={config.state}
                  onChange={(v) => updateField("state", v)}
                  entities={teslaEntities}
                  allEntities={allEntities}
                />
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* Display toggles */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <GlassCard>
            <div className="p-6">
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-purple-500/10">
                      <Monitor className="size-5 text-purple-500" />
                    </div>
                    <div>
                      <Label className="font-medium">{t("displayScreensaverLabel")}</Label>
                      <p className="text-xs text-muted-foreground">
                        {t("displayScreensaverDescription")}
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={config.show_on_screensaver ?? false}
                    onCheckedChange={(v) => updateField("show_on_screensaver", v)}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-purple-500/10">
                      <Monitor className="size-5 text-purple-500" />
                    </div>
                    <div>
                      <Label className="font-medium">{t("displayDashboardLabel")}</Label>
                      <p className="text-xs text-muted-foreground">
                        {t("displayDashboardDescription")}
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={config.show_on_dashboard ?? false}
                    onCheckedChange={(v) => updateField("show_on_dashboard", v)}
                  />
                </div>
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* Costs */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
        >
          <GlassCard>
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-cyan-500/10">
                  <Coins className="size-5 text-cyan-500" />
                </div>
                <h2 className="font-medium">{t("costsHeading")}</h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label>{t("costPerKwhLabel")}</Label>
                  <div className="relative">
                    <Input
                      type="number"
                      step="0.01"
                      placeholder={t("costPerKwhPlaceholder")}
                      value={config.cost_per_kwh || ""}
                      onChange={(e) => updateField("cost_per_kwh", parseFloat(e.target.value) || undefined)}
                      className="pr-16"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                      €/kWh
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <Label>{t("currencyLabel")}</Label>
                  <Input
                    type="text"
                    placeholder={t("currencyPlaceholder")}
                    value={config.currency || ""}
                    onChange={(e) => updateField("currency", e.target.value)}
                  />
                </div>
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saveConfig.isPending}>
            {saveConfig.isPending ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                {t("savingLabel")}
              </>
            ) : (
              <>
                <Check className="size-4 mr-2" />
                {t("saveButton")}
              </>
            )}
          </Button>
        </div>
      </div>
    </main>
  );
}
