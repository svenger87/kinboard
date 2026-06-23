"use client";

import { useState, useMemo } from "react";
import {
  Search,
  Loader2,
  Plus,
  Check,
  Thermometer,
  Lightbulb,
  Power,
  Fan,
  Wind,
  Tv,
  Sun,
  Zap,
  Droplets,
  Gauge,
  Home,
  Video,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTranslations } from "next-intl";
import { useHomeAssistantEntities, useAddDashboardCard } from "@/hooks";
import type { HAEntity, DashboardCard } from "@/types/home-assistant";

type DomainLabelKey =
  | "sensor" | "binary_sensor" | "switch" | "input_boolean" | "light" | "vacuum"
  | "climate" | "cover" | "fan" | "media_player" | "camera" | "lock"
  | "alarm_control_panel" | "water_heater" | "humidifier" | "scene" | "script"
  | "automation" | "person" | "device_tracker" | "weather";

const DOMAIN_LABEL_KEYS: readonly string[] = [
  "sensor", "binary_sensor", "switch", "input_boolean", "light", "vacuum",
  "climate", "cover", "fan", "media_player", "camera", "lock",
  "alarm_control_panel", "water_heater", "humidifier", "scene", "script",
  "automation", "person", "device_tracker", "weather",
];

interface EntityBrowserProps {
  onClose: () => void;
  existingEntityIds: string[];
  onAddEntity?: (entity: HAEntity) => Promise<void>;
}

// Get icon for entity based on domain and device class
function getEntityIcon(entity: HAEntity) {
  const domain = entity.domain;
  const deviceClass = entity.attributes.device_class;

  // Sensor device classes
  if (domain === "sensor") {
    switch (deviceClass) {
      case "temperature":
        return <Thermometer className="size-4" />;
      case "humidity":
        return <Droplets className="size-4" />;
      case "power":
      case "energy":
        return <Zap className="size-4" />;
      case "illuminance":
        return <Sun className="size-4" />;
      case "pressure":
        return <Gauge className="size-4" />;
      default:
        return <Gauge className="size-4" />;
    }
  }

  // Domain icons
  switch (domain) {
    case "light":
      return <Lightbulb className="size-4" />;
    case "switch":
      return <Power className="size-4" />;
    case "vacuum":
      return <Fan className="size-4" />;
    case "climate":
      return <Wind className="size-4" />;
    case "media_player":
      return <Tv className="size-4" />;
    case "fan":
      return <Fan className="size-4" />;
    case "camera":
      return <Video className="size-4" />;
    default:
      return <Home className="size-4" />;
  }
}

// Determine card type based on domain
function getCardType(domain: string): DashboardCard["card_type"] {
  switch (domain) {
    case "light":
      return "light";
    case "switch":
    case "input_boolean":
      return "switch";
    case "vacuum":
      return "vacuum";
    case "climate":
      return "climate";
    case "cover":
      return "cover";
    case "fan":
      return "fan";
    case "media_player":
      return "media_player";
    case "lock":
      return "lock";
    case "alarm_control_panel":
      return "alarm_control_panel";
    case "person":
    case "device_tracker":
      return "person";
    case "weather":
      return "weather";
    case "scene":
      return "scene";
    case "script":
      return "script";
    case "automation":
      return "automation";
    case "sensor":
    case "binary_sensor":
      return "sensor";
    case "camera":
      return "camera";
    default:
      return "generic";
  }
}

// Filter tabs (label resolved per-locale at render via t())
const FILTER_TABS = [
  { value: "all", labelKey: "filterAll" },
  { value: "sensor", labelKey: "filterSensor" },
  { value: "switch", labelKey: "filterSwitch" },
  { value: "light", labelKey: "filterLight" },
  { value: "climate", labelKey: "filterClimate" },
  { value: "cover", labelKey: "filterCover" },
  { value: "media_player", labelKey: "filterMediaPlayer" },
  { value: "camera", labelKey: "filterCamera" },
  { value: "automation", labelKey: "filterAutomation" },
] as const;

