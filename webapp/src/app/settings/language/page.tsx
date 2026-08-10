"use client";

import { motion } from "framer-motion";
import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSetting, useUpdateSetting } from "@/hooks";
import { DEFAULT_WEEK_START, type WeekStartPreference } from "@/hooks/use-week-start";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { COUNTRIES, DEFAULT_COUNTRY, type CountryCode } from "@/lib/holidays";
import { LOCALES } from "@/i18n/locales";
import { postLocale } from "@/lib/locale-client";
import { useFamilyStore } from "@/stores/family-store";

export default function LanguageSettingsPage() {
  const t = useTranslations("settings.language");
  const current = useLocale();
  const router = useRouter();
  const { family } = useFamilyStore();
  const [pending, setPending] = useState<string | null>(null);

  const { data: savedCountry } = useSetting<CountryCode>("holiday_country", DEFAULT_COUNTRY);
  const country: CountryCode = savedCountry ?? DEFAULT_COUNTRY;
  const updateSetting = useUpdateSetting<CountryCode>();
  const [countrySaving, setCountrySaving] = useState(false);

  async function pick(code: string) {
    if (pending) return;
    // Even when re-picking the CURRENT locale, still persist — this is the
    // repair path for families whose locale setting was never written
    // (e.g. default-English families that negotiated "en" and never
    // touched the switcher). Only the UI refresh is skipped, since there's
    // nothing to re-render.
    const isSame = code === current;
    setPending(code);
    try {
      await postLocale(code, family?.id);
      if (!isSame) router.refresh();
    } catch (e) {
      console.error(e);
    } finally {
      setPending(null);
    }
  }

  const { data: savedWeekStart } = useSetting<WeekStartPreference>(
    SETTINGS_KEYS.weekStart,
    DEFAULT_WEEK_START,
  );
  const weekStart: WeekStartPreference = savedWeekStart ?? DEFAULT_WEEK_START;
  const updateWeekStart = useUpdateSetting<WeekStartPreference>();
  const [weekStartSaving, setWeekStartSaving] = useState(false);

  async function pickWeekStart(value: WeekStartPreference) {
    if (value === weekStart || weekStartSaving) return;
    setWeekStartSaving(true);
    try {
      await updateWeekStart.mutateAsync({ key: SETTINGS_KEYS.weekStart, value });
    } catch (e) {
      console.error(e);
    } finally {
      setWeekStartSaving(false);
    }
  }

  async function pickCountry(code: CountryCode) {
    if (code === country || countrySaving) return;
    setCountrySaving(true);
    try {
      await updateSetting.mutateAsync({ key: "holiday_country", value: code });
    } catch {
      toast.error(t("countryError"));
    } finally {
      setCountrySaving(false);
    }
  }

  return (
    <main id="main-content" className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="relative z-10 max-w-2xl mx-auto">
        <PageHeader
          title={t("title")}
          subtitle={t("subtitle")}
          icon={Languages}
        />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="flex flex-col gap-4"
        >
          <Card className="p-6">
            <div className="space-y-3">
              {LOCALES.map(({ code, native }) => {
                const isCurrent = code === current;
                return (
                  <Button
                    key={code}
                    variant={isCurrent ? "default" : "outline"}
                    onClick={() => pick(code)}
                    disabled={pending !== null}
                    className="w-full justify-between h-auto py-4 px-5"
                  >
                    <span className="font-medium">{native}</span>
                    {isCurrent && <span className="text-xs">{t("current")}</span>}
                    {pending === code && <span className="text-xs">…</span>}
                  </Button>
                );
              })}
            </div>
          </Card>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Card className="p-6">
              <div className="mb-4">
                <p className="font-medium text-sm">{t("countryLabel")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{t("countryDescription")}</p>
              </div>
              <Select
                value={country}
                onValueChange={(v) => pickCountry(v as CountryCode)}
                disabled={countrySaving}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COUNTRIES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {t(`country_${code}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Card>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
          >
            <Card className="p-6">
              <div className="mb-4">
                <p className="font-medium text-sm">{t("weekStartLabel")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("weekStartDescription")}
                </p>
              </div>
              <Select
                value={weekStart}
                onValueChange={(v) => pickWeekStart(v as WeekStartPreference)}
                disabled={weekStartSaving}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="locale">{t("weekStart_locale")}</SelectItem>
                  <SelectItem value="monday">{t("weekStart_monday")}</SelectItem>
                  <SelectItem value="sunday">{t("weekStart_sunday")}</SelectItem>
                </SelectContent>
              </Select>
            </Card>
          </motion.div>
        </motion.div>
      </div>
    </main>
  );
}
