"use client";

import { useState, useMemo } from "react";
import { toast } from "sonner";
import { motion, AnimatePresence, Reorder } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Edit,
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
  X,
  Lightbulb,
  Power,
  Thermometer,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  useRoomsConfig,
  useCreateRoom,
  useUpdateRoom,
  useDeleteRoom,
  useReorderRooms,
  useAddEntityToRoom,
  useRemoveEntityFromRoom,
  useUpdateRoomsSettings,
  useHomeAssistantStatus,
  useHomeAssistantEntityStates,
} from "@/hooks";
import { RoomEntityBrowser } from "@/components/home-assistant/room-entity-browser";
import type { RoomConfig, RoomIcon, RoomEntity } from "@/types/home-assistant";

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

// Room icon options for picker — labels come from translations via iconLabelKey()
const ROOM_ICONS: readonly RoomIcon[] = [
  "home",
  "bed-double",
  "sofa",
  "utensils",
  "bath",
  "car",
  "tree",
  "briefcase",
  "baby",
  "tv",
  "door-open",
  "warehouse",
  "lamp",
  "armchair",
  "washing-machine",
  "coffee",
  "book",
] as const;

// Map RoomIcon (kebab-case) → camelCase for translation keys.
const ICON_LABEL_KEYS: Record<RoomIcon, string> = {
  home: "iconLabel_home",
  "bed-double": "iconLabel_bedDouble",
  sofa: "iconLabel_sofa",
  utensils: "iconLabel_utensils",
  bath: "iconLabel_bath",
  car: "iconLabel_car",
  tree: "iconLabel_tree",
  briefcase: "iconLabel_briefcase",
  baby: "iconLabel_baby",
  tv: "iconLabel_tv",
  "door-open": "iconLabel_doorOpen",
  warehouse: "iconLabel_warehouse",
  lamp: "iconLabel_lamp",
  armchair: "iconLabel_armchair",
  "washing-machine": "iconLabel_washingMachine",
  coffee: "iconLabel_coffee",
  book: "iconLabel_book",
};

