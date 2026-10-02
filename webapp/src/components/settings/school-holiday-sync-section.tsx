"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSchoolHolidays } from "@/hooks/use-supabase-queries";
import { useSchoolHolidaySync, useSchoolRegionOptions, useUpdateSchoolHolidaySync } from "@/hooks/use-school-holiday-sync";

const external = (href: string) =>
  function ExternalLink(chunks: React.ReactNode) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">
        {chunks}
      </a>
    );
  };

/** `CH-GR-ML` → `CH-GR` (kept here: lib/school-sync is server-only). */
const topLevel = (code: string) => code.split("-").slice(0, 2).join("-");

/**
 * School holidays from OpenHolidays (RFC-014 §5): the switch, the school
 * region, area and school type, the status, Refresh now, the synced rows
 * (read-only until §6.4's hide and copy-as-mine), what is sent, and the ODbL
 * attribution (§8). Not rendered where no sync can exist: GB, the US, an
 * uncovered country, or an install with SCHOOL_HOLIDAY_SYNC=off.
 */
export function SchoolHolidaySyncSection() {
  const t = useTranslations("settings.holidays.sync");
  const locale = useLocale();
  const { data: status } = useSchoolHolidaySync();
  const update = useUpdateSchoolHolidaySync();
  const { data: holidays = [] } = useSchoolHolidays();
  const setting = status?.setting ?? null;
  const parent = setting?.region ? topLevel(setting.region) : null;
  const { data: options } = useSchoolRegionOptions(parent, !!setting?.enabled);

  const synced = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const horizon = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
    return holidays.filter((h) => h.source === "openholidays" && !h.hidden && h.ends_on >= today && h.starts_on <= horizon);
  }, [holidays]);

  if (!status || !status.installEnabled || !status.covered) return null;

  async function change(body: { enabled?: boolean; region?: string; group?: string }) {
    try {
      const result = await update.mutateAsync(body);
      if (result.outcome?.status === "failed") toast.error(t("syncFailed"));
      if (result.outcome?.status === "rate-limited") toast(t("rateLimited"));
    } catch {
      toast.error(t("saveError"));
    }
  }

  const day = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short" });
  const date = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(locale);
  const range = (from: string, to: string) => (from === to ? date(from) : `${date(from)} – ${date(to)}`);

  let statusLine: string;
  if (setting?.pending === "region") statusLine = t("pendingRegion");
  else if (setting?.pending === "group") statusLine = t("pendingGroup");
  else if (setting?.last_success_at) {
    statusLine = t("lastUpdated", { date: day(setting.last_success_at) });
    if (setting.last_error_at && setting.last_error_at > setting.last_success_at) {
      statusLine += ` · ${t("lastError", { date: day(setting.last_error_at) })}`;
    }
  } else if (setting?.last_error_at) statusLine = t("lastErrorOnly", { date: day(setting.last_error_at) });
  else statusLine = t("neverUpdated");

  const children = options?.children ?? [];
  const groups = options?.groups ?? [];
  // "" rather than undefined keeps each Select controlled (and shows the placeholder).
  const childValue = setting?.region && setting.region !== parent ? setting.region : null;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-56">
          <Label htmlFor="school-sync-switch" className="font-semibold">
            {t("title")}
          </Label>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Switch
          id="school-sync-switch"
          checked={!!setting?.enabled}
          disabled={update.isPending || !status.chosen}
          onCheckedChange={(on) => change({ enabled: on })}
        />
      </div>

      {!status.chosen && <p className="mt-3 text-sm">{t("pickRegionFirst")}</p>}

      {setting?.enabled && (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-2">
              <Label htmlFor="school-sync-region">{t("regionLabel")}</Label>
              <Select value={parent ?? ""} onValueChange={(v) => change({ region: v })} disabled={update.isPending}>
                <SelectTrigger id="school-sync-region" className="w-full min-w-0">
                  <SelectValue placeholder={t("regionPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {(options?.subdivisions ?? []).map((s) => (
                    <SelectItem key={s.code} value={s.code}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {children.length > 0 && (
              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor="school-sync-child">{t("childLabel")}</Label>
                <Select value={childValue ?? ""} onValueChange={(v) => change({ region: v })} disabled={update.isPending}>
                  <SelectTrigger id="school-sync-child" className="w-full min-w-0">
                    <SelectValue placeholder={t("childPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {children.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {groups.length > 0 && (
              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor="school-sync-group">{t("groupLabel")}</Label>
                <Select value={setting.group ?? ""} onValueChange={(v) => change({ group: v })} disabled={update.isPending}>
                  <SelectTrigger id="school-sync-group" className="w-full min-w-0">
                    <SelectValue placeholder={t("groupPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((g) => (
                      <SelectItem key={g.code} value={g.code}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="min-w-0 flex-1 basis-56 text-sm text-muted-foreground">{statusLine}</p>
            <Button size="sm" variant="outline" onClick={() => change({})} disabled={update.isPending || setting.pending !== null}>
              <RefreshCw className="mr-1 size-4" aria-hidden="true" />
              {t("refresh")}
            </Button>
          </div>

          {synced.length > 0 && (
            <ul className="mt-4 flex flex-col gap-2" data-testid="synced-holidays">
              {synced.map((h) => (
                <li
                  key={h.id}
                  title={t("odblTitle")}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/30 p-3"
                >
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="break-words text-sm font-medium hyphens-auto">{h.name}</p>
                    <p className="text-xs text-muted-foreground">{range(h.starts_on, h.ends_on)}</p>
                  </div>
                  <Badge variant="outline" className="shrink-0">
                    {t("sourceBadge")}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <p className="mt-4 text-xs text-muted-foreground">{t("sentNote")}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        {t.rich("odbl", {
          oh: external("https://www.openholidaysapi.org"),
          odbl: external("https://opendatacommons.org/licenses/odbl/1-0/"),
        })}
      </p>
    </Card>
  );
}
