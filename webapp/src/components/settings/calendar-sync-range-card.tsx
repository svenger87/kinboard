"use client";

import { useTranslations } from "next-intl";
import { CalendarRange } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSetting, useUpdateSetting } from "@/hooks";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import {
  DEFAULT_CALENDAR_SYNC_RANGE_DAYS,
  type CalendarSyncRangeDays,
} from "@/lib/calendar-sync-range";

/**
 * Settings -> Calendar: how far ahead ICS and CalDAV calendars sync
 * (discussion #349). History stays fixed at 30 days; this only widens or
 * narrows the future side, for every ICS feed and CalDAV calendar in the
 * family, cron and "Sync now" alike (see lib/calendar-sync-range.ts). Google
 * already syncs +/-365 days and is unaffected.
 */
export function CalendarSyncRangeCard() {
  const t = useTranslations("settings.calendarSyncRange");
  const { data } = useSetting<CalendarSyncRangeDays>(
    SETTINGS_KEYS.calendarSyncRange,
    DEFAULT_CALENDAR_SYNC_RANGE_DAYS,
  );
  const current: CalendarSyncRangeDays = data ?? DEFAULT_CALENDAR_SYNC_RANGE_DAYS;
  const update = useUpdateSetting<CalendarSyncRangeDays>();

  const pick = (value: string) =>
    update.mutate({
      key: SETTINGS_KEYS.calendarSyncRange,
      value: Number(value) as CalendarSyncRangeDays,
    });

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-xl bg-primary/10 shrink-0">
          <CalendarRange className="size-6 text-primary" />
        </div>
        <div className="min-w-0">
          <h2 className="font-medium">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="calendar-sync-range">{t("label")}</Label>
        <Select value={String(current)} onValueChange={pick} disabled={update.isPending}>
          <SelectTrigger id="calendar-sync-range" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="60">{t("option60")}</SelectItem>
            <SelectItem value="180">{t("option180")}</SelectItem>
            <SelectItem value="365">{t("option365")}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t("hint")}</p>
      </div>
    </Card>
  );
}
