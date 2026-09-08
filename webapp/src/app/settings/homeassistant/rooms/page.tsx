"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { motion, AnimatePresence, Reorder } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  ArrowRight,
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
  Boxes,
  X,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  useRooms,
  useCreateRoomRow,
  useUpdateRoomRow,
  useDeleteRoomRow,
  RoomDuplicateError,
} from "@/hooks/use-rooms-table";
import type { Room } from "@/types/database";
import type { RoomIcon } from "@/types/home-assistant";

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

// Room icon options for picker — labels come from translations via ICON_LABEL_KEYS
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

/** A room's icon, tolerant of a null or unrecognised value from the row. */
function iconFor(icon: string | null): typeof Home {
  return (icon && ICON_MAP[icon as RoomIcon]) || Home;
}

// Room editor dialog
function RoomEditorDialog({
  room,
  isOpen,
  onClose,
  onSave,
}: {
  room?: Room;
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: { name: string; icon: RoomIcon; color?: string }) => void;
}) {
  const t = useTranslations("settings.homeassistantRooms");
  const [name, setName] = useState(room?.name || "");
  const [icon, setIcon] = useState<RoomIcon>((room?.icon as RoomIcon) || "home");
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
                  aria-label={t("clearColorAria")}
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

// Room card component
function RoomCard({
  room,
  onEdit,
  onDelete,
}: {
  room: Room;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("settings.homeassistantRooms");
  const tCommon = useTranslations("common");
  const Icon = iconFor(room.icon);

  return (
    <motion.div layout className="bg-card rounded-xl border overflow-hidden">
      <div className="flex items-center gap-3 p-4">
        <div
          className="p-2 rounded-lg"
          style={{
            backgroundColor: room.color ? `${room.color}20` : undefined,
            color: room.color ?? undefined,
          }}
        >
          <Icon className="size-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold truncate">{room.name}</h3>
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
                <AlertDialogDescription>{t("deleteKeepsDevices")}</AlertDialogDescription>
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
    </motion.div>
  );
}

export default function RoomsSettingsPage() {
  const t = useTranslations("settings.homeassistantRooms");
  const roomsQuery = useRooms();
  const createRoom = useCreateRoomRow();
  const updateRoom = useUpdateRoomRow();
  const deleteRoom = useDeleteRoomRow();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | undefined>();

  // Local working copy of the *order* (ids only) so dragging feels
  // immediate; resynced from the server whenever the set of rooms changes
  // (add/delete/refetch), same approach as settings/navigation — an
  // in-progress drag is otherwise preserved rather than clobbered by a
  // stray refetch. Deliberately not a copy of the Room objects themselves:
  // a rename or recolour doesn't change the id set, so a local copy of the
  // rows would never pick up the edit — the card would keep showing the
  // pre-save name after a successful PATCH. Rooms are looked up by id from
  // `roomsQuery.data` at render time instead, so every field stays live.
  const [orderIds, setOrderIds] = useState<string[]>(() =>
    roomsQuery.data.map((r) => r.id),
  );
  useEffect(() => {
    const nextIds = roomsQuery.data.map((r) => r.id);
    const nextSet = new Set(nextIds);
    const currentSet = new Set(orderIds);
    const same =
      nextSet.size === currentSet.size &&
      [...nextSet].every((id) => currentSet.has(id));
    if (!same) setOrderIds(nextIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomsQuery.data]);

  const roomsById = new Map(roomsQuery.data.map((r) => [r.id, r]));
  const order = orderIds
    .map((id) => roomsById.get(id))
    .filter((r): r is Room => r !== undefined);

  const handleCreateRoom = () => {
    setEditingRoom(undefined);
    setEditorOpen(true);
  };

  const handleEditRoom = (room: Room) => {
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
          id: editingRoom.id,
          name: data.name,
          icon: data.icon,
          color: data.color ?? null,
        });
      } else {
        await createRoom.mutateAsync({
          name: data.name,
          icon: data.icon,
          color: data.color ?? null,
        });
      }
    } catch (err) {
      if (err instanceof RoomDuplicateError) {
        toast.error(t("duplicateName"));
      } else {
        toast.error(t("toastSaveFailed"));
      }
    }
  };

  const handleDeleteRoom = async (roomId: string) => {
    try {
      await deleteRoom.mutateAsync(roomId);
    } catch {
      toast.error(t("toastDeleteFailed"));
    }
  };

  // Persist the final drop order, not every intermediate swap — one
  // PATCH per room whose position actually moved.
  const persistOrder = (next: Room[]) => {
    next.forEach((room, index) => {
      if (room.position !== index) {
        updateRoom.mutate(
          { id: room.id, position: index },
          {
            onError: () => toast.error(t("toastReorderFailed")),
          },
        );
      }
    });
  };

  const handleReorder = (next: Room[]) => {
    setOrderIds(next.map((r) => r.id));
  };

  return (
    <main id="main-content" className="min-h-page bg-background text-foreground safe-area-inset">
      {/* Header */}
      <header className="sticky top-[env(safe-area-inset-top,0px)] z-50 -mx-4 px-4 bg-background border-b border-border/50">
        <div className="flex items-center gap-4 py-4">
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

      <div className="py-4 flex flex-col gap-6 max-w-2xl mx-auto">
        {/* Devices moved to the catalogue — the entire mitigation for a
            household that used to assign devices from this page, so it
            leads the page rather than trailing at the bottom. */}
        <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-4 flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
              <Boxes className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold">{t("devicesMovedTitle")}</h2>
              <p className="text-sm text-muted-foreground">
                {t("devicesMovedBody")}
              </p>
            </div>
          </div>
          <Button asChild variant="default" className="w-full sm:w-auto sm:self-end">
            <Link href="/settings/catalogue">
              {t("devicesMovedLink")}
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>

        {/* Room list */}
        {order.length === 0 ? (
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
            values={order}
            onReorder={handleReorder}
            className="flex flex-col gap-4"
          >
            <AnimatePresence mode="popLayout">
              {order.map((room) => (
                <Reorder.Item
                  key={room.id}
                  value={room}
                  onDragEnd={() => persistOrder(order)}
                  className="cursor-grab active:cursor-grabbing"
                >
                  <RoomCard
                    room={room}
                    onEdit={() => handleEditRoom(room)}
                    onDelete={() => handleDeleteRoom(room.id)}
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
    </main>
  );
}
