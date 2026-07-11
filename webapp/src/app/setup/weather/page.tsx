"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { WizardProgress } from "@/components/setup/wizard-progress";
import { WizardStepFooter } from "@/components/setup/wizard-step-footer";
import { useUpdateSetting, useWeather, type WeatherLocation } from "@/hooks";
import { IntegrationConfigHint } from "@/components/integration-config-hint";
import { CityLocationPicker } from "@/components/settings/city-location-picker";
import { SETTINGS_KEYS } from "@/lib/settings-keys";

export default function SetupWeatherPage() {
  const t = useTranslations("setup.weather");
  const [locationValue, setLocationValue] = useState<WeatherLocation>({
    type: "city",
    city: "",
  });
  const update = useUpdateSetting<WeatherLocation>();
  const { data: weather } = useWeather();
  const apiKeyMissing = weather === null;

  const handleNext = async () => {
    if (locationValue.type === "city" && !locationValue.city?.trim()) return;
    if (
      locationValue.type === "coordinates" &&
      (locationValue.lat === undefined ||
        locationValue.lon === undefined ||
        Number.isNaN(locationValue.lat) ||
        Number.isNaN(locationValue.lon))
    ) {
      return;
    }

    const value: WeatherLocation =
      locationValue.type === "city"
        ? { type: "city", city: locationValue.city!.trim() }
        : locationValue;

    try {
      await update.mutateAsync({
        key: SETTINGS_KEYS.weatherLocation,
        value,
      });
    } catch (err) {
      console.error("setup/weather: save failed:", err);
      toast.error(t("saveError"));
      throw err;
    }
  };

  return (
    <>
      <WizardProgress current="weather" />
      <Card><CardContent className="p-6 md:p-8">
        <h1 className="text-2xl font-display tracking-tight mb-2">{t("title")}</h1>
        <p className="text-muted-foreground text-sm mb-6">{t("description")}</p>

        {apiKeyMissing && (
          <IntegrationConfigHint
            title={t("apiKeyTitle")}
            description={t("apiKeyBody")}
            envKey="OPENWEATHERMAP_API_KEY"
          />
        )}

        <CityLocationPicker value={locationValue} onChange={setLocationValue} />
      </CardContent></Card>

      <WizardStepFooter
        backHref="/setup/homeassistant"
        nextHref="/setup/done"
        onNextClick={handleNext}
        disabled={update.isPending}
      />
    </>
  );
}
