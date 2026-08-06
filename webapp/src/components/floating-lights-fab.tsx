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
  useRoomsConfig,
  useRoomEntitiesWithStates,
  useAllRoomEntityIds,
} from "@/hooks";
import { LightControlItem } from "./light-control-item";
import { SwitchControlItem } from "./switch-control-item";
import { SensorDisplayItem } from "./sensor-display-item";
import { BinarySensorDisplayItem } from "./binary-sensor-display-item";
import type { DashboardCard, HAEntity, RoomConfig, RoomIcon, RoomEntity } from "@/types/home-assistant";

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

// Room tab component
const RoomTab = React.memo(function RoomTab({
  room,
  isActive,
  onClick,
  lightsOn,
}: {
  room: RoomConfig | { id: "all"; name: string; icon: RoomIcon };
  isActive: boolean;
  onClick: () => void;
  lightsOn: number;
}) {
  const Icon = ICON_MAP[room.icon] || Home;

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

// Room content section showing entities by type
const RoomContent = React.memo(function RoomContent({
  roomId,
  onAllOff,
  isAllOffPending,
}: {
  roomId: string | "all";
  onAllOff: (entityIds: string[]) => void;
  isAllOffPending: boolean;
}) {
  const t = useTranslations("homeAutomation.fab");
  const { entities, isLoading, lightsOn, switchesOn } = useRoomEntitiesWithStates(
    roomId === "all" ? undefined : roomId
  );

  // Group entities by domain in a single pass
  const { lights, switches, sensors, binarySensors, lightEntityIds } = useMemo(() => {
    const l: typeof entities = [];
    const sw: typeof entities = [];
    const se: typeof entities = [];
    const bs: typeof entities = [];
    const onIds: string[] = [];
    for (const e of entities) {
      const domain = e.state?.domain;
      if (domain === "light") {
        l.push(e);
        if (e.state?.state === "on") onIds.push(e.entity_id);
      } else if (domain === "switch" || domain === "input_boolean") {
        sw.push(e);
      } else if (domain === "sensor") {
        se.push(e);
      } else if (domain === "binary_sensor") {
        bs.push(e);
      }
    }
    return { lights: l, switches: sw, sensors: se, binarySensors: bs, lightEntityIds: onIds };
  }, [entities]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  if (entities.length === 0) {
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
            {lights.map((entity) => {
              if (!entity.state) return null;
              // Create a fake DashboardCard for compatibility
              const card: DashboardCard = {
                id: entity.entity_id,
                entity_id: entity.entity_id,
                display_name: entity.display_name,
                card_type: "light",
                position: entity.position,
                size: "medium",
              };
              return (
                <LightControlItem
                  key={entity.entity_id}
                  card={card}
                  entity={entity.state}
                />
              );
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
            {switches.map((entity) => {
              if (!entity.state) return null;
              return (
                <SwitchControlItem
                  key={entity.entity_id}
                  roomEntity={entity}
                  entity={entity.state}
                />
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
            {sensors.map((entity) => {
              if (!entity.state) return null;
              return (
                <SensorDisplayItem
                  key={entity.entity_id}
                  roomEntity={entity}
                  entity={entity.state}
                />
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
            {binarySensors.map((entity) => {
              if (!entity.state) return null;
              return (
                <BinarySensorDisplayItem
                  key={entity.entity_id}
                  roomEntity={entity}
                  entity={entity.state}
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

  // Get rooms configuration
  const roomsConfig = useRoomsConfig();
  const hasRooms = roomsConfig.rooms.length > 0;

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
  const allRoomEntityIds = useAllRoomEntityIds();

  // Combine entity IDs (rooms + dashboard lights)
  const allEntityIds = useMemo(() => {
    const ids = new Set(allRoomEntityIds);
    lightCards.forEach((card) => ids.add(card.entity_id));
    return Array.from(ids);
  }, [allRoomEntityIds, lightCards]);

  // Fetch entity states for all entities
  const { data: entityStates = [], isLoading } = useHomeAssistantEntityStates(
    allEntityIds,
    isConnected && allEntityIds.length > 0
  );

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
    for (const room of roomsConfig.rooms) {
      counts[room.id] = room.entities
        .map((e) => entityMap.get(e.entity_id))
        .filter((e) => e?.domain === "light" && e?.state === "on").length;
    }
    return counts;
  }, [roomsConfig.rooms, entityMap, totalLightsOn]);

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
                    {roomsConfig.rooms
                      .sort((a, b) => a.position - b.position)
                      .map((room) => (
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
                          {roomsConfig.rooms.map((room) => {
                            const Icon = ICON_MAP[room.icon] || Home;
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
                                      color: room.color,
                                    }}
                                  >
                                    <Icon className="size-4" />
                                  </div>
                                  <span className="font-medium">{room.name}</span>
                                </div>
                                <RoomContent
                                  roomId={room.id}
                                  onAllOff={handleAllOff}
                                  isAllOffPending={isPending}
                                />
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <RoomContent
                          roomId={activeRoomId}
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
