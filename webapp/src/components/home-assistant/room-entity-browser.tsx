"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Lightbulb,
  Power,
  Thermometer,
  DoorOpen,
  Check,
  Home,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import { useTranslations } from "next-intl";
import {
  useHomeAssistantEntities,
  useHomeAssistantStatus,
  useEntityRoom,
} from "@/hooks";
import type { HAEntity, RoomEntityType } from "@/types/home-assistant";

interface RoomEntityBrowserProps {
  onSelect: (entityIds: string[]) => void;
  onCancel: () => void;
  excludeEntityIds?: string[];
  multiSelect?: boolean;
}

// Supported entity types for rooms
const SUPPORTED_TYPES: RoomEntityType[] = [
  "light",
  "switch",
  "input_boolean",
  "sensor",
  "binary_sensor",
];

// Type filter tabs (label resolved per-locale at render via t())
const TYPE_FILTERS: { value: string; labelKey: "filterAll" | "filterLights" | "filterSwitches" | "filterSensors" | "filterBinary"; icon: typeof Lightbulb }[] = [
  { value: "all", labelKey: "filterAll", icon: Home },
  { value: "light", labelKey: "filterLights", icon: Lightbulb },
  { value: "switch", labelKey: "filterSwitches", icon: Power },
  { value: "sensor", labelKey: "filterSensors", icon: Thermometer },
  { value: "binary_sensor", labelKey: "filterBinary", icon: DoorOpen },
];

