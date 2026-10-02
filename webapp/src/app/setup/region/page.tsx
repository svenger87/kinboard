"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { WizardProgress } from "@/components/setup/wizard-progress";
import { WizardStepFooter } from "@/components/setup/wizard-step-footer";
import { HolidayRegionPicker } from "@/components/settings/holiday-region-picker";
import { useHolidayRegion, useSaveHolidayRegion, useSetting } from "@/hooks";
import { countryForTimeZone } from "@/lib/holidays/region";

/**
 * Where the family lives, first (RFC-014 §4.2). A country is preselected
 * from the family's timezone setting, or this device's when the family has
 * none (nothing writes that setting today -- plan ruling 7); never from the
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
          <HolidayRegionPicker value={value} onChange={setPicked} idPrefix="setup-region" disabled={saveRegion.isPending} />
          {picked === null && !setting?.code && guess && (
            <p className="mt-3 text-xs text-muted-foreground">{t("preselectedHint")}</p>
          )}
        </CardContent>
      </Card>
      <WizardStepFooter nextHref="/setup/people" onNextClick={handleNext} disabled={saveRegion.isPending || (!settled && picked === null)} />
    </>
  );
}
