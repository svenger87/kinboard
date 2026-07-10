"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Cloud, Loader2, Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWeatherLocation, useWeather } from "@/hooks";
import { useUpdateSetting } from "@/hooks";
import { Weather } from "@/components/widgets/weather";
import { PageHeader } from "@/components/page-header";
import { IntegrationConfigHint } from "@/components/integration-config-hint";
import {
  CityLocationPicker,
  type WeatherLocationValue,
} from "@/components/settings/city-location-picker";

const DEFAULT_LOCATION: WeatherLocationValue = { type: "city", city: "Hamburg" };

export default function WeatherSettingsPage() {
  const t = useTranslations("settings.weather");
  const { data: savedLocation, isLoading: locationLoading } = useWeatherLocation();
  const { data: weatherData, refetch: refetchWeather } = useWeather();
  // Detect "OPENWEATHERMAP_API_KEY missing" — the hook returns null
  // (not an error) when the API responds with { configured: false }.
  // Loading-state suppresses the hint until the first fetch resolves.
  const weatherUnconfigured = weatherData === null;
  const updateSetting = useUpdateSetting();

  const [locationValue, setLocationValue] = useState<WeatherLocationValue>(DEFAULT_LOCATION);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load saved settings. Runs on hydration only — must NOT flip hasChanges.
  useEffect(() => {
    if (savedLocation) {
      setLocationValue(savedLocation);
    }
  }, [savedLocation]);

  const handleLocationChange = (next: WeatherLocationValue) => {
    setLocationValue(next);
    setHasChanges(true);
    setSaved(false);
  };

  const handleSave = async () => {
    setIsSaving(true);

    try {
      await updateSetting.mutateAsync({
        key: "weather_location",
        value: locationValue,
      });
      setSaved(true);
      setHasChanges(false);
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
