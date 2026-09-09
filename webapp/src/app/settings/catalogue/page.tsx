"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import {
  Boxes,
  Plus,
  Pencil,
  Trash2,
  Search,
  Upload,
  Link as LinkIcon,
  X,
  Check,
  Loader2,
  ImageIcon,
  WifiOff,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { useKeyboardShortcuts, useSwipeNavigation } from "@/hooks";
import {
  useCatalogue,
  useAddCatalogueItem,
  useUpdateCatalogueItem,
  useDeleteCatalogueItem,
  useImportCatalogueRooms,
  CatalogueDuplicateError,
} from "@/hooks/use-catalogue";
import { useRooms } from "@/hooks/use-rooms-table";
import {
  useHomeAssistantEntities,
  useHomeAssistantEntityStates,
  useHomeAssistantStatus,
} from "@/hooks/use-home-assistant";
import { useFamilyStore } from "@/stores/family-store";
import type { CatalogueItem } from "@/types/database";
import type { HAEntity } from "@/types/home-assistant";

/**
 * Names a device the same way `migration_catalogue_items.sql` names one:
 * the entity's own friendly name if it has one, otherwise its entity-id
 * suffix in sentence case ("light.under_cupboard" -> "Under cupboard"),
 * otherwise the raw entity id. Keeping this in step with the SQL is the
 * point — a device added by hand here and one carried over by the migration
 * must not be nameable two different ways.
 */
function deriveCatalogueName(entity: HAEntity): string {
  const friendly = entity.attributes?.friendly_name?.trim();
  if (friendly) return friendly.slice(0, 120);

  const suffix = entity.entity_id.split(".")[1]?.replace(/_/g, " ") ?? "";
  if (suffix) {
    return (suffix.charAt(0).toUpperCase() + suffix.slice(1)).slice(0, 120);
  }
  return entity.entity_id.slice(0, 120);
}

interface ImageSearchResult {
  url: string;
  thumbnail: string;
  title: string;
  source: string;
}

/**
 * Search first, upload and paste always available beside it — RFC-006 §4.
 * Never hides the escape hatches behind the search tab: the scrapers this
 * used to lean on rotted once already, and a confident wrong photo of
 * someone's washing machine is worse than none.
 */
