"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { FestivalVisitor } from "@/components/weather-effects";
import { useSetting, useUpdateSetting } from "@/hooks/use-supabase-queries";
import { useHolidayRegion } from "@/hooks/use-holiday-region";
import { startFestivalPreview, stopFestivalPreview, useFestival } from "@/hooks/use-festival";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { commonFestivals, type FestivalId } from "@/lib/festivals";
import {
  BUILT_FESTIVALS,
  DEFAULT_FESTIVAL_SETTINGS,
  normalizeFestivalSettings,
  type FestivalSettings,
} from "@/lib/festival-settings";

/**
 * Settings -> Design -> Festivals (RFC-020 §4): the family's festivals, one
 * switch for all of them, and a Preview per festival that shows its scene
 * right here, over this page, whatever the date. The list starts with the
 * country's common festivals ticked (§3.1, from the holiday region) and
 * follows the region until someone ticks or unticks one.
 */
export function FestivalSettingsCard() {
  const t = useTranslations("settings.theme");
  const { data: stored } = useSetting<unknown>(SETTINGS_KEYS.festivals, DEFAULT_FESTIVAL_SETTINGS);
  const update = useUpdateSetting();
  const { region } = useHolidayRegion();
  const [value, setValue] = useState<FestivalSettings>(() => normalizeFestivalSettings(stored));
  useEffect(() => setValue(normalizeFestivalSettings(stored)), [stored]);
  const common = useMemo(() => commonFestivals(region), [region]);
  const ticked = new Set<FestivalId>(value.chosen ?? common);
  const shown = useFestival();
  const previewing = shown?.preview ? shown.id : null;
  // A preview started here ends when the page does.
  useEffect(() => () => stopFestivalPreview(), []);

  const save = async (next: FestivalSettings) => {
    const before = value;
    setValue(next);
    try {
      await update.mutateAsync({ key: SETTINGS_KEYS.festivals, value: next });
    } catch {
      setValue(before);
      toast.error(t("festivalsSaveFailed"));
    }
  };

  const tick = (id: FestivalId, on: boolean) => {
    // The first change makes the list the family's own: it stops following the region.
    const list = new Set(value.chosen ?? common);
    if (on) list.add(id);
    else list.delete(id);
    void save({ ...value, chosen: [...list] });
  };

  return (
    <Card className="p-4">
      {previewing && <FestivalVisitor key={previewing} />}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Label htmlFor="festivals-enabled" className="mb-1 flex items-center gap-2">
            <PartyPopper className="size-4 text-primary" />
            {t("festivalsLabel")}
          </Label>
          <p className="text-xs text-muted-foreground">{t("festivalsHint")}</p>
        </div>
        <Switch
          id="festivals-enabled"
          checked={value.enabled}
          onCheckedChange={(enabled) => void save({ ...value, enabled })}
          disabled={update.isPending}
        />
      </div>

      {value.enabled && (
        <div className="mt-4">
          <p className="mb-2 text-xs text-muted-foreground">
            {value.chosen === null ? t("festivalsCommonHint") : t("festivalsOwnHint")}
          </p>
          <ul className="divide-y divide-border rounded-lg border">
            {BUILT_FESTIVALS.map((id) => (
              <li key={id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <Label htmlFor={`festival-${id}`} className="text-sm">
                    {t(`festivalName.${id}` as never)}
                  </Label>
                  <p className="text-xs text-muted-foreground">{t(`festivalWhen.${id}` as never)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Button
                    type="button"
                    variant={previewing === id ? "outline" : "ghost"}
                    size="sm"
                    className="h-8 px-2 text-xs"
                    aria-pressed={previewing === id}
                    onClick={() => (previewing === id ? stopFestivalPreview() : startFestivalPreview(id))}
                    data-testid={`festival-preview-${id}`}
                  >
                    {previewing === id ? t("festivalsPreviewStop") : t("festivalsPreview")}
                  </Button>
                  <Switch
                    id={`festival-${id}`}
                    checked={ticked.has(id)}
                    onCheckedChange={(on) => tick(id, on)}
                    disabled={update.isPending}
                  />
                </div>
              </li>
            ))}
          </ul>
          {value.chosen !== null && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="mt-2 h-auto px-0 text-xs"
              onClick={() => void save({ ...value, chosen: null })}
              disabled={update.isPending}
            >
              {t("festivalsResetToCountry")}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
