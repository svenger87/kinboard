"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  Zap,
  Sun,
  Battery,
  Home,
  ArrowLeft,
  Loader2,
  Check,
  Search,
  Monitor,
  LineChart,
  Plus,
  X,
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
  useEnergyConfig,
  useSaveEnergyConfig,
  useHomeAssistantEntities,
} from "@/hooks";
import type { EnergyConfig, HAEntity } from "@/types/home-assistant";

type ColorPresetKey =
  | "colorOrange"
  | "colorBlue"
  | "colorRed"
  | "colorGreen"
  | "colorCyan"
  | "colorPurple"
  | "colorPink"
  | "colorYellow";

// Color presets for chart entities; labels resolved per-locale via t()
const COLOR_PRESETS: { labelKey: ColorPresetKey; value: string }[] = [
  { labelKey: "colorOrange", value: "#FFA500" },
  { labelKey: "colorBlue", value: "#3b82f6" },
  { labelKey: "colorRed", value: "#ef4444" },
  { labelKey: "colorGreen", value: "#22c55e" },
  { labelKey: "colorCyan", value: "#06b6d4" },
  { labelKey: "colorPurple", value: "#8b5cf6" },
  { labelKey: "colorPink", value: "#ec4899" },
  { labelKey: "colorYellow", value: "#eab308" },
];

// Entity selector component
interface EntitySelectorProps {
  label: string;
  description: string;
  value: string | undefined;
  onChange: (value: string) => void;
  entities: HAEntity[];
  filterDomain?: string;
  filterDeviceClass?: string;
}

