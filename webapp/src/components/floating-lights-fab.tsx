"use client";

import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  Lightbulb,
  Loader2,
  PowerOff,
  Home,
  BedDouble,
  Sofa,
  Utensils,
  Bath,
  Car,
  TreeDeciduous,
  Briefcase,
  Baby,
  Tv,
  DoorOpen,
  Warehouse,
  Lamp,
  Armchair,
  WashingMachine,
  Coffee,
  Book,
  LayoutGrid,
  Settings,
  Power,
  Thermometer,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  useHomeAssistantStatus,
  useDashboards,
  useHomeAssistantEntityStates,
  useLightControl,
  useCallService,
} from "@/hooks";
import { useRooms } from "@/hooks/use-rooms-table";
import { useCatalogue } from "@/hooks/use-catalogue";
import { LightControlItem } from "./light-control-item";
import { SwitchControlItem } from "./switch-control-item";
import { SensorDisplayItem } from "./sensor-display-item";
import { BinarySensorDisplayItem } from "./binary-sensor-display-item";
import type { DashboardCard, HAEntity, RoomEntity, RoomIcon } from "@/types/home-assistant";
import type { Room, CatalogueItem } from "@/types/database";

/** A catalogue row known to have an entity — the shape every domain group
 * below actually needs, narrowed once instead of asserted at each use. */
type CatalogueItemWithEntity = CatalogueItem & { entity_id: string };

// Icon map for room icons
const ICON_MAP: Record<RoomIcon, typeof Home> = {
  home: Home,
  "bed-double": BedDouble,
  sofa: Sofa,
  utensils: Utensils,
  bath: Bath,
  car: Car,
  tree: TreeDeciduous,
  briefcase: Briefcase,
  baby: Baby,
  tv: Tv,
  "door-open": DoorOpen,
  warehouse: Warehouse,
  lamp: Lamp,
  armchair: Armchair,
  "washing-machine": WashingMachine,
  coffee: Coffee,
  book: Book,
};

/** A room's icon, tolerant of a null or unrecognised value from the row —
 * mirrors `iconFor` in the rooms settings page, which owns the same table. */
function iconFor(icon: string | null): typeof Home {
  return (icon && ICON_MAP[icon as RoomIcon]) || Home;
}

// Room tab component
const RoomTab = React.memo(function RoomTab({
  room,
  isActive,
  onClick,
  lightsOn,
}: {
  room: Room | { id: "all"; name: string; icon: RoomIcon };
  isActive: boolean;
  onClick: () => void;
  lightsOn: number;
}) {
  const Icon = iconFor(room.icon);

  return (
    <button
      onClick={onClick}
      className={`shrink-0 flex flex-col items-center gap-1 px-4 py-2 rounded-xl transition-all ${
        isActive
          ? "bg-primary text-primary-foreground"
          : "bg-muted/50 hover:bg-muted text-muted-foreground"
      }`}
    >
      <div className="relative">
        <Icon className="size-5" />
        {lightsOn > 0 && (
          <span className="absolute -top-1 -right-1 size-2 bg-state-light rounded-full" />
        )}
      </div>
      <span className="text-xs font-medium truncate max-w-[60px]">{room.name}</span>
    </button>
  );
});

