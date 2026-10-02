"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OFFERED_COUNTRIES, regionCode, resolveRegion, subdivisionsOf } from "@/lib/holidays/region";
import { subdivisionOptions } from "@/lib/holidays/adapter";

const WHOLE_COUNTRY = "__whole__";

interface Props {
  /** A region code, or null when none is picked. */
  value: string | null;
  /** Called with the new region: a bare country when the country changes (RFC-014 §4.2 clears the state). */
  onChange: (code: string) => void;
  disabled?: boolean;
  idPrefix?: string;
}

/**
 * Country, then state or canton (RFC-014 §4.2, §4.3). Countries come from
 * the generated list and are named by the browser in the UI language;
 * states by date-holidays, without its "Kanton"/"Canton de" prefix so the
 * list is alphabetical and type-to-search works. State or canton level only: sub-regions are a
 * documented gap.
 */
export function HolidayRegionPicker({ value, onChange, disabled, idPrefix = "holiday-region" }: Props) {
  const t = useTranslations("settings.holidays");
  const locale = useLocale();
  const resolved = resolveRegion(value);
  const country = resolved?.country ?? null;
  const state = resolved?.state ?? null;

  const countries = useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: "region" });
    return OFFERED_COUNTRIES.map((code) => ({ code, name: names.of(code) ?? code })).sort((a, b) =>
      a.name.localeCompare(b.name, locale),
    );
  }, [locale]);

  const states = useMemo(() => {
    if (!country) return [];
    return subdivisionOptions(country, subdivisionsOf(country), locale);
  }, [country, locale]);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor={`${idPrefix}-country`}>{t("countryLabel")}</Label>
        {/* "" rather than undefined: the Select stays controlled while the setting
            loads, and Radix shows the placeholder for it. */}
        <Select value={country ?? ""} onValueChange={(c) => onChange(c)} disabled={disabled}>
          <SelectTrigger id={`${idPrefix}-country`} className="w-full min-w-0">
            <SelectValue placeholder={t("countryPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {countries.map(({ code, name }) => (
              <SelectItem key={code} value={code}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {country && states.length > 0 && (
        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor={`${idPrefix}-state`}>{t("stateLabel")}</Label>
          <Select
            value={state ?? WHOLE_COUNTRY}
            onValueChange={(s) => onChange(regionCode(country, s === WHOLE_COUNTRY ? null : s))}
            disabled={disabled}
          >
            <SelectTrigger id={`${idPrefix}-state`} className="w-full min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={WHOLE_COUNTRY}>{t("stateWholeCountry")}</SelectItem>
              {states.map(({ code, name }) => (
                <SelectItem key={code} value={code}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