function EntitySelector({
  label,
  description,
  value,
  onChange,
  entities,
  filterDomain,
  filterDeviceClass,
}: EntitySelectorProps) {
  const t = useTranslations("settings.homeassistantEnergy");
  const [search, setSearch] = useState("");

  const filteredEntities = entities.filter((entity) => {
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
            .slice(0, 50)
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
          {filteredEntities.length > 50 && (
            <div className="px-2 py-1 text-xs text-muted-foreground">
              {t("moreCount", { count: filteredEntities.length - 50 })}
            </div>
          )}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

// Chart entity configuration
interface ChartEntityConfig {
  entity_id: string;
  label: string;
  color: string;
}

// Chart entity list editor
interface ChartEntityEditorProps {
  label: string;
  description: string;
  entities: ChartEntityConfig[];
  availableEntities: HAEntity[];
  onChange: (entities: ChartEntityConfig[]) => void;
}

function ChartEntityEditor({
  label,
  description,
  entities,
  availableEntities,
  onChange,
}: ChartEntityEditorProps) {
  const t = useTranslations("settings.homeassistantEnergy");
  const [search, setSearch] = useState("");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newEntity, setNewEntity] = useState<ChartEntityConfig>({
    entity_id: "",
    label: "",
    color: COLOR_PRESETS[0].value,
  });

  const filteredEntities = availableEntities.filter((entity) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      entity.name.toLowerCase().includes(searchLower) ||
      entity.entity_id.toLowerCase().includes(searchLower)
    );
  });

  const addEntity = () => {
    if (!newEntity.entity_id) return;

    // Find entity name for default label
    const entity = availableEntities.find(e => e.entity_id === newEntity.entity_id);
    const finalEntity = {
      ...newEntity,
      label: newEntity.label || entity?.name || newEntity.entity_id,
    };

    onChange([...entities, finalEntity]);
    setNewEntity({ entity_id: "", label: "", color: COLOR_PRESETS[(entities.length + 1) % COLOR_PRESETS.length].value });
    setShowAddDialog(false);
    setSearch("");
  };

  const removeEntity = (index: number) => {
    const updated = [...entities];
    updated.splice(index, 1);
    onChange(updated);
  };

  const updateEntity = (index: number, updates: Partial<ChartEntityConfig>) => {
    const updated = [...entities];
    updated[index] = { ...updated[index], ...updates };
    onChange(updated);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <Label>{label}</Label>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowAddDialog(true)}
        >
          <Plus className="size-4 mr-1" />
          {t("chartAddButton")}
        </Button>
      </div>

      {/* Existing entities */}
      {entities.length > 0 && (
        <div className="flex flex-col gap-2">
          {entities.map((entity, index) => (
            <div
              key={`${entity.entity_id}-${index}`}
              className="flex items-center gap-2 p-2 rounded-lg border bg-muted/30"
            >
              <div
                className="size-4 rounded-full shrink-0"
                style={{ backgroundColor: entity.color }}
              />
              <div className="flex-1 min-w-0">
                <Input
                  value={entity.label}
                  onChange={(e) => updateEntity(index, { label: e.target.value })}
                  className="h-7 text-sm"
                  placeholder={t("chartLabelPlaceholder")}
                />
              </div>
              <Select
                value={entity.color}
                onValueChange={(v) => updateEntity(index, { color: v })}
              >
                <SelectTrigger className="w-20 h-7">
                  <div
                    className="size-3 rounded-full"
                    style={{ backgroundColor: entity.color }}
                  />
                </SelectTrigger>
                <SelectContent>
                  {COLOR_PRESETS.map((color) => (
                    <SelectItem key={color.value} value={color.value}>
                      <div className="flex items-center gap-2">
                        <div
                          className="size-3 rounded-full"
                          style={{ backgroundColor: color.value }}
                        />
                        <span>{t(color.labelKey)}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                onClick={() => removeEntity(index)}
              >
                <X className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {entities.length === 0 && (
        <div className="text-sm text-muted-foreground text-center py-4 border rounded-lg border-dashed">
          {t("chartEmpty")}
        </div>
      )}

      {/* Add dialog */}
      {showAddDialog && (
        <div className="p-3 border rounded-lg flex flex-col gap-3 bg-background">
          <div className="flex items-center gap-2 pb-2 border-b">
            <Search className="size-4 text-muted-foreground" />
            <Input
              placeholder={t("chartEntitySearchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 border-0 p-0 focus-visible:ring-0"
            />
          </div>
          <div className="max-h-40 overflow-y-auto flex flex-col gap-1">
            {filteredEntities.slice(0, 20).map((entity) => (
              <button
                key={entity.entity_id}
                onClick={() => setNewEntity(prev => ({ ...prev, entity_id: entity.entity_id, label: entity.name }))}
                className={`w-full text-left p-2 rounded text-sm hover:bg-muted transition-colors ${
                  newEntity.entity_id === entity.entity_id ? "bg-muted" : ""
                }`}
              >
                <div className="font-medium truncate">{entity.name}</div>
                <div className="text-xs text-muted-foreground truncate">{entity.entity_id}</div>
              </button>
            ))}
          </div>
          {newEntity.entity_id && (
            <div className="flex items-center gap-2 pt-2 border-t">
              <Input
                placeholder={t("chartLabelPlaceholder")}
                value={newEntity.label}
                onChange={(e) => setNewEntity(prev => ({ ...prev, label: e.target.value }))}
                className="h-8 flex-1"
              />
              <Select
                value={newEntity.color}
                onValueChange={(v) => setNewEntity(prev => ({ ...prev, color: v }))}
              >
                <SelectTrigger className="w-20 h-8">
                  <div
                    className="size-3 rounded-full"
                    style={{ backgroundColor: newEntity.color }}
                  />
                </SelectTrigger>
                <SelectContent>
                  {COLOR_PRESETS.map((color) => (
                    <SelectItem key={color.value} value={color.value}>
                      <div className="flex items-center gap-2">
                        <div
                          className="size-3 rounded-full"
                          style={{ backgroundColor: color.value }}
                        />
                        <span>{t(color.labelKey)}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowAddDialog(false);
                setSearch("");
                setNewEntity({ entity_id: "", label: "", color: COLOR_PRESETS[0].value });
              }}
            >
              {t("chartCancelButton")}
            </Button>
            <Button
              size="sm"
              onClick={addEntity}
              disabled={!newEntity.entity_id}
            >
              {t("chartAddInline")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function EnergyConfigPage() {
  const t = useTranslations("settings.homeassistantEnergy");
  const { data: settings, isLoading: loadingSettings } = useHomeAssistantStatus();
  const existingConfig = useEnergyConfig();
  const saveConfig = useSaveEnergyConfig();
  const { data: entities = [], isLoading: loadingEntities } = useHomeAssistantEntities(
    undefined,
    !!settings?.url
  );
  void loadingEntities;

  // Local state for form
  const [config, setConfig] = useState<EnergyConfig>({});

  // Initialize form with existing config
  useEffect(() => {
    if (existingConfig) {
      setConfig(existingConfig);
    }
  }, [existingConfig]);

  const isConnected = !!settings?.url && !!settings?.access_token;

  // Helper to update config field
  const updateField = (field: keyof EnergyConfig, value: string | number | boolean | undefined) => {
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
              <div className="p-2.5 rounded-xl bg-warning/10 shrink-0">
                <Zap className="size-6 text-warning" strokeWidth={1.5} />
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
              <Zap className="size-12 mx-auto mb-4 text-muted-foreground opacity-50" />
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

  // Filter entities for power sensors (W)
  const powerSensors = entities.filter(
    (e) =>
      e.domain === "sensor" &&
      (e.attributes.device_class === "power" ||
        e.attributes.unit_of_measurement === "W" ||
        e.attributes.unit_of_measurement === "kW")
  );

  // Filter entities for energy sensors (kWh)
  const energySensors = entities.filter(
    (e) =>
      e.domain === "sensor" &&
      (e.attributes.device_class === "energy" ||
        e.attributes.unit_of_measurement === "kWh" ||
        e.attributes.unit_of_measurement === "Wh")
  );

  // Filter for battery SOC sensors (%)
  const batterySensors = entities.filter(
    (e) =>
      e.domain === "sensor" &&
      (e.attributes.device_class === "battery" ||
        (e.attributes.unit_of_measurement === "%" &&
          (e.entity_id.includes("battery") || e.entity_id.includes("soc"))))
  );

  return (
    <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="relative z-10 max-w-2xl mx-auto flex flex-col gap-6">
        <PageHeader
          iconSlot={
            <div className="p-2.5 rounded-xl bg-warning/10 shrink-0">
              <Zap className="size-6 text-warning" strokeWidth={1.5} />
            </div>
          }
          title={t("title")}
          subtitle={t("subtitle")}
          backHref="/settings/homeassistant"
        />

        {/* Solar Configuration */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <GlassCard>
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-orange-500/10">
                  <Sun className="size-5 text-orange-500" />
                </div>
                <h2 className="font-medium">{t("solarHeading")}</h2>
              </div>

              <div className="flex flex-col gap-4">
                <EntitySelector
                  label={t("solarPowerLabel")}
                  description={t("solarPowerDescription")}
                  value={config.solar_power}
                  onChange={(v) => updateField("solar_power", v)}
                  entities={powerSensors}
                />

                <EntitySelector
                  label={t("solarTodayLabel")}
                  description={t("solarTodayDescription")}
                  value={config.solar_energy_today}
                  onChange={(v) => updateField("solar_energy_today", v)}
                  entities={energySensors}
                />
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* Battery Configuration */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
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
                  label={t("batteryPowerCombinedLabel")}
                  description={t("batteryPowerCombinedDescription")}
                  value={config.battery_power}
                  onChange={(v) => updateField("battery_power", v)}
                  entities={powerSensors}
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <EntitySelector
                    label={t("batteryChargeLabel")}
                    description={t("batteryChargeDescription")}
                    value={config.battery_charge_power}
                    onChange={(v) => updateField("battery_charge_power", v)}
                    entities={powerSensors}
                  />
                  <EntitySelector
                    label={t("batteryDischargeLabel")}
                    description={t("batteryDischargeDescription")}
                    value={config.battery_discharge_power}
                    onChange={(v) => updateField("battery_discharge_power", v)}
                    entities={powerSensors}
                  />
                </div>

                <EntitySelector
                  label={t("batterySocLabel")}
                  description={t("batterySocDescription")}
                  value={config.battery_soc}
                  onChange={(v) => updateField("battery_soc", v)}
                  entities={batterySensors}
                />

                <EntitySelector
                  label={t("batteryEnergyInLabel")}
                  description={t("batteryEnergyInDescription")}
                  value={config.battery_energy_in}
                  onChange={(v) => updateField("battery_energy_in", v)}
                  entities={energySensors}
                />

                <EntitySelector
                  label={t("batteryEnergyOutLabel")}
                  description={t("batteryEnergyOutDescription")}
                  value={config.battery_energy_out}
                  onChange={(v) => updateField("battery_energy_out", v)}
                  entities={energySensors}
                />

                <div className="pt-4 border-t border-border/50">
                  <h3 className="text-sm font-medium mb-3 text-muted-foreground">
                    {t("gridChargeHeading")}
                  </h3>
                  <div className="flex flex-col gap-4">
                    <EntitySelector
                      label={t("gridToBatteryPowerLabel")}
                      description={t("gridToBatteryPowerDescription")}
                      value={config.grid_to_battery_power}
                      onChange={(v) => updateField("grid_to_battery_power", v)}
                      entities={powerSensors}
                    />
                    <EntitySelector
                      label={t("gridToBatteryEnergyLabel")}
                      description={t("gridToBatteryEnergyDescription")}
                      value={config.grid_to_battery_energy}
                      onChange={(v) => updateField("grid_to_battery_energy", v)}
                      entities={energySensors}
                    />
                  </div>
                </div>
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* Grid Configuration */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <GlassCard>
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-destructive/10">
                  <Zap className="size-5 text-destructive" />
                </div>
                <h2 className="font-medium">{t("gridHeading")}</h2>
              </div>

              <div className="flex flex-col gap-4">
                <EntitySelector
                  label={t("gridPowerCombinedLabel")}
                  description={t("gridPowerCombinedDescription")}
                  value={config.grid_power}
                  onChange={(v) => updateField("grid_power", v)}
                  entities={powerSensors}
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <EntitySelector
                    label={t("gridImportPowerLabel")}
                    description={t("gridImportPowerDescription")}
                    value={config.grid_import_power}
                    onChange={(v) => updateField("grid_import_power", v)}
                    entities={powerSensors}
                  />
                  <EntitySelector
                    label={t("gridExportPowerLabel")}
                    description={t("gridExportPowerDescription")}
                    value={config.grid_export_power}
                    onChange={(v) => updateField("grid_export_power", v)}
                    entities={powerSensors}
                  />
                </div>

                <EntitySelector
                  label={t("gridImportLabel")}
                  description={t("gridImportDescription")}
                  value={config.grid_import}
                  onChange={(v) => updateField("grid_import", v)}
                  entities={energySensors}
                />

                <EntitySelector
                  label={t("gridExportLabel")}
                  description={t("gridExportDescription")}
                  value={config.grid_export}
                  onChange={(v) => updateField("grid_export", v)}
                  entities={energySensors}
                />
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* Home Consumption Configuration */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <GlassCard>
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-info/10">
                  <Home className="size-5 text-info" />
                </div>
                <div>
                  <h2 className="font-medium">{t("homeHeading")}</h2>
                  <p className="text-xs text-muted-foreground">{t("homeOptional")}</p>
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <EntitySelector
                  label={t("homeConsumptionLabel")}
                  description={t("homeConsumptionDescription")}
                  value={config.home_consumption}
                  onChange={(v) => updateField("home_consumption", v)}
                  entities={powerSensors}
                />
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* Cost Configuration */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <GlassCard>
            <div className="p-6">
              <h2 className="font-medium mb-4">{t("costsHeading")}</h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label>{t("costImportLabel")}</Label>
                  <div className="relative">
                    <Input
                      type="number"
                      step="0.01"
                      placeholder={t("costImportPlaceholder")}
                      value={config.cost_per_kwh_import || ""}
                      onChange={(e) => updateField("cost_per_kwh_import", parseFloat(e.target.value) || undefined)}
                      className="pr-16"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                      €/kWh
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <Label>{t("costExportLabel")}</Label>
                  <div className="relative">
                    <Input
                      type="number"
                      step="0.01"
                      placeholder={t("costExportPlaceholder")}
                      value={config.cost_per_kwh_export || ""}
                      onChange={(e) => updateField("cost_per_kwh_export", parseFloat(e.target.value) || undefined)}
                      className="pr-16"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                      €/kWh
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* Screensaver Display */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <GlassCard>
            <div className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-purple-500/10">
                    <Monitor className="size-5 text-purple-500" />
                  </div>
                  <div>
                    <Label className="font-medium">{t("screensaverLabel")}</Label>
                    <p className="text-xs text-muted-foreground">
                      {t("screensaverDescription")}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={config.show_on_screensaver ?? false}
                  onCheckedChange={(v) => updateField("show_on_screensaver", v)}
                />
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* Chart Configuration */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
        >
          <GlassCard>
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-cyan-500/10">
                  <LineChart className="size-5 text-cyan-500" />
                </div>
                <div>
                  <h2 className="font-medium">{t("chartHeading")}</h2>
                  <p className="text-xs text-muted-foreground">
                    {t("chartHeadingDescription")}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-6">
                {/* Power Chart (Watts) */}
                <ChartEntityEditor
                  label={t("powerChartLabel")}
                  description={t("powerChartDescription")}
                  entities={config.power_chart_entities || []}
                  availableEntities={powerSensors}
                  onChange={(entities) => setConfig(prev => ({ ...prev, power_chart_entities: entities.length > 0 ? entities : undefined }))}
                />

                {/* Energy Chart (kWh) */}
                <ChartEntityEditor
                  label={t("energyChartLabel")}
                  description={t("energyChartDescription")}
                  entities={config.energy_chart_entities || []}
                  availableEntities={energySensors}
                  onChange={(entities) => setConfig(prev => ({ ...prev, energy_chart_entities: entities.length > 0 ? entities : undefined }))}
                />
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
