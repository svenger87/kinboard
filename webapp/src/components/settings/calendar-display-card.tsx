"use client";

import { useTranslations } from "next-intl";
import { CalendarCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSetting, useUpdateSetting } from "@/hooks";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { DEFAULT_CALENDAR_DISPLAY, type CalendarDisplaySettings } from "@/lib/calendar-markers";

/**
 * Settings -> Calendar: what the calendar marks on a day besides events.
 * Family-wide, like the widgets on the home screen, and off until switched on.
 */
export function CalendarDisplayCard() {
  const t = useTranslations("settings.calendarDisplay");
  const { data } = useSetting<CalendarDisplaySettings>(
    SETTINGS_KEYS.calendarDisplay,
    DEFAULT_CALENDAR_DISPLAY,
  );
  const update = useUpdateSetting<CalendarDisplaySettings>();
  const current: CalendarDisplaySettings = { ...DEFAULT_CALENDAR_DISPLAY, ...(data ?? {}) };

  const set = (patch: Partial<CalendarDisplaySettings>) =>
    update.mutate({ key: SETTINGS_KEYS.calendarDisplay, value: { ...current, ...patch } });

  const rows: { id: string; label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }[] = [
    {
      id: "calendar-show-holidays",
      label: t("holidaysLabel"),
      hint: t("holidaysHint"),
      checked: current.showHolidays,
      onChange: (v) => set({ showHolidays: v }),
    },
    {
      id: "calendar-holidays-as-events",
      label: t("holidaysAsEventsLabel"),
      hint: t("holidaysAsEventsHint"),
      checked: current.holidaysAsEvents,
      onChange: (v) => set({ holidaysAsEvents: v }),
    },
    {
      id: "calendar-show-tasks",
      label: t("tasksLabel"),
      hint: t("tasksHint"),
      checked: current.showTasks,
      onChange: (v) => set({ showTasks: v }),
    },
    {
      id: "calendar-tasks-as-events",
      label: t("tasksAsEventsLabel"),
      hint: t("tasksAsEventsHint"),
      checked: current.tasksAsEvents,
      onChange: (v) => set({ tasksAsEvents: v }),
    },
  ];

  return (
    <Card id="display" data-setting="display" className="p-5 space-y-4">
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-xl bg-primary/10 shrink-0">
          <CalendarCheck className="size-6 text-primary" />
        </div>
        <div className="min-w-0">
          <h2 className="font-medium">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
      </div>
      {rows.map((row) => (
        <div key={row.id} className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Label htmlFor={row.id} className="font-medium">
              {row.label}
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">{row.hint}</p>
          </div>
          <Switch
            id={row.id}
            checked={row.checked}
            onCheckedChange={row.onChange}
            disabled={update.isPending}
            aria-label={row.label}
          />
        </div>
      ))}
    </Card>
  );
}
