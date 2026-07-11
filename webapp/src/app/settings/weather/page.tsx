"use client";

import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Cloud, Loader2, Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWeatherLocation, useWeather, useUpdateSetting, type WeatherLocation } from "@/hooks";
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
      <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 flex items-center justify-center safe-area-inset">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </main>
    );
  }

  return (
    <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
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