// Room content section showing entities by type. `items` is the catalogue's
// membership for this room (RFC-007 §4) — the FAB no longer owns any
// membership list of its own.
const RoomContent = React.memo(function RoomContent({
  items,
  entityMap,
  isLoading,
  onAllOff,
  isAllOffPending,
}: {
  items: CatalogueItem[];
  entityMap: Map<string, HAEntity>;
  isLoading: boolean;
  onAllOff: (entityIds: string[]) => void;
  isAllOffPending: boolean;
}) {
  const t = useTranslations("homeAutomation.fab");

  // Membership is every catalogue item assigned to this room that has an
  // entity to control — independent of whether a state for it came back,
  // so a room with devices HA hasn't reported on yet still counts as
  // non-empty rather than showing the "no devices" prompt.
  const memberItems = useMemo(
    () => items.filter((item): item is CatalogueItemWithEntity => !!item.entity_id),
    [items]
  );

  // Group entities by domain in a single pass
  const { lights, switches, sensors, binarySensors, lightEntityIds, lightsOn, switchesOn } =
    useMemo(() => {
      const l: Array<{ item: CatalogueItemWithEntity; entity: HAEntity }> = [];
      const sw: typeof l = [];
      const se: typeof l = [];
      const bs: typeof l = [];
      const onIds: string[] = [];
      let lOn = 0;
      let swOn = 0;
      for (const item of memberItems) {
        const entity = entityMap.get(item.entity_id);
        if (!entity) continue;
        const domain = entity.domain;
        if (domain === "light") {
          l.push({ item, entity });
          if (entity.state === "on") {
            onIds.push(item.entity_id);
            lOn++;
          }
        } else if (domain === "switch" || domain === "input_boolean") {
          sw.push({ item, entity });
          if (entity.state === "on") swOn++;
        } else if (domain === "sensor") {
          se.push({ item, entity });
        } else if (domain === "binary_sensor") {
          bs.push({ item, entity });
        }
      }
      return {
        lights: l,
        switches: sw,
        sensors: se,
        binarySensors: bs,
        lightEntityIds: onIds,
        lightsOn: lOn,
        switchesOn: swOn,
      };
    }, [memberItems, entityMap]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  if (memberItems.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <LayoutGrid className="size-12 mx-auto mb-4 opacity-30" />
        <p>{t("emptyRoomTitle")}</p>
        <p className="text-sm mt-2">
          {t("emptyRoomDescription")}
        </p>
        <Link href="/settings/homeassistant/rooms">
          <Button variant="outline" size="sm" className="mt-4">
            <Settings className="size-4 mr-2" />
            {t("manageRoomsAction")}
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-4">
      {/* Lights Section */}
      {lights.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Lightbulb className="size-4" />
              <span>{t("sectionLights")}</span>
              {lightsOn > 0 && (
                <Badge variant="outline" className="text-xs">
                  {t("countOn", { count: lightsOn })}
                </Badge>
              )}
            </div>
            {lightsOn > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAllOff(lightEntityIds)}
                disabled={isAllOffPending}
                className="h-7 text-xs"
              >
                {isAllOffPending ? (
                  <Loader2 className="size-3 mr-1 animate-spin" />
                ) : (
                  <PowerOff className="size-3 mr-1" />
                )}
                {t("allOff")}
              </Button>
            )}
          </div>
          <div className="flex flex-col gap-2">
            {lights.map(({ item, entity }) => {
              // Create a fake DashboardCard for compatibility
              const card: DashboardCard = {
                id: item.id,
                entity_id: item.entity_id,
                display_name: item.name,
                card_type: "light",
                position: item.position,
                size: "medium",
              };
              return <LightControlItem key={item.entity_id} card={card} entity={entity} />;
            })}
          </div>
        </div>
      )}

      {/* Switches Section */}
      {switches.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2 text-sm font-medium text-muted-foreground">
            <Power className="size-4" />
            <span>{t("sectionSwitches")}</span>
            {switchesOn > 0 && (
              <Badge variant="outline" className="text-xs">
                {t("countOn", { count: switchesOn })}
              </Badge>
            )}
          </div>
          <div className="flex flex-col gap-2">
            {switches.map(({ item, entity }) => {
              const roomEntity: RoomEntity = {
                entity_id: item.entity_id,
                display_name: item.name,
                position: item.position,
              };
              return (
                <SwitchControlItem key={item.entity_id} roomEntity={roomEntity} entity={entity} />
              );
            })}
          </div>
        </div>
      )}

      {/* Sensors Section */}
      {sensors.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2 text-sm font-medium text-muted-foreground">
            <Thermometer className="size-4" />
            <span>{t("sectionSensors")}</span>
          </div>
          <div className="flex flex-col gap-2">
            {sensors.map(({ item, entity }) => {
              const roomEntity: RoomEntity = {
                entity_id: item.entity_id,
                display_name: item.name,
                position: item.position,
              };
              return (
                <SensorDisplayItem key={item.entity_id} roomEntity={roomEntity} entity={entity} />
              );
            })}
          </div>
        </div>
      )}

      {/* Binary Sensors Section */}
      {binarySensors.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2 text-sm font-medium text-muted-foreground">
            <DoorOpen className="size-4" />
            <span>{t("sectionStatus")}</span>
          </div>
          <div className="flex flex-col gap-2">
            {binarySensors.map(({ item, entity }) => {
              const roomEntity: RoomEntity = {
                entity_id: item.entity_id,
                display_name: item.name,
                position: item.position,
              };
              return (
                <BinarySensorDisplayItem
                  key={item.entity_id}
                  roomEntity={roomEntity}
                  entity={entity}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});

// Legacy content for when no rooms are configured (shows dashboard lights)
function LegacyLightContent({
  lightCards,
  entityMap,
  onAllOff,
  isPending,
  lightsOnCount,
}: {
  lightCards: DashboardCard[];
  entityMap: Map<string, HAEntity>;
  onAllOff: () => void;
  isPending: boolean;
  lightsOnCount: number;
}) {
  const t = useTranslations("homeAutomation.fab");
  return (
    <div className="flex flex-col gap-3 pb-4">
      {lightsOnCount > 0 && (
        <div className="flex justify-end mb-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onAllOff}
            disabled={isPending}
            className="gap-2"
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <PowerOff className="size-4" />
            )}
            {t("allOff")}
          </Button>
        </div>
      )}
      {lightCards.map((card) => {
        const entity = entityMap.get(card.entity_id);
        if (!entity) return null;
        return <LightControlItem key={card.id} card={card} entity={entity} />;
      })}
    </div>
  );
}

export function FloatingLightsFab() {
  const t = useTranslations("homeAutomation.fab");
  const tHA = useTranslations("homeAutomation");
  const [isOpen, setIsOpen] = useState(false);
  const [activeRoomId, setActiveRoomId] = useState<string>("all");

  // Check if HA is configured
  const { data: haStatus } = useHomeAssistantStatus();
  const isConnected = !!haStatus?.url;

  // Rooms, from the table — not the settings blob (RFC-007 §4).
  const { data: rooms, isLoading: isRoomsLoading } = useRooms();
  const hasRooms = rooms.length > 0;

  // Membership, from the catalogue's room_id — not a list the FAB owns.
  // Only `room_id` counts here: the legacy free-text `room` column a device
  // may carry from the devices screen is not membership until a later task
  // teaches that screen to write `room_id` too.
  const { data: catalogueItems, isLoading: isCatalogueLoading } = useCatalogue();
  const itemsByRoomId = useMemo(() => {
    const map = new Map<string, CatalogueItem[]>();
    for (const item of catalogueItems) {
      if (!item.entity_id || !item.room_id) continue;
      const list = map.get(item.room_id);
      if (list) list.push(item);
      else map.set(item.room_id, [item]);
    }
    return map;
  }, [catalogueItems]);

  // Get all dashboards (for legacy fallback)
  const { data: dashboards = [] } = useDashboards();

  // Extract light cards from all dashboards (legacy)
  const lightCards = useMemo(() => {
    const cards: DashboardCard[] = [];
    for (const dashboard of dashboards) {
      if (dashboard.cards) {
        for (const card of dashboard.cards) {
          if (card.card_type === "light") {
            cards.push(card);
          }
        }
      }
    }
    return cards;
  }, [dashboards]);

  // Get all room entity IDs for state fetching
  const allRoomEntityIds = useMemo(() => {
    const ids = new Set<string>();
    for (const list of itemsByRoomId.values()) {
      for (const item of list) ids.add(item.entity_id!);
    }
    return Array.from(ids);
  }, [itemsByRoomId]);

  // Combine entity IDs (rooms + dashboard lights)
  const allEntityIds = useMemo(() => {
    const ids = new Set(allRoomEntityIds);
    lightCards.forEach((card) => ids.add(card.entity_id));
    return Array.from(ids);
  }, [allRoomEntityIds, lightCards]);

  // Fetch entity states for all entities
  const { data: entityStates = [], isLoading: isStatesLoading } = useHomeAssistantEntityStates(
    allEntityIds,
    isConnected && allEntityIds.length > 0
  );
  const isLoading = isRoomsLoading || isCatalogueLoading || isStatesLoading;

  // Create entity map
  const entityMap = useMemo(() => {
    const map = new Map<string, HAEntity>();
    for (const entity of entityStates) {
      map.set(entity.entity_id, entity);
    }
    return map;
  }, [entityStates]);

  // Count lights on across all rooms
  const totalLightsOn = useMemo(() => {
    return entityStates.filter(
      (e) => e.domain === "light" && e.state === "on"
    ).length;
  }, [entityStates]);

  // Light control
  const { turnOff, isPending } = useLightControl();

  // Handle turning off multiple lights
  const handleAllOff = async (entityIds?: string[]) => {
    const lightsToTurnOff = entityIds
      ? entityIds
      : entityStates.filter((e) => e.domain === "light" && e.state === "on").map((e) => e.entity_id);

    for (const id of lightsToTurnOff) {
      await turnOff(id);
    }
  };

  // Count lights on per room
  const roomLightsOnCount = useMemo(() => {
    const counts: Record<string, number> = { all: totalLightsOn };
    for (const room of rooms) {
      const items = itemsByRoomId.get(room.id) ?? [];
      counts[room.id] = items
        .map((item) => entityMap.get(item.entity_id!))
        .filter((e) => e?.domain === "light" && e?.state === "on").length;
    }
    return counts;
  }, [rooms, itemsByRoomId, entityMap, totalLightsOn]);

  // Don't render if HA not connected or no lights/rooms configured
  if (!isConnected || (lightCards.length === 0 && !hasRooms)) {
    return null;
  }

  return (
    <>
      {/* A fixed button floats over whatever happens to be beneath it, and on a
          390px phone that is the weather widget's wind speed and humidity —
          60% and 40% of those readings covered at the top of the dashboard
          (audit KB-72). No layout change can fix that while the button is
          fixed: the content underneath changes as you scroll. So on phones it
          stops floating and takes a tile in the widget grid, where it occupies
          real space and can cover nothing. From `sm` up there is room for it
          to float without landing on anything — the occlusion sweep found no
          overlap at any wall or desktop viewport — so it stays a FAB there.
          One component, two triggers, one sheet. */}
      <button
        onClick={() => setIsOpen(true)}
        className="hidden sm:block fixed right-4 z-50 p-4 rounded-full bg-primary text-primary-foreground elev-md shadow-[0_0_20px_hsl(var(--primary)/0.3)] hover:elev-lg transition-all hover:scale-105 active:scale-95 fab-above-nav"
        aria-label={t("fabAria")}
        aria-expanded={isOpen}
        aria-controls="lights-control-panel"
      >
        <div className="relative">
          <Lightbulb className="size-6" />
          {totalLightsOn > 0 && (
            <span className="absolute -top-1 -right-1 size-3 bg-state-light rounded-full border-2 border-primary" />
          )}
        </div>
      </button>

      <button
        onClick={() => setIsOpen(true)}
        className="sm:hidden flex min-h-[56px] w-full items-center gap-3 rounded-2xl border border-border bg-card p-4 text-left elev-sm transition-colors hover:bg-accent active:scale-[0.99]"
        aria-label={t("fabAria")}
        aria-expanded={isOpen}
        aria-controls="lights-control-panel"
      >
        <span className="relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Lightbulb className="size-5" />
          {totalLightsOn > 0 && (
            <span className="absolute -top-0.5 -right-0.5 size-3 rounded-full border-2 border-primary bg-state-light" />
          )}
        </span>
        <span className="min-w-0 font-medium">{t("fabAria")}</span>
      </button>

      {/* Bottom Sheet */}
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent side="bottom" className="h-[80vh] rounded-t-xl p-0" id="lights-control-panel">
          <div className="flex flex-col h-full">
            {/* Header */}
            <SheetHeader className="flex flex-row items-center justify-between p-4 pr-12 border-b shrink-0">
              <SheetTitle className="flex items-center gap-2">
                <Lightbulb className="size-5" />
                {t("sheetTitle")}
                {totalLightsOn > 0 && (
                  <Badge variant="outline" className="ml-2">
                    {t("lightsOnBadge", { count: totalLightsOn })}
                  </Badge>
                )}
              </SheetTitle>
              <Link href="/settings/homeassistant/rooms">
                <Button variant="ghost" size="icon" aria-label={tHA("settingsAria")}>
                  <Settings className="size-4" />
                </Button>
              </Link>
            </SheetHeader>

            {/* Room Tabs */}
            {hasRooms && (
              <div className="shrink-0 border-b">
                <ScrollArea className="w-full">
                  <div className="flex gap-2 p-4">
                    {/* "All" tab */}
                    <RoomTab
                      room={{ id: "all", name: t("allRoomsTab"), icon: "home" }}
                      isActive={activeRoomId === "all"}
                      onClick={() => setActiveRoomId("all")}
                      lightsOn={roomLightsOnCount["all"] || 0}
                    />

                    {/* Room tabs */}
                    {rooms.map((room) => (
                      <RoomTab
                        key={room.id}
                        room={room}
                        isActive={activeRoomId === room.id}
                        onClick={() => setActiveRoomId(room.id)}
                        lightsOn={roomLightsOnCount[room.id] || 0}
                      />
                    ))}
                  </div>
                  <ScrollBar orientation="horizontal" />
                </ScrollArea>
              </div>
            )}

            {/* Content */}
            <ScrollArea className="flex-1 px-4">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-muted-foreground">{t("loading")}</span>
                </div>
              ) : hasRooms ? (
                <div className="py-4">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={activeRoomId}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ duration: 0.15 }}
                    >
                      {activeRoomId === "all" ? (
                        // Show all rooms content
                        <div className="flex flex-col gap-6">
                          {rooms.map((room) => {
                            const Icon = iconFor(room.icon);
                            return (
                              <div key={room.id}>
                                <div
                                  className="flex items-center gap-2 mb-3 pb-2 border-b"
                                  style={{ borderColor: room.color ? `${room.color}30` : undefined }}
                                >
                                  <div
                                    className="p-1.5 rounded"
                                    style={{
                                      backgroundColor: room.color ? `${room.color}20` : undefined,
                                      color: room.color ?? undefined,
                                    }}
                                  >
                                    <Icon className="size-4" />
                                  </div>
                                  <span className="font-medium">{room.name}</span>
                                </div>
                                <RoomContent
                                  items={itemsByRoomId.get(room.id) ?? []}
                                  entityMap={entityMap}
                                  isLoading={false}
                                  onAllOff={handleAllOff}
                                  isAllOffPending={isPending}
                                />
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <RoomContent
                          items={itemsByRoomId.get(activeRoomId) ?? []}
                          entityMap={entityMap}
                          isLoading={false}
                          onAllOff={handleAllOff}
                          isAllOffPending={isPending}
                        />
                      )}
                    </motion.div>
                  </AnimatePresence>
                </div>
              ) : (
                // Legacy: show dashboard lights
                <div className="py-4">
                  <LegacyLightContent
                    lightCards={lightCards}
                    entityMap={entityMap}
                    onAllOff={() => handleAllOff()}
                    isPending={isPending}
                    lightsOnCount={totalLightsOn}
                  />
                </div>
              )}
            </ScrollArea>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
