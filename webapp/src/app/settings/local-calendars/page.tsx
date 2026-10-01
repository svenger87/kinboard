"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import { CalendarPlus, Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  useCreateCalendar,
  useUpdateCalendar,
  useDeleteCalendar,
  usePeople,
} from "@/hooks";
import { isLocalCalendar } from "@/lib/local-calendars";
import type { Calendar } from "@/types/database";

// The same swatches as the ICS page, so a household's calendars share one set.
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

interface FormState {
  name: string;
  color: string;
  person_id: string | null;
}

const emptyForm = (): FormState => ({
  name: "",
  color: PRESET_COLORS[0],
  person_id: null,
});

/**
 * Calendars that live only in Kinboard.
 *
 * Every event belongs to a calendar, and the only calendars a household could
 * get were ones it connected: Google, CalDAV or an ICS feed. Without any of
 * those the calendar page said "No calendars yet" and the event editor would
 * not save. A local calendar is just a row with no source, which the event
 * editor and every sync path already handle.
 */
export default function LocalCalendarsSettingsPage() {
  const t = useTranslations("settings.localCalendars");
  const tCommon = useTranslations("common");

  const { data: allCalendars = [], isLoading } = useCalendars();
  const { data: people = [] } = usePeople();
  const createCalendar = useCreateCalendar();
  const updateCalendar = useUpdateCalendar();
  const deleteCalendar = useDeleteCalendar();

  const localCalendars = useMemo(() => allCalendars.filter(isLocalCalendar), [allCalendars]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Calendar | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());

  const isSaving = createCalendar.isPending || updateCalendar.isPending;

  const openAddDialog = () => {
    setEditing(null);
    setForm(emptyForm());
    setDialogOpen(true);
  };

  const openEditDialog = (cal: Calendar) => {
    setEditing(cal);
    setForm({ name: cal.name, color: cal.color, person_id: cal.person_id });
    setDialogOpen(true);
  };

  const handleSave = () => {
    const name = form.name.trim();
    if (!name) return;
    const callbacks = (message: string) => ({
      onSuccess: () => {
        toast.success(message);
        setDialogOpen(false);
      },
      onError: () => {
        toast.error(t("toastError"));
      },
    });

    if (editing) {
      updateCalendar.mutate(
        { id: editing.id, name, color: form.color, person_id: form.person_id },
        callbacks(t("toastUpdated")),
      );
    } else {
      createCalendar.mutate(
        { name, color: form.color, person_id: form.person_id },
        callbacks(t("toastAdded")),
      );
    }
  };

  const handleDelete = (calId: string) => {
    deleteCalendar.mutate(calId, {
      onSuccess: () => {
        toast.success(t("toastDeleted"));
      },
      onError: () => {
        toast.error(t("toastError"));
      },
    });
  };

  const personName = (id: string | null) => people.find((p) => p.id === id)?.name ?? null;

  return (
    <main
      id="main-content"
      className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset"
    >
      <div className="relative z-10 max-w-2xl mx-auto flex flex-col gap-6">
        <PageHeader
          icon={CalendarPlus}
          title={t("title")}
          subtitle={t("subtitle")}
          actions={
            <Button onClick={openAddDialog} size="sm">
              <Plus className="size-4 mr-2" />
              {t("addButton")}
            </Button>
          }
        />

        {isLoading ? (
          <Card className="p-4 space-y-3">
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </Card>
        ) : localCalendars.length === 0 ? (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="p-10 text-center">
              <div className="flex flex-col items-center gap-3">
                <div className="p-3 rounded-xl bg-primary/10">
                  <CalendarPlus className="size-8 text-primary" strokeWidth={1.5} />
                </div>
                <p className="font-medium">{t("emptyTitle")}</p>
                <p className="text-sm text-muted-foreground max-w-xs">{t("emptyDescription")}</p>
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
              {localCalendars.map((cal) => (
                <motion.div
                  key={cal.id}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-center gap-3 p-4"
                >
                  <span
                    className="size-3 rounded-full shrink-0"
                    style={{ backgroundColor: cal.color }}
                    aria-hidden="true"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium truncate">{cal.name}</p>
                      {personName(cal.person_id) && (
                        <Badge variant="secondary" className="text-xs shrink-0">
                          {personName(cal.person_id)}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{t("onlyInKinboard")}</p>
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
                          <AlertDialogDescription>{t("deleteDescription")}</AlertDialogDescription>
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? t("dialogEditTitle") : t("dialogAddTitle")}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-5 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="local-calendar-name">{t("nameLabel")}</Label>
              <Input
                id="local-calendar-name"
                value={form.name}
                placeholder={t("namePlaceholder")}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                }}
              />
            </div>

            <div className="grid gap-1.5">
              <Label>{t("colorLabel")}</Label>
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, color: c }))}
                    className="size-7 rounded-full ring-offset-2 ring-offset-background transition-all"
                    style={{
                      backgroundColor: c,
                      outline: form.color === c ? `3px solid ${c}` : "3px solid transparent",
                    }}
                    aria-label={c}
                    aria-pressed={form.color === c}
                  />
                ))}
                <input
                  type="color"
                  value={form.color}
                  onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                  className="size-7 rounded-full border border-border cursor-pointer bg-transparent p-0"
                  title={t("customColorTitle")}
                  aria-label={t("customColorTitle")}
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label>{t("personLabel")}</Label>
              <Select
                value={form.person_id ?? "none"}
                onValueChange={(v) => setForm((f) => ({ ...f, person_id: v === "none" ? null : v }))}
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
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {tCommon("cancel")}
            </Button>
            <Button onClick={handleSave} disabled={!form.name.trim() || isSaving}>
              {isSaving && <Loader2 className="size-4 mr-2 animate-spin" />}
              {editing ? t("saveButton") : t("addSubmitButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
