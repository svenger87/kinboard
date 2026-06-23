"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { WizardProgress } from "@/components/setup/wizard-progress";
import { WizardStepFooter } from "@/components/setup/wizard-step-footer";
import { useUpdateSetting, useWeather } from "@/hooks";

export default function SetupWeatherPage() {
  const t = useTranslations("setup.weather");
  const [city, setCity] = useState("");
  const update = useUpdateSetting<{ type: "city"; city: string }>();
  const { data: weather } = useWeather();
  const apiKeyMissing = weather === null;

  const handleNext = async () => {
    if (!city.trim()) return;
    try {
      await update.mutateAsync({
        key: "weather_location",
        value: { type: "city", city: city.trim() },
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
          <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="size-5 shrink-0 text-amber-600 mt-0.5" />
              <div className="flex-1 text-sm">
                <p className="font-medium mb-1">{t("apiKeyTitle")}</p>
                <p className="text-muted-foreground whitespace-pre-line">
                  {t("apiKeyBody")}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="setup-city">{t("cityLabel")}</Label>
          <Input
            id="setup-city"
            placeholder={t("cityPlaceholder")}
            value={city}
            onChange={(e) => setCity(e.target.value)}
          />
        </div>
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
