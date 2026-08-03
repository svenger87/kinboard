"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations, useLocale } from "next-intl";
import {
  Server,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Info,
  RefreshCw,
  Lock,
  AlertTriangle,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { toast } from "sonner";
import {
  useCalendars,
  useCaldavDiscover,
  useCreateCaldavCalendar,
  useUpdateCaldavCalendar,
  useDeleteCaldavCalendar,
  useCaldavSync,
  usePeople,
} from "@/hooks";
import type { DiscoveredCaldavCalendar } from "@/hooks";
import type { Calendar } from "@/types/database";

/**
 * CalDAV settings — the read/write counterpart to /settings/ics.
 *
 * Two-step add flow, because CalDAV has no single "calendar URL" a user
 * can be expected to know: they give a server + login, we discover the
 * collections, they tick the ones they want. That mirrors how every
 * native calendar client onboards a CalDAV account.
 */

const PRESET_COLORS = [
  "#3b82f6",
  "#ec4899",
  "#a855f7",
  "#22c55e",
  "#f97316",
  "#06b6d4",
  "#eab308",
  "#ef4444",
  "#64748b",
];

interface ConnectionForm {
  serverUrl: string;
  username: string;
  password: string;
}

interface EditForm {
  name: string;
  color: string;
  person_id: string | null;
  is_holidays: boolean;
  is_waste_collection: boolean;
  password: string;
}

const emptyConnection = (): ConnectionForm => ({
  serverUrl: "",
  username: "",
  password: "",
});

export default function CaldavSettingsPage() {
  const t = useTranslations("settings.caldav");
  const tCommon = useTranslations("common");
  const locale = useLocale();

  const { data: allCalendars = [], isLoading } = useCalendars();
  const { data: people = [] } = usePeople();
  const discover = useCaldavDiscover();
  const createCalendar = useCreateCaldavCalendar();
  const updateCalendar = useUpdateCaldavCalendar();
  const deleteCalendar = useDeleteCaldavCalendar();
  const caldavSync = useCaldavSync();

  const caldavCalendars = allCalendars.filter((c) => c.caldav_url != null);

  // --- add flow -----------------------------------------------------
  const [addOpen, setAddOpen] = useState(false);
  const [connection, setConnection] = useState<ConnectionForm>(emptyConnection());
  const [discovered, setDiscovered] = useState<DiscoveredCaldavCalendar[] | null>(null);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);

  // --- edit flow ----------------------------------------------------
  const [editing, setEditing] = useState<Calendar | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);

  const alreadyAddedUrls = new Set(
    caldavCalendars.map((c) => c.caldav_url).filter(Boolean) as string[],
  );

  const openAddDialog = () => {
    setConnection(emptyConnection());
    setDiscovered(null);
    setDiscoverError(null);
    setSelectedUrls(new Set());
    setAddOpen(true);
  };

  const handleDiscover = async () => {
    setDiscoverError(null);
    setDiscovered(null);
    try {
      const calendars = await discover.mutateAsync({
        server_url: connection.serverUrl.trim(),
        username: connection.username.trim(),
        password: connection.password,
      });
      setDiscovered(calendars);
      // Pre-tick everything that isn't already connected — the common
      // case is "add all of them", and un-ticking is cheaper than ticking.
      setSelectedUrls(
        new Set(calendars.filter((c) => !alreadyAddedUrls.has(c.url)).map((c) => c.url)),
      );
    } catch (err) {
      setDiscoverError(err instanceof Error ? err.message : "Discovery failed");
    }
  };

  const handleAddSelected = async () => {
    if (!discovered) return;
    const toAdd = discovered.filter((c) => selectedUrls.has(c.url));
    if (toAdd.length === 0) return;

    setIsSaving(true);
    let added = 0;
    const failures: string[] = [];

    for (const [index, cal] of toAdd.entries()) {
      try {
        await createCalendar.mutateAsync({
          name: cal.displayName,
          color: cal.color ?? PRESET_COLORS[index % PRESET_COLORS.length],
          server_url: connection.serverUrl.trim(),
          calendar_url: cal.url,
          username: connection.username.trim(),
          password: connection.password,
          read_only: cal.readOnly,
        });
        added++;
      } catch (err) {
        failures.push(
          `${cal.displayName}: ${err instanceof Error ? err.message : "failed"}`,
        );
      }
    }
    setIsSaving(false);

    if (added > 0) toast.success(t("toastAdded", { count: added }));
    if (failures.length > 0) {
      toast.error(t("toastAddFailed"), { description: failures.join("; ") });
    }
    if (failures.length === 0) setAddOpen(false);
  };

  const openEditDialog = (cal: Calendar) => {
    setEditing(cal);
    setEditForm({
      name: cal.name,
      color: cal.color,
      person_id: cal.person_id,
      is_holidays: cal.is_holidays,
      is_waste_collection: cal.is_waste_collection,
      password: "",
    });
  };

  const handleSaveEdit = () => {
    if (!editing || !editForm || !editForm.name.trim()) return;
    updateCalendar.mutate(
      {
        calendar_id: editing.id,
        name: editForm.name.trim(),
        color: editForm.color,
        person_id: editForm.person_id,
        is_holidays: editForm.is_holidays,
        is_waste_collection: editForm.is_waste_collection,
        ...(editForm.password ? { password: editForm.password } : {}),
      },
      {
        onSuccess: () => {
          toast.success(t("toastUpdated"));
          setEditing(null);
        },
        onError: (err) => {
          toast.error(t("toastError"), { description: err.message });
        },
      },
    );
  };

  const handleDelete = (calId: string) => {
    deleteCalendar.mutate(calId, {
      onSuccess: () => toast.success(t("toastDeleted")),
      onError: (err) => toast.error(t("toastError"), { description: err.message }),
    });
  };

  const handleSyncNow = async () => {
    try {
      const result = await caldavSync.mutateAsync();
      toast.success(t("syncSuccessTitle"), {
        description: t("syncSuccessBody", {
          succeeded: result.succeeded,
          failed: result.failed,
        }),
      });
    } catch (err) {
      toast.error(t("syncErrorTitle"), {
        description: err instanceof Error ? err.message : "",
      });
    }
  };

  const formatLastSynced = (ts: string | null) => {
    if (!ts) return t("neverSynced");
    return t("lastSynced", { time: new Date(ts).toLocaleString(locale) });
  };

  const toggleSelected = (url: string) => {
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const canDiscover =
    connection.serverUrl.trim().length > 0 &&
    connection.username.trim().length > 0 &&
    connection.password.length > 0;

  return (
    <main
      id="main-content"
      className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset"
    >
      <div className="relative z-10 max-w-2xl mx-auto flex flex-col gap-6">
        <PageHeader
          icon={Server}
          title={t("title")}
          subtitle={t("subtitle")}
          backHref="/settings/calendar"
          actions={
            <div className="flex items-center gap-2">
              {caldavCalendars.length > 0 && (
                <Button
                  onClick={handleSyncNow}
                  size="sm"
                  variant="outline"
                  disabled={caldavSync.isPending}
                  aria-label={t("syncNow")}
                >
                  <RefreshCw
                    className={`size-4 mr-2 ${caldavSync.isPending ? "animate-spin" : ""}`}
                  />
                  {caldavSync.isPending ? t("syncing") : t("syncNow")}
                </Button>
              )}
              <Button onClick={openAddDialog} size="sm">
                <Plus className="size-4 mr-2" />
                {t("addButton")}
              </Button>
            </div>
          }
        />

        {isLoading ? (
          <Card className="p-4 space-y-3">
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </Card>
        ) : caldavCalendars.length === 0 ? (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="p-10 text-center">
              <div className="flex flex-col items-center gap-3">
                <div className="p-3 rounded-xl bg-primary/10">
                  <Server className="size-8 text-primary" strokeWidth={1.5} />
                </div>
                <p className="font-medium">{t("emptyTitle")}</p>
                <p className="text-sm text-muted-foreground max-w-xs">
                  {t("emptyDescription")}
                </p>
                <Button onClick={openAddDialog} className="mt-2">
                  <Plus className="size-4 mr-2" />
                  {t("addButton")}
                </Button>
              </div>
            </Card>
          </motion.div>
        ) : (
          <Card className="divide-y divide-border/50">
            <AnimatePresence initial={false}>
              {caldavCalendars.map((cal) => (
                <motion.div
                  key={cal.id}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="p-4 flex items-start gap-4"
                >
                  <div
                    className="mt-1 size-4 rounded-full shrink-0"
                    style={{ backgroundColor: cal.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium truncate">{cal.name}</p>
                      {cal.caldav_read_only && (
                        <Badge variant="secondary" className="text-xs shrink-0">
                          <Lock className="size-3 mr-1" />
                          {t("readOnlyBadge")}
                        </Badge>
                      )}
                      {cal.is_holidays && (
                        <Badge variant="secondary" className="text-xs shrink-0">
                          {t("holidaysBadge")}
                        </Badge>
                      )}
                      {cal.is_waste_collection && (
                        <Badge variant="secondary" className="text-xs shrink-0">
                          {t("wasteBadge")}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatLastSynced(cal.last_synced_at)}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-0.5 font-mono">
                      {cal.caldav_server_url ?? cal.caldav_url}
                    </p>
                    {cal.caldav_last_error && (
                      <p className="text-xs text-destructive mt-1 flex items-start gap-1.5">
                        <AlertTriangle className="size-3.5 shrink-0 mt-px" />
                        <span className="min-w-0">{cal.caldav_last_error}</span>
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => openEditDialog(cal)}
                      aria-label={t("editAria", { name: cal.name })}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive hover:text-destructive"
                          aria-label={t("deleteAria", { name: cal.name })}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {t("deleteDescription")}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => handleDelete(cal.id)}
                          >
                            {t("deleteConfirm")}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </Card>
        )}
      </div>

      {/* Add: connect → pick calendars */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("dialogAddTitle")}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="caldav-server">{t("serverLabel")}</Label>
              <Input
                id="caldav-server"
                value={connection.serverUrl}
                onChange={(e) => {
                  setConnection((c) => ({ ...c, serverUrl: e.target.value }));
                  setDiscovered(null);
                  setDiscoverError(null);
                }}
                placeholder={t("serverPlaceholder")}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">{t("serverHint")}</p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="caldav-username">{t("usernameLabel")}</Label>
              <Input
                id="caldav-username"
                value={connection.username}
                onChange={(e) => {
                  setConnection((c) => ({ ...c, username: e.target.value }));
                  setDiscovered(null);
                }}
                autoComplete="username"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="caldav-password">{t("passwordLabel")}</Label>
              <Input
                id="caldav-password"
                type="password"
                value={connection.password}
                onChange={(e) => {
                  setConnection((c) => ({ ...c, password: e.target.value }));
                  setDiscovered(null);
                }}
                autoComplete="new-password"
              />
              <div className="flex items-start gap-2 rounded-lg bg-primary/5 border border-primary/10 p-3 text-xs text-muted-foreground">
                <Info className="size-3.5 mt-0.5 text-primary shrink-0" />
                <span>{t("appPasswordTip")}</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDiscover}
                disabled={!canDiscover || discover.isPending}
              >
                {discover.isPending ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    {t("connectingLabel")}
                  </>
                ) : (
                  t("connectButton")
                )}
              </Button>
              {discoverError && (
                <span className="text-sm text-destructive">{discoverError}</span>
              )}
            </div>

            {discovered && discovered.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("noCalendarsFound")}</p>
            )}

            {discovered && discovered.length > 0 && (
              <div className="grid gap-2">
                <Label>{t("pickCalendarsLabel")}</Label>
                <div className="rounded-lg border border-border divide-y divide-border/50 max-h-64 overflow-y-auto">
                  {discovered.map((cal) => {
                    const already = alreadyAddedUrls.has(cal.url);
                    return (
                      <label
                        key={cal.url}
                        className={`flex items-center gap-3 p-3 ${
                          already ? "opacity-50" : "cursor-pointer"
                        }`}
                      >
                        <Checkbox
                          checked={selectedUrls.has(cal.url)}
                          disabled={already}
                          onCheckedChange={() => toggleSelected(cal.url)}
                        />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-medium truncate">
                            {cal.displayName}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {already
                              ? t("alreadyAdded")
                              : cal.readOnly
                                ? t("readOnlyHint")
                                : t("readWriteHint")}
                          </span>
                        </span>
                        {cal.color && (
                          <span
                            className="size-4 rounded-full shrink-0"
                            style={{ backgroundColor: cal.color }}
                          />
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              {tCommon("cancel")}
            </Button>
            <Button
              onClick={handleAddSelected}
              disabled={!discovered || selectedUrls.size === 0 || isSaving}
            >
              {isSaving ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  {t("savingLabel")}
                </>
              ) : (
                t("addSelectedButton", { count: selectedUrls.size })
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit an existing calendar */}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("dialogEditTitle")}</DialogTitle>
          </DialogHeader>

          {editForm && (
            <div className="flex flex-col gap-4 py-2">
              <div className="grid gap-1.5">
                <Label htmlFor="caldav-edit-name">{t("nameLabel")}</Label>
                <Input
                  id="caldav-edit-name"
                  value={editForm.name}
                  onChange={(e) =>
                    setEditForm((f) => f && { ...f, name: e.target.value })
                  }
                />
              </div>

              <div className="grid gap-1.5">
                <Label>{t("colorLabel")}</Label>
                <div className="flex flex-wrap gap-2">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setEditForm((f) => f && { ...f, color: c })}
                      className="size-7 rounded-full ring-offset-2 ring-offset-background transition-all"
                      style={{
                        backgroundColor: c,
                        outline:
                          editForm.color === c ? `3px solid ${c}` : "3px solid transparent",
                      }}
                    />
                  ))}
                  <input
                    type="color"
                    value={editForm.color}
                    onChange={(e) =>
                      setEditForm((f) => f && { ...f, color: e.target.value })
                    }
                    className="size-7 rounded-full border border-border cursor-pointer bg-transparent p-0"
                    title={t("customColorTitle")}
                  />
                </div>
              </div>

              <div className="grid gap-1.5">
                <Label>{t("personLabel")}</Label>
                <Select
                  value={editForm.person_id ?? "none"}
                  onValueChange={(v) =>
                    setEditForm((f) => f && { ...f, person_id: v === "none" ? null : v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("personPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("personPlaceholder")}</SelectItem>
                    {people.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="caldav-holidays" className="font-normal">
                    {t("isHolidaysLabel")}
                  </Label>
                  <Switch
                    id="caldav-holidays"
                    checked={editForm.is_holidays}
                    onCheckedChange={(v) =>
                      setEditForm((f) => f && { ...f, is_holidays: v })
                    }
                  />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="caldav-waste" className="font-normal">
                    {t("isWasteLabel")}
                  </Label>
                  <Switch
                    id="caldav-waste"
                    checked={editForm.is_waste_collection}
                    onCheckedChange={(v) =>
                      setEditForm((f) => f && { ...f, is_waste_collection: v })
                    }
                  />
                </div>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="caldav-new-password">{t("rotatePasswordLabel")}</Label>
                <Input
                  id="caldav-new-password"
                  type="password"
                  value={editForm.password}
                  onChange={(e) =>
                    setEditForm((f) => f && { ...f, password: e.target.value })
                  }
                  placeholder={t("rotatePasswordPlaceholder")}
                  autoComplete="new-password"
                />
                <p className="text-xs text-muted-foreground">{t("rotatePasswordHint")}</p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {tCommon("cancel")}
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={!editForm?.name.trim() || updateCalendar.isPending}
            >
              {updateCalendar.isPending ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  {t("savingLabel")}
                </>
              ) : (
                t("saveButton")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
