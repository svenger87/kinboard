"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WeatherEffects } from "@/components/weather-effects";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSetting, useUpdateSetting } from "@/hooks/use-supabase-queries";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { UNIT_LABELS, type UnitSystem } from "@/lib/weather-units";
import {
  DEFAULT_WEATHER_EFFECTS,
  PREVIEW_MS,
  WEATHER_EFFECTS,
  displayThreshold,
  normalizeWeatherEffects,
  storedThreshold,
  type THRESHOLD_BOUNDS,
  type WeatherEffect,
  type WeatherEffectsSettings,
} from "@/lib/weather-effects";

type ThresholdKey = keyof typeof THRESHOLD_BOUNDS;
const THRESHOLDS: ThresholdKey[] = ["freezingAtC", "heatAtC", "windAtKmh", "rainChanceAt"];

/** Settings -> Weather -> Weather effects on Home (components/weather-effects.tsx draws them). */
export function WeatherEffectsSettings({ units }: { units: UnitSystem }) {
  const t = useTranslations("settings.weather");
  const { data: stored } = useSetting<unknown>(SETTINGS_KEYS.weatherEffects, DEFAULT_WEATHER_EFFECTS);
  const update = useUpdateSetting();
  const [value, setValue] = useState<WeatherEffectsSettings>(() => normalizeWeatherEffects(stored));
  const [typed, setTyped] = useState<Record<ThresholdKey, string>>({ freezingAtC: "", heatAtC: "", windAtKmh: "", rainChanceAt: "" });
  // An effect shown right here, over this page, for a minute (or until Stop).
  const [previewing, setPreviewing] = useState<WeatherEffect | null>(null);
  useEffect(() => {
    if (!previewing) return;
    const timer = window.setTimeout(() => setPreviewing(null), PREVIEW_MS);
    return () => window.clearTimeout(timer);
  }, [previewing]);

  useEffect(() => {
    const next = normalizeWeatherEffects(stored);
    setValue(next);
    setTyped({
      freezingAtC: String(displayThreshold("freezingAtC", next, units)),
      heatAtC: String(displayThreshold("heatAtC", next, units)),
      windAtKmh: String(displayThreshold("windAtKmh", next, units)),
      rainChanceAt: String(displayThreshold("rainChanceAt", next, units)),
    });
  }, [stored, units]);

  const save = async (next: WeatherEffectsSettings) => {
    const before = value;
    setValue(next);
    try {
      await update.mutateAsync({ key: SETTINGS_KEYS.weatherEffects, value: next });
    } catch {
      setValue(before);
      toast.error(t("saveFailed"));
    }
  };

  const commitThreshold = (key: ThresholdKey) => {
    const number = Number(typed[key]);
    if (typed[key].trim() === "" || !Number.isFinite(number)) {
      setTyped((s) => ({ ...s, [key]: String(displayThreshold(key, value, units)) }));
      return;
    }
    const next = { ...value, [key]: storedThreshold(key, number, units) };
    setTyped((s) => ({ ...s, [key]: String(displayThreshold(key, next, units)) }));
    if (next[key] !== value[key]) void save(next);
  };

  const unit = (key: ThresholdKey) =>
    key === "rainChanceAt" ? "%" : key === "windAtKmh" ? UNIT_LABELS[units].speed : UNIT_LABELS[units].temperature;
  const choice = (active: boolean) =>
    `rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
      active ? "border-primary bg-primary/10 font-medium" : "border-border hover:bg-muted/40"
    }`;

  return (
    <Card id="effects" data-setting="effects" className="p-4">
      {previewing && <WeatherEffects key={previewing} preview={[previewing]} />}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Label htmlFor="weather-effects-enabled" className="mb-1 flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            {t("effectsLabel")}
          </Label>
          <p className="text-xs text-muted-foreground">{t("effectsHint")}</p>
        </div>
        <Switch
          id="weather-effects-enabled"
          checked={value.enabled}
          onCheckedChange={(enabled) => void save({ ...value, enabled })}
          disabled={update.isPending}
        />
      </div>

      {value.enabled && (
        <div className="mt-4 space-y-5">
          <div>
            <Label className="mb-2 block text-sm">{t("effectsIntensityLabel")}</Label>
            <div role="radiogroup" aria-label={t("effectsIntensityLabel")} className="grid grid-cols-2 gap-2">
              {(["subtle", "normal"] as const).map((intensity) => (
                <button
                  key={intensity}
                  type="button"
                  role="radio"
                  aria-checked={value.intensity === intensity}
                  className={choice(value.intensity === intensity)}
                  onClick={() => value.intensity !== intensity && void save({ ...value, intensity })}
                >
                  {t(intensity === "subtle" ? "effectsIntensitySubtle" : "effectsIntensityNormal")}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="mb-2 block text-sm">{t("effectsTemperatureLabel")}</Label>
            <div role="radiogroup" aria-label={t("effectsTemperatureLabel")} className="grid grid-cols-2 gap-2">
              {[false, true].map((feels) => (
                <button
                  key={String(feels)}
                  type="button"
                  role="radio"
                  aria-checked={value.useFeelsLike === feels}
                  className={choice(value.useFeelsLike === feels)}
                  onClick={() => value.useFeelsLike !== feels && void save({ ...value, useFeelsLike: feels })}
                >
                  {t(feels ? "effectsTemperatureFeelsLike" : "effectsTemperatureMeasured")}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {THRESHOLDS.map((key) => (
              <div key={key}>
                <Label htmlFor={`weather-effects-${key}`} className="mb-1 block text-sm">
                  {t(`effectsThreshold.${key}`)}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id={`weather-effects-${key}`}
                    type="number"
                    inputMode="numeric"
                    value={typed[key]}
                    onChange={(e) => setTyped((s) => ({ ...s, [key]: e.target.value }))}
                    onBlur={() => commitThreshold(key)}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    className="tabular-nums"
                  />
                  <span className="text-sm text-muted-foreground">{unit(key)}</span>
                </div>
              </div>
            ))}
          </div>

          <div>
            <Label className="mb-1 block text-sm">{t("effectsListLabel")}</Label>
            <p className="mb-2 text-xs text-muted-foreground">{t("effectsListHint")}</p>
            <ul className="divide-y divide-border rounded-lg border">
              {WEATHER_EFFECTS.map((effect) => (
                <li key={effect} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <Label htmlFor={`weather-effect-${effect}`} className="text-sm">
                      {t(`effectName.${effect}`)}
                    </Label>
                    <p className="text-xs text-muted-foreground">{t(`effectWhen.${effect}`)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <Button
                      type="button"
                      variant={previewing === effect ? "outline" : "ghost"}
                      size="sm"
                      className="h-8 px-2 text-xs"
                      aria-pressed={previewing === effect}
                      onClick={() => setPreviewing(previewing === effect ? null : effect)}
                      data-testid={`weather-effect-preview-${effect}`}
                    >
                      {previewing === effect ? t("effectsPreviewStop") : t("effectsPreview")}
                    </Button>
                    <Switch
                      id={`weather-effect-${effect}`}
                      checked={value.effects[effect]}
                      onCheckedChange={(on) => void save({ ...value, effects: { ...value.effects, [effect]: on } })}
                      disabled={update.isPending}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Card>
  );
}
