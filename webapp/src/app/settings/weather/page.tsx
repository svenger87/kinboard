"use client";

import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Cloud, Loader2, Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useWeatherLocation,
  useWeather,
  useWeatherUnits,
  useUpdateSetting,
  type WeatherLocation,
} from "@/hooks";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { UNIT_LABELS, type UnitSystem } from "@/lib/weather-units";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Weather } from "@/components/widgets/weather";
import { PageHeader } from "@/components/page-header";
import { IntegrationConfigHint } from "@/components/integration-config-hint";
import { CityLocationPicker } from "@/components/settings/city-location-picker";

const DEFAULT_LOCATION: WeatherLocation = { type: "city", city: "Hamburg" };

// null/undefined lat/lon (unset) and NaN (in-progress coordinate input)
// both mean "no value" here, so they compare equal to each other.
function sameCoord(a: number | undefined, b: number | undefined): boolean {
  return (a ?? null) === (b ?? null) || (Number.isNaN(a) && Number.isNaN(b));
}

function isEqualLocation(a: WeatherLocation, b: WeatherLocation): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "city") {
    return (a.city ?? "") === (b.city ?? "");
  }
  return sameCoord(a.lat, b.lat) && sameCoord(a.lon, b.lon);
}

export default function WeatherSettingsPage() {
  const t = useTranslations("settings.weather");
  const { data: savedLocation, isLoading: locationLoading } = useWeatherLocation();
  const { data: weatherData, refetch: refetchWeather } = useWeather();
  // Detect "OPENWEATHERMAP_API_KEY missing" — the hook returns null
  // (not an error) when the API responds with { configured: false }.
  // Loading-state suppresses the hint until the first fetch resolves.
  const weatherUnconfigured = weatherData === null;
  const updateSetting = useUpdateSetting();
  const { system: unitSystem } = useWeatherUnits();

  // Units save on tap rather than via the location Save button: it's
  // a two-state toggle whose effect is visible in the preview below
  // immediately, so staging it behind a save step would only add a
  // way to forget to press it.
  const handleUnitsChange = async (next: UnitSystem) => {
    if (next === unitSystem) return;
    try {
      await updateSetting.mutateAsync({
        key: SETTINGS_KEYS.weatherUnits,
        value: next,
      });
      setTimeout(() => refetchWeather(), 300);
    } catch {
      toast.error(t("saveFailed"));
    }
  };

  const [locationValue, setLocationValue] = useState<WeatherLocation>(DEFAULT_LOCATION);
  // The last-saved value. Compared against locationValue to derive
  // hasChanges, so reverting an edit (or saving) disables the button again.
  const [savedBaseline, setSavedBaseline] = useState<WeatherLocation>(DEFAULT_LOCATION);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Tracks the baseline as of the previous savedLocation arrival, read
  // (not written) inside the effect below so the sync decision always
  // compares against pre-update state rather than a stale closure.
  const previousBaselineRef = useRef<WeatherLocation>(DEFAULT_LOCATION);

  // Load saved settings on hydration (and after a successful save's refetch).
  useEffect(() => {
    if (!savedLocation) return;
    // Realtime invalidates every ["settings", familyId] query on ANY
    // settings row changing (not just this one), so this effect can fire
    // from an unrelated save on another device. Only resync locationValue
    // when the user has no unsaved edit here; the baseline always tracks
    // DB truth so hasChanges stays correct either way.
    const previousBaseline = previousBaselineRef.current;
    setLocationValue((current) =>
      isEqualLocation(current, previousBaseline) ? savedLocation : current
    );
    setSavedBaseline(savedLocation);
    previousBaselineRef.current = savedLocation;
  }, [savedLocation]);

  const hasChanges = !isEqualLocation(locationValue, savedBaseline);

  const handleLocationChange = (next: WeatherLocation) => {
    setLocationValue(next);
    setSaved(false);
  };

  const handleSave = async () => {
    setIsSaving(true);

    try {
      await updateSetting.mutateAsync({
        key: "weather_location",
        value: locationValue,
      });
      setSavedBaseline(locationValue);
      // Keep the ref in step with the baseline we just set, or the post-save
      // refetch would compare against the pre-save baseline and could clobber
      // an edit made in the save→refetch window.
      previousBaselineRef.current = locationValue;
      setSaved(true);
      // Refetch weather with new location
      setTimeout(() => refetchWeather(), 500);
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  if (locationLoading) {
    return (
      <main id="main-content" className="min-h-page p-4 pt-16 md:p-8 md:pt-20 flex items-center justify-center safe-area-inset">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </main>
    );
  }

  return (
    <main id="main-content" className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="relative z-10 max-w-2xl mx-auto">
        <PageHeader
          icon={Cloud}
          title={t("title")}
          subtitle={t("subtitle")}
          backHref="/settings"
          className="mb-8"
        />

        {weatherUnconfigured && (
          <IntegrationConfigHint
            title={t("notConfiguredTitle")}
            description={t("notConfiguredDescription")}
            envKey="OPENWEATHERMAP_API_KEY"
            docsHref="https://github.com/svenger87/kinboard/wiki/OpenWeatherMap"
            docsLabel={t("notConfiguredDocsLabel")}
          />
        )}

        <CityLocationPicker value={locationValue} onChange={handleLocationChange} />

        {/* Unit system */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mb-6"
        >
          <Card className="p-4">
            <Label className="mb-1 block">{t("unitsLabel")}</Label>
            <p className="text-xs text-muted-foreground mb-3">{t("unitsHint")}</p>
            <div
              role="radiogroup"
              aria-label={t("unitsLabel")}
              className="grid grid-cols-2 gap-2"
            >
              {(["metric", "imperial"] as const).map((system) => {
                const active = unitSystem === system;
                return (
                  <button
                    key={system}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => handleUnitsChange(system)}
                    className={`rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                      active
                        ? "border-primary bg-primary/10"
                        : "border-border hover:bg-muted/40"
                    }`}
                  >
                    <span className="block text-sm font-medium">
                      {t(system === "metric" ? "unitsMetric" : "unitsImperial")}
                    </span>
                    <span className="block text-xs text-muted-foreground tabular-nums">
                      {UNIT_LABELS[system].temperature} · {UNIT_LABELS[system].speed} ·{" "}
                      {UNIT_LABELS[system].distance}
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>
        </motion.div>

        {/* Save Button */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="mb-6"
        >
          <Button
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
            className="w-full"
          >
            {isSaving ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                {t("savingLabel")}
              </>
            ) : saved ? (
              <>
                <Check className="size-4 mr-2" />
                {t("savedLabel")}
              </>
            ) : (
              t("saveButton")
            )}
          </Button>
        </motion.div>

        {/* Weather Preview */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <div className="flex items-center justify-between mb-3 px-1">
            <h2 className="text-sm font-medium text-muted-foreground">
              {t("previewHeading")}
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetchWeather()}
              className="h-8"
            >
              <RefreshCw className="size-4 mr-1" />
              {t("refreshButton")}
            </Button>
          </div>
          <Weather />
        </motion.div>
      </div>
    </main>
  );
}