function DeviceImagePicker({
  value,
  onChange,
  seedQuery,
  familyId,
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  seedQuery: string;
  familyId: string | undefined;
}) {
  const t = useTranslations("catalogue");
  const tCommon = useTranslations("common");
  const [query, setQuery] = useState(seedQuery);
  const [results, setResults] = useState<ImageSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteValue, setPasteValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const search = async () => {
    if (!query.trim() || !familyId || searching) return;
    setSearching(true);
    try {
      const params = new URLSearchParams({
        q: query.trim(),
        family_id: familyId,
        limit: "12",
        mode: "general",
      });
      const res = await fetch(`/api/images/search?${params}`);
      const data = await res.json();
      setResults(Array.isArray(data.results) ? data.results : []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const upload = async (file: File) => {
    if (!familyId) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      formData.append("family_id", familyId);
      const res = await fetch("/api/catalogue/upload-image", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      onChange(data.url);
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setUploading(false);
    }
  };

  if (value) {
    return (
      <div className="relative aspect-video w-full max-w-xs overflow-hidden rounded-xl bg-muted">
        <img src={value} alt="" className="size-full object-cover" />
        <Button
          type="button"
          variant="destructive"
          size="icon"
          className="absolute right-2 top-2"
          onClick={() => onChange(null)}
          aria-label={t("imageRemove")}
        >
          <X className="size-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void search();
            }
          }}
          placeholder={t("imageSearch")}
        />
        <Button type="button" onClick={() => void search()} disabled={searching || !query.trim()}>
          {searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
        </Button>
      </div>

      {results.length > 0 && (
        <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto">
          {results.map((r, i) => (
            <button
              key={`${r.url}-${i}`}
              type="button"
              onClick={() => onChange(r.url)}
              className="relative aspect-square overflow-hidden rounded-lg bg-muted transition-all hover:ring-2 hover:ring-primary"
            >
              <img
                src={r.thumbnail || r.url}
                alt={r.title}
                className="size-full object-cover"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Upload className="mr-2 size-4" />
          )}
          {t("imageUpload")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setPasteOpen((v) => !v)}>
          <LinkIcon className="mr-2 size-4" />
          {t("imagePaste")}
        </Button>
      </div>

      {pasteOpen && (
        <div className="flex gap-2">
          <Input
            value={pasteValue}
            onChange={(e) => setPasteValue(e.target.value)}
            placeholder="https://…"
          />
          <Button
            type="button"
            disabled={!pasteValue.trim()}
            aria-label={tCommon("save")}
            onClick={() => {
              onChange(pasteValue.trim());
              setPasteValue("");
              setPasteOpen(false);
            }}
          >
            <Check className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

export default function CataloguePage() {
  useKeyboardShortcuts();
  useSwipeNavigation();
  const t = useTranslations("catalogue");
  const tCommon = useTranslations("common");
  const { family } = useFamilyStore();

  const { data: catalogue, isLoading } = useCatalogue();
  const { data: rooms, isLoading: roomsLoading, isError: roomsError } = useRooms();
  // "Not yet known" and "known to have failed" both have to be kept apart
  // from "known to be empty" — collapsing either into empty is how a
  // household gets told to go make rooms it already has, or how a device
  // gets filed under "No room" (or has its real room silently cleared)
  // before/without the answer actually being known.
  const roomsUnknown = roomsLoading || roomsError;
  const { data: haStatus } = useHomeAssistantStatus();
  const isConnected = Boolean(haStatus?.url && haStatus?.access_token);

  const { data: haEntities = [] } = useHomeAssistantEntities(undefined, isConnected);
  const entityIds = useMemo(
    () =>
      catalogue
        .filter((item): item is CatalogueItem & { entity_id: string } => item.kind === "ha_entity" && !!item.entity_id)
        .map((item) => item.entity_id),
    [catalogue],
  );
  const { data: liveStates = [] } = useHomeAssistantEntityStates(entityIds, isConnected);
  const stateByEntityId = useMemo(() => {
    const map = new Map<string, HAEntity>();
    for (const e of liveStates) map.set(e.entity_id, e);
    return map;
  }, [liveStates]);

  const addItem = useAddCatalogueItem();
  const updateItem = useUpdateCatalogueItem();
  const deleteItem = useDeleteCatalogueItem();
  const importRooms = useImportCatalogueRooms();

  async function handleImportRooms() {
    try {
      const result = await importRooms.mutateAsync();
      // A timeout, an unreachable host or a token missing the template scope
      // all come back as `{ updated: 0 }` with HTTP 200 (route.ts swallows
      // them so a household's rooms are never touched on failure) — the same
      // shape as genuinely having nothing left to fill in. Announcing that as
      // "Placed 0 devices" reads as success when it may be neither; say
      // nothing happened instead of claiming it did.
      if (result.updated > 0) {
        toast.success(t("importedRooms", { count: result.updated }));
      } else {
        toast(t("importedRoomsNone"));
      }
    } catch {
      toast.error(t("saveFailed"));
    }
  }

  // Add-device picker
  const [addOpen, setAddOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const catalogueEntityIds = useMemo(
    () => new Set(entityIds),
    [entityIds],
  );
  const filteredEntities = useMemo(() => {
    const available = haEntities.filter((e) => !catalogueEntityIds.has(e.entity_id));
    const q = filter.trim().toLowerCase();
    if (!q) return available;
    return available.filter(
      (e) => deriveCatalogueName(e).toLowerCase().includes(q) || e.entity_id.toLowerCase().includes(q),
    );
  }, [haEntities, catalogueEntityIds, filter]);

  async function handleAdd(entity: HAEntity) {
    try {
      await addItem.mutateAsync({
        kind: "ha_entity",
        entity_id: entity.entity_id,
        name: deriveCatalogueName(entity),
      });
    } catch (err) {
      if (err instanceof CatalogueDuplicateError) {
        toast.error(t("duplicate"));
      } else {
        toast.error(t("saveFailed"));
      }
    }
  }

  // Edit dialog
  const [editing, setEditing] = useState<CatalogueItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editRoomId, setEditRoomId] = useState<string | null>(null);
  const [editImage, setEditImage] = useState<string | null>(null);

  function openEdit(item: CatalogueItem) {
    setEditing(item);
    setEditName(item.name);
    setEditRoomId(item.room_id);
    setEditImage(item.image_url);
  }

  // A `room_id` the currently loaded rooms no longer contain — the FK is
  // `ON DELETE SET NULL` so a live edit shouldn't produce one, but resolving
  // it once here keeps what the picker displays and what Save actually
  // sends in agreement, rather than showing "No room" while quietly still
  // holding the stale id.
  //
  // The membership check only runs once `rooms` is a real, known answer.
  // While it's loading or errored, `rooms` is the same empty array a truly
  // room-less family would have — checking membership against it then
  // would read every real room_id as dangling and silently null it out.
  // Passing `editRoomId` straight through here means a Save fired during
  // that window (the button is also disabled for it, belt and braces per
  // the incident this fixes) resends the item's own unmodified id instead
  // of clearing it.
  const resolvedEditRoomId = roomsUnknown
    ? editRoomId
    : editRoomId !== null && rooms.some((r) => r.id === editRoomId)
      ? editRoomId
      : null;

  async function saveEdit() {
    if (!editing || !editName.trim()) return;
    try {
      await updateItem.mutateAsync({
        id: editing.id,
        name: editName.trim(),
        // The legacy free-text `room` is deliberately not sent here —
        // RFC-007 §3 keeps it exactly as the migration left it, unread,
        // as what a household recovers from if the migration guessed
        // wrong. Only `room_id` is written by this screen now.
        room_id: resolvedEditRoomId,
        // Empty string, not undefined: the update route only touches a
        // field when the key is present, and an empty string clears it the
        // same way `null` would (see route.ts's trim-then-null fallback).
        // The hook's own type is `string`, not `string | null`.
        image_url: editImage ?? "",
      });
      setEditing(null);
    } catch {
      toast.error(t("saveFailed"));
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteItem.mutateAsync(id);
    } catch {
      toast.error(t("saveFailed"));
    }
  }

  /**
   * Grouped by `room_id`, never by the legacy free-text `room` — that field
   * stays in the database unread, which only means something if this screen
   * actually doesn't read it. `rooms` is already ordered by position then
   * name (`useRooms()`), so iterating it directly gives the right heading
   * order for free.
   *
   * A `room_id` pointing at a room that no longer exists (shouldn't happen —
   * the FK is `ON DELETE SET NULL` — but asserted defensively) falls into
   * the same "no room" bucket as a null one, rather than vanishing.
   */
  const grouped = useMemo(() => {
    const byRoom = new Map<string, CatalogueItem[]>();
    for (const room of rooms) byRoom.set(room.id, []);
    const unroomed: CatalogueItem[] = [];
    for (const item of catalogue) {
      if (item.room_id && byRoom.has(item.room_id)) {
        byRoom.get(item.room_id)!.push(item);
      } else {
        unroomed.push(item);
      }
    }
    return { byRoom, unroomed };
  }, [catalogue, rooms]);

  return (
    <main id="main-content" className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="relative z-10 max-w-2xl mx-auto flex flex-col gap-6">
        <PageHeader
          icon={Boxes}
          title={t("title")}
          subtitle={t("description")}
          actions={
            <div className="flex items-center gap-2">
              {isConnected && (
                <Button
                  variant="outline"
                  disabled={importRooms.isPending}
                  onClick={() => void handleImportRooms()}
                >
                  {importRooms.isPending ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 size-4" />
                  )}
                  {t("importRooms")}
                </Button>
              )}
              <Button onClick={() => setAddOpen(true)}>
                <Plus className="mr-2 size-4" />
                {t("addDevice")}
              </Button>
            </div>
          }
        />

        {!isConnected && (
          <Card className="flex items-center gap-3 border-dashed p-4 text-sm text-muted-foreground">
            <WifiOff className="size-4 shrink-0" />
            <span>{t("notConnected")}</span>
          </Card>
        )}

        {isLoading ? (
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : catalogue.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title={t("empty")}
            description={isConnected ? t("emptyHint") : t("notConnected")}
            action={
              isConnected
                ? { label: t("addDevice"), onClick: () => setAddOpen(true), variant: "default" }
                : undefined
            }
          />
        ) : roomsUnknown ? (
          // The catalogue is known and non-empty, but which room each item
          // belongs to is not (still loading, or the rooms query failed) —
          // grouping now would file every roomed device under "No room"
          // until it is, the same wrong-while-loading (or wrong-while-
          // errored) state as the picker claiming there are no rooms.
          // Devices still render (nothing about them is unknown), just flat
          // and without committing to a heading; each row's own room text
          // says exactly what's true — "still finding out" while loading,
          // "couldn't find out" on error — rather than guessing "No room".
          <div className="flex flex-col gap-2">
            {catalogue.map((item) => (
              <DeviceRow
                key={item.id}
                item={item}
                roomLabel={roomsLoading ? <Skeleton className="h-3 w-20" /> : t("roomsUnavailable")}
                state={item.entity_id ? stateByEntityId.get(item.entity_id) : undefined}
                t={t}
                tCommon={tCommon}
                onEdit={() => openEdit(item)}
                onDelete={() => handleDelete(item.id)}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {rooms.map((room) => {
              const items = grouped.byRoom.get(room.id) ?? [];
              if (items.length === 0) return null;
              return (
                <div key={room.id} className="flex flex-col gap-2">
                  <h2 className="px-1 text-sm font-medium text-muted-foreground">{room.name}</h2>
                  <div className="flex flex-col gap-2">
                    {items.map((item) => (
                      <DeviceRow
                        key={item.id}
                        item={item}
                        roomLabel={room.name}
                        state={item.entity_id ? stateByEntityId.get(item.entity_id) : undefined}
                        t={t}
                        tCommon={tCommon}
                        onEdit={() => openEdit(item)}
                        onDelete={() => handleDelete(item.id)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
            {grouped.unroomed.length > 0 && (
              <div className="flex flex-col gap-2">
                <h2 className="px-1 text-sm font-medium text-muted-foreground">{t("roomNone")}</h2>
                <div className="flex flex-col gap-2">
                  {grouped.unroomed.map((item) => (
                    <DeviceRow
                      key={item.id}
                      item={item}
                      roomLabel={t("roomNone")}
                      state={item.entity_id ? stateByEntityId.get(item.entity_id) : undefined}
                      t={t}
                      tCommon={tCommon}
                      onEdit={() => openEdit(item)}
                      onDelete={() => handleDelete(item.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add device */}
      <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) setFilter(""); }}>
        <DialogContent className="flex max-h-[80vh] flex-col">
          <DialogHeader>
            <DialogTitle>{t("addDevice")}</DialogTitle>
            <DialogDescription>{t("search")}</DialogDescription>
          </DialogHeader>
          {!isConnected ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("notConnected")}</p>
          ) : (
            <>
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t("search")}
                autoFocus
              />
              <div className="flex flex-1 flex-col gap-1 overflow-y-auto">
                {filteredEntities.map((entity) => (
                  <button
                    key={entity.entity_id}
                    type="button"
                    disabled={addItem.isPending}
                    onClick={() => void handleAdd(entity)}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60 disabled:opacity-50"
                  >
                    <span className="truncate">{deriveCatalogueName(entity)}</span>
                    <span className="shrink-0 truncate text-xs text-muted-foreground">{entity.entity_id}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit device */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.name}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="catalogue-name">{t("name")}</Label>
              <Input
                id="catalogue-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={120}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="catalogue-room">{t("roomPicker")}</Label>
              {roomsLoading ? (
                // "No rooms yet" is a claim about the household's data, not
                // about the query's state — rendering it before the query
                // has resolved would tell a household with rooms that it
                // has none, for exactly as long as the request takes.
                <Skeleton className="h-9 w-full rounded-md" />
              ) : roomsError ? (
                // A failed request is not evidence the household has no
                // rooms — it's evidence we don't know. Say that, rather
                // than "no rooms yet" (which invites leaving to go create
                // ones that already exist) or silently falling back to an
                // empty picker.
                <p className="text-sm text-muted-foreground">{t("roomsUnavailable")}</p>
              ) : rooms.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("noRoomsYet")}{" "}
                  <Link href="/settings/homeassistant/rooms" className="underline underline-offset-2">
                    {t("noRoomsLink")}
                  </Link>
                </p>
              ) : (
                <Select
                  value={resolvedEditRoomId ?? "none"}
                  onValueChange={(value) => setEditRoomId(value === "none" ? null : value)}
                >
                  <SelectTrigger id="catalogue-room">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("roomNone")}</SelectItem>
                    {rooms.map((room) => (
                      <SelectItem key={room.id} value={room.id}>
                        {room.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t("image")}</Label>
              <DeviceImagePicker
                value={editImage}
                onChange={setEditImage}
                seedQuery={editName}
                familyId={family?.id}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {tCommon("cancel")}
            </Button>
            {/* Also disabled while the room list is unknown (loading or
                errored) — not because Save writes the wrong thing in that
                window (resolvedEditRoomId already guards that), but so the
                window where it even could isn't reachable at all. */}
            <Button
              disabled={!editName.trim() || updateItem.isPending || roomsUnknown}
              onClick={() => void saveEdit()}
            >
              {updateItem.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              {tCommon("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function DeviceRow({
  item,
  roomLabel,
  state,
  t,
  tCommon,
  onEdit,
  onDelete,
}: {
  item: CatalogueItem;
  /**
   * The heading of the group this row is rendered under — resolved from
   * `room_id` by the caller, never from the legacy `room` text. Passed in
   * rather than looked up again here so there is exactly one place on this
   * page that decides a device's room. A skeleton, not text, while the
   * caller doesn't know the answer yet (rooms still loading) — showing
   * "No room" before that is known is the same lie as the picker's, just
   * one row lower.
   */
  roomLabel: ReactNode;
  state: HAEntity | undefined;
  t: ReturnType<typeof useTranslations>;
  tCommon: ReturnType<typeof useTranslations>;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-background/50 p-3">
      <div className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-muted">
        {item.image_url ? (
          <img src={item.image_url} alt="" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center" title={t("imageNone")}>
            <ImageIcon className="size-5 text-muted-foreground/50" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{item.name}</p>
        {/* A `<div>`, not `<p>`: `roomLabel` is a skeleton (a `<div>`) while
            rooms are still loading, and a block element can't nest inside
            a paragraph without an invalid-HTML console error. */}
        <div className="truncate text-xs text-muted-foreground">{roomLabel}</div>
      </div>
      {item.kind === "ha_entity" && (
        <Badge variant={state ? "secondary" : "neutral"} className="shrink-0">
          {state ? state.state : t("unavailable")}
        </Badge>
      )}
      <Button variant="ghost" size="icon" onClick={onEdit} aria-label={`${tCommon("edit")} ${item.name}`}>
        <Pencil className="size-4" />
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive"
            aria-label={`${t("remove")} ${item.name}`}
          >
            <Trash2 className="size-4" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("remove")}</AlertDialogTitle>
            <AlertDialogDescription>{t("removeConfirm")}</AlertDialogDescription>
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
  );
}
