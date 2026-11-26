"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { WizardProgress } from "@/components/setup/wizard-progress";
import { WizardStepFooter } from "@/components/setup/wizard-step-footer";
import { HolidayRegionPicker } from "@/components/settings/holiday-region-picker";
import { TimeZonePicker } from "@/components/settings/time-zone-picker";
import { useDeleteSetting, useHolidayRegion, useSaveHolidayRegion, useSetting, useUpdateSetting } from "@/hooks";
import { countryForTimeZone } from "@/lib/holidays/region";
import { isValidTimeZone } from "@/lib/integration-event-input";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { LocaleSwitcher } from "@/components/locale-switcher";

/**
 * Language, time zone and where the family lives (RFC-014 §4.2, RFC-024 §8):
 * the same controls as Settings → Language and Settings → Holidays. A country is preselected
 * from the family's timezone setting (set just above, or in Settings →
 * Language), or this device's when the family has none; never from the
 * language, because a German-speaking family may live in Vienna or Zürich.
 * Skipping leaves the region unset: no holidays rather than wrong ones.
 *
 * Nothing is guessed, and Next waits, until both settings have loaded: a
 * guess from this device's zone saved by a quick Next would otherwise beat
 * the family's own timezone, or overwrite a region already saved. A guessed
 * bare country saved as it is gets the board's one-time "Which state are
 * you in?" (the holiday-region rule asks once more for a country-only pick).
 */
export default function SetupRegionPage() {
  const t = useTranslations("setup.region");
  const { setting, isLoading: regionLoading } = useHolidayRegion();
  const { data: familyZone, isLoading: zoneLoading } = useSetting<unknown>("timezone", null);
  const settled = !regionLoading && !zoneLoading;
  const saveRegion = useSaveHolidayRegion();
  const [picked, setPicked] = useState<string | null>(null);

  const guess = useMemo(() => {
    if (!settled) return null;
    const zone = typeof familyZone === "string" ? familyZone : Intl.DateTimeFormat().resolvedOptions().timeZone;
    return countryForTimeZone(zone);
  }, [familyZone, settled]);

  const value = picked ?? setting?.code ?? guess;

  // Time zone: absent is the server's own (Settings → Language). A zone
  // picked here also moves the suggested country below.
  const familyZoneValue = isValidTimeZone(familyZone) ? familyZone : null;
  const { data: serverZone } = useQuery({
    queryKey: ["server-time-zone"],
    queryFn: async () => {
      const res = await fetch("/api/time-zone");
      if (!res.ok) throw new Error("Failed to load the server's time zone");
      return ((await res.json()) as { server: string }).server;
    },
    staleTime: Infinity,
  });
  const updateZone = useUpdateSetting<string>();
  const deleteZone = useDeleteSetting();
  const [zoneSaving, setZoneSaving] = useState(false);
  const pickZone = async (zone: string | null) => {
    if (zone === familyZoneValue || zoneSaving) return;
    setZoneSaving(true);
    try {
      if (zone === null) await deleteZone.mutateAsync(SETTINGS_KEYS.timezone);
      else await updateZone.mutateAsync({ key: SETTINGS_KEYS.timezone, value: zone });
    } catch (err) {
      console.error("setup/region: time zone failed:", err);
      toast.error(t("saveError"));
    } finally {
      setZoneSaving(false);
    }
  };

  const handleNext = async () => {
    // Continue with nothing picked behaves like Skip.
    if (!value) return;
    try {
      await saveRegion.mutateAsync(value);
    } catch (err) {
      console.error("setup/region: save failed:", err);
      toast.error(t("saveError"));
      throw err;
    }
  };

  return (
    <>
      <WizardProgress current="region" />
      <Card>
        <CardContent className="p-6 md:p-8">
          <h1 className="text-2xl font-display tracking-tight mb-2">{t("title")}</h1>
          <p className="text-muted-foreground text-sm mb-6">{t("description")}</p>

          <div className="mb-6" data-testid="setup-language">
            <p className="text-sm font-medium mb-2">{t("languageLabel")}</p>
            {/* The header's switcher, here too: it writes the family's language,
                which push notifications use, and never moves the region guess. */}
            <LocaleSwitcher />
          </div>

          <div className="mb-6" data-testid="setup-time-zone">
            <p className="text-sm font-medium mb-1">{t("timeZoneLabel")}</p>
            <p className="text-xs text-muted-foreground mb-3">{t("timeZoneDescription")}</p>
            <TimeZonePicker value={familyZoneValue} serverZone={serverZone} onPick={pickZone} disabled={zoneSaving} />
          </div>

          <p className="text-sm font-medium mb-2">{t("regionLabel")}</p>
          <HolidayRegionPicker value={value} onChange={setPicked} idPrefix="setup-region" disabled={saveRegion.isPending} />
          {picked === null && !setting?.code && guess && (
            <p className="mt-3 text-xs text-muted-foreground">{t("preselectedHint")}</p>
          )}
        </CardContent>
      </Card>
      <WizardStepFooter step="region" onNextClick={handleNext} disabled={saveRegion.isPending || (!settled && picked === null)} />
    </>
  );
}