export function EntityBrowser({ onClose, existingEntityIds, onAddEntity }: EntityBrowserProps) {
  const t = useTranslations("homeAutomation.entityBrowser");
  const tDomain = useTranslations("homeAutomation.domainLabels");
  const tCommon = useTranslations("common");
  const [search, setSearch] = useState("");
  const [selectedDomain, setSelectedDomain] = useState("all");
  const [selectedEntities, setSelectedEntities] = useState<Set<string>>(new Set());
  const [addingIds, setAddingIds] = useState<Set<string>>(new Set());

  const { data: entities = [], isLoading } = useHomeAssistantEntities(
    selectedDomain === "all" ? undefined : selectedDomain,
    true
  );
  // Only use legacy hook if no custom callback provided
  const addCard = useAddDashboardCard();

  // Filter entities
  const filteredEntities = useMemo(() => {
    let filtered = entities;

    // Filter out already added entities
    filtered = filtered.filter((e) => !existingEntityIds.includes(e.entity_id));

    // Search filter
    if (search) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.name.toLowerCase().includes(searchLower) ||
          e.entity_id.toLowerCase().includes(searchLower)
      );
    }

    // If "all" is selected, filter to common domains
    if (selectedDomain === "all") {
      const commonDomains = [
        "sensor", "binary_sensor", "switch", "input_boolean",
        "light", "vacuum", "climate", "fan", "cover",
        "media_player", "lock", "person", "device_tracker",
        "weather", "scene", "script", "automation", "alarm_control_panel",
        "camera"
      ];
      filtered = filtered.filter((e) => commonDomains.includes(e.domain));
    }

    return filtered;
  }, [entities, search, selectedDomain, existingEntityIds]);

  // Group by domain for display
  const groupedEntities = useMemo(() => {
    const groups: Record<string, HAEntity[]> = {};
    filteredEntities.forEach((entity) => {
      if (!groups[entity.domain]) {
        groups[entity.domain] = [];
      }
      groups[entity.domain].push(entity);
    });
    return groups;
  }, [filteredEntities]);

  const handleToggleSelect = (entityId: string) => {
    setSelectedEntities((prev) => {
      const next = new Set(prev);
      if (next.has(entityId)) {
        next.delete(entityId);
      } else {
        next.add(entityId);
      }
      return next;
    });
  };

  const handleAddSingle = async (entity: HAEntity) => {
    setAddingIds((prev) => new Set(prev).add(entity.entity_id));
    try {
      // Use custom callback if provided (for specific dashboard), otherwise use legacy hook
      if (onAddEntity) {
        await onAddEntity(entity);
      } else {
        await addCard.mutateAsync({
          entity_id: entity.entity_id,
          display_name: entity.name,
          card_type: getCardType(entity.domain),
          size: "medium",
        });
      }
    } finally {
      setAddingIds((prev) => {
        const next = new Set(prev);
        next.delete(entity.entity_id);
        return next;
      });
    }
  };

  const handleAddSelected = async () => {
    const entitiesToAdd = filteredEntities.filter((e) => selectedEntities.has(e.entity_id));
    for (const entity of entitiesToAdd) {
      await handleAddSingle(entity);
    }
    setSelectedEntities(new Set());
    onClose();
  };

  return (
    <div className="flex flex-col" style={{ height: "60vh" }}>
      {/* Search */}
      <div className="relative mb-4 shrink-0">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder={t("searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Domain Filter */}
      <Tabs value={selectedDomain} onValueChange={setSelectedDomain} className="mb-4 shrink-0">
        <TabsList className="w-full justify-start overflow-x-auto">
          {FILTER_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="text-xs">
              {t(tab.labelKey)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Entity List */}
      <ScrollArea className="flex-1 min-h-0 -mx-6 px-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">{t("loading")}</span>
          </div>
        ) : filteredEntities.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>{t("noResults")}</p>
            {search && (
              <p className="text-sm">{t("searchHint")}</p>
            )}
          </div>
        ) : selectedDomain === "all" ? (
          // Grouped view
          <div className="flex flex-col gap-4">
            {Object.entries(groupedEntities).map(([domain, domainEntities]) => (
              <div key={domain}>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">
                  {t("domainHeading", {
                    label: DOMAIN_LABEL_KEYS.includes(domain) ? tDomain(domain as DomainLabelKey) : domain,
                    count: domainEntities.length,
                  })}
                </h3>
                <div className="flex flex-col gap-1">
                  {domainEntities.map((entity) => (
                    <EntityRow
                      key={entity.entity_id}
                      entity={entity}
                      isSelected={selectedEntities.has(entity.entity_id)}
                      isAdding={addingIds.has(entity.entity_id)}
                      onToggle={() => handleToggleSelect(entity.entity_id)}
                      onAdd={() => handleAddSingle(entity)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          // Flat view for specific domain
          <div className="flex flex-col gap-1">
            {filteredEntities.map((entity) => (
              <EntityRow
                key={entity.entity_id}
                entity={entity}
                isSelected={selectedEntities.has(entity.entity_id)}
                isAdding={addingIds.has(entity.entity_id)}
                onToggle={() => handleToggleSelect(entity.entity_id)}
                onAdd={() => handleAddSingle(entity)}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Footer Actions */}
      <div className="flex items-center justify-between pt-4 mt-4 border-t shrink-0">
        <div className="text-sm text-muted-foreground">
          {selectedEntities.size > 0 && (
            <span>{t("selectedCount", { count: selectedEntities.size })}</span>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            {tCommon("cancel")}
          </Button>
          {selectedEntities.size > 0 && (
            <Button onClick={handleAddSelected} disabled={addCard.isPending}>
              {addCard.isPending ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Plus className="size-4 mr-2" />
              )}
              {t("addCount", { count: selectedEntities.size })}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// Entity row component
interface EntityRowProps {
  entity: HAEntity;
  isSelected: boolean;
  isAdding: boolean;
  onToggle: () => void;
  onAdd: () => void;
}

function EntityRow({ entity, isSelected, isAdding, onToggle, onAdd }: EntityRowProps) {
  return (
    <div
      className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${
        isSelected ? "bg-primary/10 border-primary" : "hover:bg-accent"
      }`}
      onClick={onToggle}
    >
      <div
        className={`size-5 rounded border flex items-center justify-center ${
          isSelected ? "bg-primary border-primary" : "border-input"
        }`}
      >
        {isSelected && <Check className="size-3 text-primary-foreground" />}
      </div>

      <div className="p-1.5 rounded bg-muted">
        {getEntityIcon(entity)}
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{entity.name}</p>
        <p className="text-xs text-muted-foreground truncate">{entity.entity_id}</p>
      </div>

      <Badge variant="outline" className="text-xs shrink-0">
        {entity.state}
        {entity.attributes.unit_of_measurement && ` ${entity.attributes.unit_of_measurement}`}
      </Badge>

      <Button
        variant="ghost"
        size="sm"
        className="shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          onAdd();
        }}
        disabled={isAdding}
      >
        {isAdding ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Plus className="size-4" />
        )}
      </Button>
    </div>
  );
}
