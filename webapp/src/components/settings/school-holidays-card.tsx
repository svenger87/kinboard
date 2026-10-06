"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarOff, Pencil, Plus, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  useCreateSchoolHoliday,
  useDeleteSchoolHoliday,
  useSchoolHolidays,
  useUpdateSchoolHoliday,
  type SchoolHoliday,
} from "@/hooks/use-supabase-queries";

/** "11.08.2026 – 21.08.2026", in the viewer's locale. */
function formatHolidayRange(startsOn: string, endsOn: string): string {
  const fmt = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString();
  return startsOn === endsOn ? fmt(startsOn) : `${fmt(startsOn)} – ${fmt(endsOn)}`;
}

/**
 * School holidays the family types in. Moved here from Settings → Schedule
 * unchanged (RFC-014 §4.2); the sources, badges and hide controls of §6.4
 * come later.
 *
 * The timetable is per weekday, so it cannot say "no school for six weeks"
 * — which is why the pack-the-bag reminder used to run all summer. These
 * ranges are what silence it.
 */
export function SchoolHolidaysCard() {
  const t = useTranslations("settings.schedule");
  // Synced rows are listed, read-only, by the sync section (RFC-014 §5);
  // this card edits the family's own, which are the only rows RLS lets the
  // browser change.
  const { data: allHolidays = [] } = useSchoolHolidays();
  const schoolHolidays = allHolidays.filter((h) => (h.source ?? "manual") === "manual");
  const createHoliday = useCreateSchoolHoliday();
  const updateHoliday = useUpdateSchoolHoliday();
  const deleteHoliday = useDeleteSchoolHoliday();
  const [holidayDialogOpen, setHolidayDialogOpen] = useState(false);
  const [editingHoliday, setEditingHoliday] = useState<SchoolHoliday | null>(null);
  const [holidayForm, setHolidayForm] = useState({ name: "", startsOn: "", endsOn: "" });

  // Both ends inclusive, so a single-day closure is start === end and stays
  // valid. Only the reversed case is rejected, which is also what the table's
  // CHECK enforces — the form says so before the database has to.
  const holidayRangeValid =
    !!holidayForm.startsOn && !!holidayForm.endsOn && holidayForm.endsOn >= holidayForm.startsOn;

  const openAddHolidayDialog = () => {
    setEditingHoliday(null);
    setHolidayForm({ name: "", startsOn: "", endsOn: "" });
    setHolidayDialogOpen(true);
  };

  const openEditHolidayDialog = (holiday: SchoolHoliday) => {
    setEditingHoliday(holiday);
    setHolidayForm({
      name: holiday.name,
      startsOn: holiday.starts_on,
      endsOn: holiday.ends_on,
    });
    setHolidayDialogOpen(true);
  };

  const handleSaveHoliday = async () => {
    if (!holidayForm.name.trim() || !holidayRangeValid) return;
    const payload = {
      name: holidayForm.name.trim(),
      starts_on: holidayForm.startsOn,
      ends_on: holidayForm.endsOn,
    };
    // Every other handler on this page reports a failed write; this one did
    // not, and a refused insert therefore looked exactly like a button that
    // does nothing — which is how it was reported. The dialog also has to stay
    // open on failure, so the typing is not thrown away.
    try {
      if (editingHoliday) {
        await updateHoliday.mutateAsync({ id: editingHoliday.id, ...payload });
      } else {
        await createHoliday.mutateAsync(payload);
      }
      setHolidayDialogOpen(false);
    } catch {
      toast.error(t("toastHolidaySaveFailed"));
    }
  };

  const handleDeleteHoliday = async (id: string) => {
    try {
      await deleteHoliday.mutateAsync(id);
    } catch {
      toast.error(t("toastHolidayDeleteFailed"));
    }
  };

  return (
    <>
      <Card id="school-holidays" data-setting="school-holidays" className="p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <CalendarOff className="size-4 text-muted-foreground" />
            <h2 className="font-semibold">{t("holidaysHeading")}</h2>
          </div>
          <Button variant="outline" size="sm" onClick={openAddHolidayDialog}>
            <Plus className="size-4 mr-1" />
            {t("addHolidayButton")}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground mb-4">{t("holidaysExplainer")}</p>
        {schoolHolidays.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("holidaysEmpty")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {schoolHolidays.map((holiday) => (
              <div
                key={holiday.id}
                className="flex items-center justify-between p-3 rounded-lg bg-muted/30 group"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{holiday.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatHolidayRange(holiday.starts_on, holiday.ends_on)}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-foreground"
                    onClick={() => openEditHolidayDialog(holiday)}
                    aria-label={t("editHolidayAria", { name: holiday.name })}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-destructive hover:text-destructive"
                    onClick={() => handleDeleteHoliday(holiday.id)}
                    aria-label={t("deleteHolidayAria", { name: holiday.name })}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Dialog open={holidayDialogOpen} onOpenChange={setHolidayDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>
              {editingHoliday ? t("holidayDialogTitleEdit") : t("holidayDialogTitleNew")}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 pt-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="holiday-name">{t("holidayNameLabel")}</Label>
              <Input
                id="holiday-name"
                placeholder={t("holidayNamePlaceholder")}
                value={holidayForm.name}
                onChange={(e) => setHolidayForm({ ...holidayForm, name: e.target.value })}
                autoFocus
              />
            </div>
            <div className="flex gap-3">
              <div className="flex flex-col gap-2 flex-1">
                <Label htmlFor="holiday-start">{t("holidayStartLabel")}</Label>
                <Input
                  id="holiday-start"
                  type="date"
                  value={holidayForm.startsOn}
                  onChange={(e) => setHolidayForm({ ...holidayForm, startsOn: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-2 flex-1">
                <Label htmlFor="holiday-end">{t("holidayEndLabel")}</Label>
                <Input
                  id="holiday-end"
                  type="date"
                  value={holidayForm.endsOn}
                  onChange={(e) => setHolidayForm({ ...holidayForm, endsOn: e.target.value })}
                />
              </div>
            </div>
            {/* Said before saving rather than surfacing the CHECK as an error. */}
            {holidayForm.startsOn && holidayForm.endsOn && !holidayRangeValid && (
              <p className="text-xs text-destructive">{t("holidayRangeInvalid")}</p>
            )}
            <p className="text-xs text-muted-foreground">{t("holidayInclusiveHint")}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHolidayDialogOpen(false)}>
              {t("cancelButton")}
            </Button>
            <Button
              onClick={handleSaveHoliday}
              disabled={!holidayForm.name.trim() || !holidayRangeValid}
            >
              {editingHoliday ? t("saveSubmitButton") : t("addSubmitButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