// Room editor dialog
function RoomEditorDialog({
  room,
  isOpen,
  onClose,
  onSave,
}: {
  room?: RoomConfig;
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: { name: string; icon: RoomIcon; color?: string }) => void;
}) {
  const t = useTranslations("settings.homeassistantRooms");
  const [name, setName] = useState(room?.name || "");
  const [icon, setIcon] = useState<RoomIcon>(room?.icon || "home");
  const [color, setColor] = useState(room?.color || "");

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({ name: name.trim(), icon, color: color || undefined });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {room ? t("editorTitleEdit") : t("editorTitleNew")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-4">
          {/* Room name */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="room-name">{t("nameLabel")}</Label>
            <Input
              id="room-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("namePlaceholder")}
            />
          </div>

          {/* Icon picker */}
          <div className="flex flex-col gap-2">
            <Label>{t("iconLabel")}</Label>
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
              {ROOM_ICONS.map((iconValue) => {
                const Icon = ICON_MAP[iconValue];
                const isSelected = icon === iconValue;
                return (
                  <button
                    key={iconValue}
                    onClick={() => setIcon(iconValue)}
                    className={`p-3 rounded-lg border-2 transition-all ${
                      isSelected
                        ? "border-primary bg-primary/20"
                        : "border-transparent bg-muted hover:bg-accent"
                    }`}
                    title={t(ICON_LABEL_KEYS[iconValue])}
                  >
                    <Icon className="size-5 mx-auto" />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Color picker (optional) */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="room-color">{t("colorLabel")}</Label>
            <div className="flex gap-2">
              <Input
                id="room-color"
                type="color"
                value={color || "#6366f1"}
                onChange={(e) => setColor(e.target.value)}
                className="w-14 h-10 p-1 cursor-pointer"
              />
              <Input
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder={t("colorPlaceholder")}
                className="flex-1"
              />
              {color && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setColor("")}
                >
                  <X className="size-4" />
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose}>
            {t("editorCancel")}
          </Button>
          <Button variant="default" onClick={handleSave} disabled={!name.trim()}>
            {room ? t("editorSave") : t("editorCreate")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Entity list item in room
function RoomEntityItem({
  roomEntity,
  entityState,
  onRemove,
}: {
  roomEntity: RoomEntity;
  entityState?: { name: string; state: string; domain: string };
  onRemove: () => void;
}) {
  const t = useTranslations("settings.homeassistantRooms");
  const getIcon = () => {
    switch (entityState?.domain) {
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

  const displayName = roomEntity.display_name || entityState?.name || roomEntity.entity_id;

  return (
    <div className="flex items-center gap-3 p-2 rounded-lg bg-card border">
      <div className="p-1.5 rounded bg-muted text-muted-foreground">
        {getIcon()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {displayName}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {roomEntity.entity_id}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={onRemove}
        className="shrink-0 text-muted-foreground hover:text-destructive"
        aria-label={t("removeAria", { name: displayName })}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}

// Room card component
function RoomCard({
  room,
  onEdit,
  onDelete,
  onAddEntities,
  onRemoveEntity,
}: {
  room: RoomConfig;
  onEdit: () => void;
  onDelete: () => void;
  onAddEntities: () => void;
  onRemoveEntity: (entityId: string) => void;
}) {
  const t = useTranslations("settings.homeassistantRooms");
  const tCommon = useTranslations("common");
  const Icon = ICON_MAP[room.icon] || Home;
  const entityIds = room.entities.map((e) => e.entity_id);
  const { data: haStatus } = useHomeAssistantStatus();
  const isConnected = !!haStatus?.url;

  const { data: entityStates = [] } = useHomeAssistantEntityStates(
    entityIds,
    isConnected
  );

  const stateMap = useMemo(
    () => new Map(entityStates.map((e) => [e.entity_id, e])),
    [entityStates]
  );

  return (
    <motion.div
      layout
      className="bg-card rounded-xl border overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b">
        <div
          className="p-2 rounded-lg"
          style={{
            backgroundColor: room.color ? `${room.color}20` : undefined,
            color: room.color,
          }}
        >
          <Icon className="size-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold truncate">{room.name}</h3>
          <p className="text-xs text-muted-foreground">
            {t("entityCount", { count: room.entities.length })}
          </p>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={onEdit} aria-label={t("editAria")}>
            <Edit className="size-4" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive"
                aria-label={t("deleteAria")}
              >
                <Trash2 className="size-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("deleteDialogTitle")}</AlertDialogTitle>
                <AlertDialogDescription>{t("deleteConfirm")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={onDelete}
                >
                  {tCommon("delete")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Entities */}
      <div className="p-4 flex flex-col gap-2">
        {room.entities.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            {t("noEntities")}
          </p>
        ) : (
          room.entities.map((entity) => {
            const state = stateMap.get(entity.entity_id);
            return (
              <RoomEntityItem
                key={entity.entity_id}
                roomEntity={entity}
                entityState={
                  state
                    ? {
                        name: state.name,
                        state: state.state,
                        domain: state.domain,
                      }
                    : undefined
                }
                onRemove={() => onRemoveEntity(entity.entity_id)}
              />
            );
          })
        )}

        <Button
          variant="outline"
          className="w-full mt-2"
          onClick={onAddEntities}
        >
          <Plus className="size-4 mr-2" />
          {t("addEntitiesButton")}
        </Button>
      </div>
    </motion.div>
  );
}

export default function RoomsSettingsPage() {
  const t = useTranslations("settings.homeassistantRooms");
  const roomsConfig = useRoomsConfig();
  const createRoom = useCreateRoom();
  const updateRoom = useUpdateRoom();
  const deleteRoom = useDeleteRoom();
  const reorderRooms = useReorderRooms();
  const addEntityToRoom = useAddEntityToRoom();
  const removeEntityFromRoom = useRemoveEntityFromRoom();
  const updateRoomsSettings = useUpdateRoomsSettings();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<RoomConfig | undefined>();
  const [browserOpen, setBrowserOpen] = useState(false);
  const [browserRoomId, setBrowserRoomId] = useState<string | null>(null);

  // Get all assigned entity IDs for exclusion
  const assignedEntityIds = roomsConfig.rooms.flatMap((r) =>
    r.entities.map((e) => e.entity_id)
  );

  const handleCreateRoom = () => {
    setEditingRoom(undefined);
    setEditorOpen(true);
  };

  const handleEditRoom = (room: RoomConfig) => {
    setEditingRoom(room);
    setEditorOpen(true);
  };

  const handleSaveRoom = async (data: {
    name: string;
    icon: RoomIcon;
    color?: string;
  }) => {
    try {
      if (editingRoom) {
        await updateRoom.mutateAsync({
          roomId: editingRoom.id,
          updates: data,
        });
      } else {
        await createRoom.mutateAsync({
          name: data.name,
          icon: data.icon,
          color: data.color,
          entities: [],
        });
      }
    } catch {
      toast.error(t("toastSaveFailed"));
    }
  };

  const handleDeleteRoom = async (roomId: string) => {
    try {
      await deleteRoom.mutateAsync(roomId);
    } catch {
      toast.error(t("toastDeleteFailed"));
    }
  };

  const handleAddEntities = (roomId: string) => {
    setBrowserRoomId(roomId);
    setBrowserOpen(true);
  };

  const handleEntitiesSelected = async (entityIds: string[]) => {
    if (!browserRoomId) return;

    try {
      for (const entityId of entityIds) {
        await addEntityToRoom.mutateAsync({
          roomId: browserRoomId,
          entityId,
        });
      }
    } catch {
      toast.error(t("toastAddEntitiesFailed"));
    }

    setBrowserOpen(false);
    setBrowserRoomId(null);
  };

  const handleRemoveEntity = async (roomId: string, entityId: string) => {
    try {
      await removeEntityFromRoom.mutateAsync({ roomId, entityId });
    } catch {
      toast.error(t("toastRemoveEntityFailed"));
    }
  };

  const handleReorder = async (newOrder: RoomConfig[]) => {
    try {
      await reorderRooms.mutateAsync(newOrder.map((r) => r.id));
    } catch {
      toast.error(t("toastReorderFailed"));
    }
  };

  return (
    <main id="main-content" className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background border-b border-border/50">
        <div className="flex items-center gap-4 p-4">
          <Link href="/settings/homeassistant">
            <Button variant="ghost" size="icon" aria-label={t("backAria")}>
              <ArrowLeft className="size-5" />
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-lg font-semibold">{t("headerTitle")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("headerSubtitle")}
            </p>
          </div>
          <Button variant="default" onClick={handleCreateRoom}>
            <Plus className="size-4 mr-2" />
            {t("addRoomButton")}
          </Button>
        </div>
      </header>

      <div className="p-4 flex flex-col gap-6 max-w-2xl mx-auto">
        {/* Global settings */}
        <div className="bg-card rounded-xl border p-4 flex flex-col gap-4">
          <h2 className="font-semibold">{t("settingsHeading")}</h2>

          <div className="flex items-center justify-between">
            <div>
              <Label>{t("showUnassignedLabel")}</Label>
              <p className="text-xs text-muted-foreground">
                {t("showUnassignedDescription")}
              </p>
            </div>
            <Switch
              checked={roomsConfig.show_unassigned}
              onCheckedChange={(checked) =>
                updateRoomsSettings.mutate({ show_unassigned: checked })
              }
            />
          </div>
        </div>

        {/* Room list */}
        {roomsConfig.rooms.length === 0 ? (
          <div className="text-center py-12">
            <Home className="size-12 mx-auto mb-4 text-muted-foreground/30" />
            <p className="text-muted-foreground mb-4">
              {t("emptyTitle")}
            </p>
            <Button variant="default" onClick={handleCreateRoom}>
              <Plus className="size-4 mr-2" />
              {t("emptyButton")}
            </Button>
          </div>
        ) : (
          <Reorder.Group
            axis="y"
            values={roomsConfig.rooms}
            onReorder={handleReorder}
            className="flex flex-col gap-4"
          >
            <AnimatePresence mode="popLayout">
              {roomsConfig.rooms.map((room) => (
                <Reorder.Item
                  key={room.id}
                  value={room}
                  className="cursor-grab active:cursor-grabbing"
                >
                  <RoomCard
                    room={room}
                    onEdit={() => handleEditRoom(room)}
                    onDelete={() => handleDeleteRoom(room.id)}
                    onAddEntities={() => handleAddEntities(room.id)}
                    onRemoveEntity={(entityId) =>
                      handleRemoveEntity(room.id, entityId)
                    }
                  />
                </Reorder.Item>
              ))}
            </AnimatePresence>
          </Reorder.Group>
        )}
      </div>

      {/* Room editor dialog */}
      <RoomEditorDialog
        room={editingRoom}
        isOpen={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSave={handleSaveRoom}
      />

      {/* Entity browser dialog */}
      <Dialog open={browserOpen} onOpenChange={setBrowserOpen}>
        <DialogContent className="max-w-lg p-0">
          <RoomEntityBrowser
            onSelect={handleEntitiesSelected}
            onCancel={() => setBrowserOpen(false)}
            excludeEntityIds={assignedEntityIds}
            multiSelect
          />
        </DialogContent>
      </Dialog>
    </main>
  );
}