// Entity row component
function EntityRow({
  entity,
  isSelected,
  isAssigned,
  assignedRoomName,
  onToggle,
}: {
  entity: HAEntity;
  isSelected: boolean;
  isAssigned: boolean;
  assignedRoomName?: string;
  onToggle: () => void;
}) {
  const t = useTranslations("homeAutomation.roomEntityBrowser");
  const getIcon = () => {
    switch (entity.domain) {
      case "light":
        return <Lightbulb className="size-4" />;
      case "switch":
      case "input_boolean":
        return <Power className="size-4" />;
      case "sensor":
        return <Thermometer className="size-4" />;
      case "binary_sensor":
        return <DoorOpen className="size-4" />;
      default:
        return <Home className="size-4" />;
    }
  };

  return (
    <button
      onClick={onToggle}
      disabled={isAssigned}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-left ${
        isSelected
          ? "bg-primary/20 border border-primary/50"
          : isAssigned
          ? "bg-muted/50 opacity-50 cursor-not-allowed"
          : "hover:bg-accent"
      }`}
    >
      {/* Selection indicator */}
      <div
        className={`size-5 rounded border-2 flex items-center justify-center shrink-0 ${
          isSelected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-muted-foreground/30"
        }`}
      >
        {isSelected && <Check className="size-3" />}
      </div>

      {/* Icon */}
      <div className="p-1.5 rounded bg-muted text-muted-foreground">
        {getIcon()}
      </div>

      {/* Name and entity ID */}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{entity.name}</p>
        <p className="text-xs text-muted-foreground truncate">
          {entity.entity_id}
        </p>
      </div>

      {/* Current state / assigned badge */}
      {isAssigned ? (
        <Badge variant="outline" className="shrink-0 text-xs">
          {assignedRoomName || t("assignedFallback")}
        </Badge>
      ) : (
        <Badge
          variant="outline"
          className={`shrink-0 text-xs ${
            entity.state === "on"
              ? "border-state-on/50 text-state-on"
              : entity.state === "off"
              ? "border-muted-foreground/30"
              : ""
          }`}
        >
          {entity.state}
        </Badge>
      )}
    </button>
  );
}

export function RoomEntityBrowser({
  onSelect,
  onCancel,
  excludeEntityIds = [],
  multiSelect = true,
}: RoomEntityBrowserProps) {
  const t = useTranslations("homeAutomation.roomEntityBrowser");
  const tCommon = useTranslations("common");
  const { data: haStatus } = useHomeAssistantStatus();
  const isConnected = !!haStatus?.url;

  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedEntityIds, setSelectedEntityIds] = useState<Set<string>>(
    new Set()
  );

  // Fetch all entities
  const { data: allEntities = [], isLoading } = useHomeAssistantEntities(
    undefined, // No domain filter - we'll filter client-side
    isConnected
  );

  // Filter to supported types only
  const supportedEntities = useMemo(() => {
    return allEntities.filter((entity) =>
      SUPPORTED_TYPES.includes(entity.domain as RoomEntityType)
    );
  }, [allEntities]);

  // Apply search and type filter
  const filteredEntities = useMemo(() => {
    let result = supportedEntities;

    // Type filter
    if (typeFilter !== "all") {
      result = result.filter((entity) => entity.domain === typeFilter);
    }

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (entity) =>
          entity.name.toLowerCase().includes(query) ||
          entity.entity_id.toLowerCase().includes(query)
      );
    }

    // Sort by domain, then by name
    return result.sort((a, b) => {
      if (a.domain !== b.domain) {
        return SUPPORTED_TYPES.indexOf(a.domain as RoomEntityType) -
          SUPPORTED_TYPES.indexOf(b.domain as RoomEntityType);
      }
      return a.name.localeCompare(b.name);
    });
  }, [supportedEntities, typeFilter, searchQuery]);

  // Get assigned room for each entity (for UI display)
  // This is done per-entity in the render for now

  const handleToggle = (entityId: string) => {
    if (!multiSelect) {
      // Single select - immediately confirm
      onSelect([entityId]);
      return;
    }

    // Multi-select - toggle selection
    setSelectedEntityIds((prev) => {
      const next = new Set(prev);
      if (next.has(entityId)) {
        next.delete(entityId);
      } else {
        next.add(entityId);
      }
      return next;
    });
  };

  const handleConfirm = () => {
    onSelect(Array.from(selectedEntityIds));
  };

  const handleSelectAll = () => {
    const newSelected = new Set<string>();
    filteredEntities.forEach((entity) => {
      if (!excludeEntityIds.includes(entity.entity_id)) {
        newSelected.add(entity.entity_id);
      }
    });
    setSelectedEntityIds(newSelected);
  };

  const handleDeselectAll = () => {
    setSelectedEntityIds(new Set());
  };

  return (
    // min-w-0 as well as the shared fix in DialogContent: this column holds
    // two scroll containers, and neither can scroll while the column is
    // sized by its own content.
    <div className="flex flex-col h-full max-h-[70vh] min-w-0">
      {/* Header.

          No close button of its own: DialogContent already renders one in this
          exact corner, so there were two Xs sitting on top of each other. The
          padding keeps a long title clear of it. */}
      <div className="flex items-center justify-between p-4 pr-14 border-b">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
      </div>

      {/* Search */}
      <div className="p-4 border-b">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder={t("searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Type filter tabs.

          They wrap rather than scroll: five German labels do not fit a phone in
          one row, and the fifth ("Binär") ended up off the edge with nothing to
          suggest it was there. A second row costs 40px and shows all of them. */}
      <div className="px-4 py-2 border-b">
        <SegmentedControl
          value={typeFilter}
          onValueChange={setTypeFilter}
          className="h-auto w-full flex-wrap justify-start gap-1"
        >
          {TYPE_FILTERS.map((filter) => (
            <SegmentedControlItem
              key={filter.value}
              value={filter.value}
              className="flex items-center gap-1.5"
            >
              <filter.icon className="size-3.5" />
              {t(filter.labelKey)}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      </div>

      {/* Selection actions */}
      {multiSelect && (
        <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
          <span className="text-sm text-muted-foreground">
            {t("selectedCount", { count: selectedEntityIds.size })}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={handleSelectAll}>
              {t("selectAllButton")}
            </Button>
            {selectedEntityIds.size > 0 && (
              <Button variant="ghost" size="sm" onClick={handleDeselectAll}>
                {t("deselectAllButton")}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Entity list */}
      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            {t("loading")}
          </div>
        ) : filteredEntities.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            {t("noResults")}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <AnimatePresence mode="popLayout">
              {filteredEntities.map((entity) => {
                const isAssigned = excludeEntityIds.includes(entity.entity_id);
                const isSelected = selectedEntityIds.has(entity.entity_id);

                return (
                  <motion.div
                    key={entity.entity_id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                  >
                    <EntityRow
                      entity={entity}
                      isSelected={isSelected}
                      isAssigned={isAssigned}
                      onToggle={() => handleToggle(entity.entity_id)}
                    />
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Footer with confirm button */}
      {multiSelect && (
        <div className="p-4 border-t bg-background">
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onCancel}>
              {tCommon("cancel")}
            </Button>
            <Button
              variant="default"
              className="flex-1"
              onClick={handleConfirm}
              disabled={selectedEntityIds.size === 0}
            >
              {t("addCount", { count: selectedEntityIds.size })}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
