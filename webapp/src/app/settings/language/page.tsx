"use client";

import { motion } from "framer-motion";
import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { useDeleteSetting, useSetting, useUpdateSetting } from "@/hooks";
import { TimeZonePicker } from "@/components/settings/time-zone-picker";
import { isValidTimeZone } from "@/lib/integration-event-input";
import { DEFAULT_WEEK_START, type WeekStartPreference } from "@/hooks/use-week-start";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { LOCALES } from "@/i18n/locales";
import { postLocale } from "@/lib/locale-client";
import { useFamilyStore } from "@/stores/family-store";

export default function LanguageSettingsPage() {
  const t = useTranslations("settings.language");
  const current = useLocale();
  const router = useRouter();
  const { family } = useFamilyStore();
  const [pending, setPending] = useState<string | null>(null);

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

  // The family's time zone: absent is automatic, the server's own, which
  // /api/time-zone names. Automatic deletes the setting (lib/family-time.ts).
  const { data: savedZone } = useSetting<unknown>(SETTINGS_KEYS.timezone, null);
  const familyZone = isValidTimeZone(savedZone) ? savedZone : null;
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

  async function pickZone(zone: string | null) {
    if (zone === familyZone || zoneSaving) return;
    setZoneSaving(true);
    try {
      if (zone === null) await deleteZone.mutateAsync(SETTINGS_KEYS.timezone);
      else await updateZone.mutateAsync({ key: SETTINGS_KEYS.timezone, value: zone });
    } catch (e) {
      console.error(e);
    } finally {
      setZoneSaving(false);
    }
  }

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
              <p className="text-sm text-muted-foreground">
                {t.rich("holidaysMoved", {
                  link: (chunks) => (
                    <Link href="/settings/holidays" className="underline underline-offset-2 hover:text-foreground">
                      {chunks}
                    </Link>
                  ),
                })}
              </p>
            </Card>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
          >
            <Card id="week-start" data-setting="week-start" className="p-6">
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

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <Card id="time-zone" data-setting="time-zone" className="p-6" data-testid="time-zone-card">
              <div className="mb-4">
                <p className="font-medium text-sm">{t("timeZoneLabel")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("timeZoneDescription")}
                </p>
              </div>
              <TimeZonePicker
                value={familyZone}
                serverZone={serverZone}
                onPick={pickZone}
                disabled={zoneSaving}
              />
            </Card>
          </motion.div>
        </motion.div>
      </div>
    </main>
  );
}
