"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { CalendarHeart } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { format } from "date-fns";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { HolidayRegionPicker } from "@/components/settings/holiday-region-picker";
import { SchoolHolidaysCard } from "@/components/settings/school-holidays-card";
import { SchoolHolidaySyncSection } from "@/components/settings/school-holiday-sync-section";
import { useHolidayRegion, useSaveHolidayRegion, useToday } from "@/hooks";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { nextHolidays } from "@/lib/holidays";
import { holidayLabel } from "@/lib/holidays/label";

const external = (href: string) =>
  function ExternalLink(chunks: React.ReactNode) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">
        {chunks}
      </a>
    );
  };

/**
 * Where the family's holidays come from (RFC-014 §4.2): the country and
 * state for public holidays, and the school holidays typed in by hand.
 * Picking or keeping a region records that someone chose it.
 */
export default function HolidaySettingsPage() {
  const t = useTranslations("settings.holidays");
  const tSync = useTranslations("settings.holidays.sync");
  const tHolidays = useTranslations("holidays");
  const locale = useLocale();
  const dateLocale = getDateFnsLocale(locale);
  const today = useToday();
  const { setting, region } = useHolidayRegion();
  const saveRegion = useSaveHolidayRegion();

  async function save(code: string) {
    try {
      const { outcome } = await saveRegion.mutateAsync(code);
      // The pick also fetched the school holidays, or tried to (RFC-014 §5.4).
      if (outcome?.status === "failed") toast.error(tSync("syncFailed"));
      if (outcome?.status === "rate-limited") toast(tSync("rateLimitedAfterPick"));
    } catch {
      toast.error(t("saveError"));
    }
  }

  const preview = useMemo(
    // Ask for more than five: marked days that are not off (Christmas Eve,
    // Leopold in Lower Austria) are dropped, and five should remain.
    () => (region ? nextHolidays(region, new Date(today), 15, locale).filter((h) => h.dayOff).slice(0, 5) : []),
    [region, today, locale],
  );

  return (
    <main id="main-content" className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="relative z-10 max-w-2xl mx-auto">
        <PageHeader title={t("title")} subtitle={t("subtitle")} icon={CalendarHeart} />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="flex flex-col gap-4"
        >
          <Card id="region" data-setting="region" className="p-6">
            <h2 id="holiday-region-heading" className="font-medium text-sm">
              {t("regionLabel")}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5 mb-4">{t("regionDescription")}</p>
            <HolidayRegionPicker value={setting?.code ?? null} onChange={save} disabled={saveRegion.isPending} />

            {setting && !setting.chosen && setting.code && (
              <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-muted/40 p-3">
                <p className="min-w-0 flex-1 basis-56 text-sm">{t("notChosenNotice")}</p>
                <Button size="sm" onClick={() => save(setting.code!)} disabled={saveRegion.isPending}>
                  {t("keepButton")}
                </Button>
              </div>
            )}

            {preview.length > 0 && (
              <div className="mt-6">
                <p className="text-xs font-medium text-muted-foreground mb-2">{t("previewHeading")}</p>
                <ul className="flex flex-col gap-1.5" data-testid="holiday-preview">
                  {preview.map((h) => (
                    <li key={`${h.nameKey || h.name}-${h.date.getTime()}`} className="flex items-baseline gap-2 text-sm">
                      <span aria-hidden="true">{h.emoji}</span>
                      <span className="min-w-0 flex-1 break-words hyphens-auto">{holidayLabel(h, tHolidays)}</span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {format(h.date, "EEE, d. MMM", { locale: dateLocale }).replace(/ /g, "\u00a0")}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="mt-6 text-xs text-muted-foreground">{t("subRegionNote")}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              {t.rich("attribution", {
                dh: external("https://github.com/commenthol/date-holidays"),
                lic: external("https://creativecommons.org/licenses/by-sa/3.0/"),
              })}
            </p>
          </Card>

          <SchoolHolidaySyncSection />

          <SchoolHolidaysCard />
        </motion.div>
      </div>
    </main>
  );
}
