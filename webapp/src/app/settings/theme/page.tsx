"use client";

import { useEffect } from "react";
import { motion } from "framer-motion";
import { Palette, Moon, Sun, Clock, Loader2, Type } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { format } from "date-fns";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useSetting, useUpdateSetting, useTextScale, type TextScale } from "@/hooks";
import { useTheme } from "next-themes";
import { PageHeader } from "@/components/page-header";

// Month names are computed per-locale via date-fns; these are the
// theme metadata only. The "name" is decorative branding kept in
// English in both locales.
const MONTHLY_THEMES = [
  { color: "#3b82f6", name: "Frost Blue", class: "theme-january" },
  { color: "#ec4899", name: "Rose Valentine", class: "theme-february" },
  { color: "#22c55e", name: "Spring Green", class: "theme-march" },
  { color: "#f9a8d4", name: "Cherry Blossom", class: "theme-april" },
  { color: "#a855f7", name: "Lilac", class: "theme-may" },
  { color: "#0ea5e9", name: "Ocean Blue", class: "theme-june" },
  { color: "#eab308", name: "Sunflower", class: "theme-july" },
  { color: "#f97316", name: "Coral", class: "theme-august" },
  { color: "#f59e0b", name: "Amber", class: "theme-september" },
  { color: "#ea580c", name: "Pumpkin", class: "theme-october" },
  { color: "#7f1d1d", name: "Burgundy", class: "theme-november" },
  { color: "#166534", name: "Pine", class: "theme-december" },
];

type Palette = "salbei" | "sand" | "warmgrey";

// Neutral palettes — same accent/month themes, different warm-neutral tones.
// Swatch HSL values mirror globals.css (light-mode background/card/border).
const PALETTES: { id: Palette; bg: string; card: string; border: string }[] = [
  { id: "sand", bg: "38 37% 88%", card: "43 54% 97%", border: "37 31% 85%" },
  { id: "salbei", bg: "72 25% 92%", card: "75 50% 98%", border: "77 19% 85%" },
  { id: "warmgrey", bg: "37 18% 91%", card: "40 33% 98%", border: "37 18% 86%" },
];

// Per-device text scale (localStorage, not the Supabase theme blob above —
// see useTextScale). A wall kiosk and a phone need different sizes.
const TEXT_SCALES: { value: TextScale; labelKey: string }[] = [
  { value: 1, labelKey: "textScaleNormal" },
  { value: 1.15, labelKey: "textScaleLarge" },
  { value: 1.3, labelKey: "textScaleXL" },
];

interface ThemeSettings {
  themeOverride: number | null;
  palette: Palette;
  use24Hour: boolean;
  showSeconds: boolean;
}

const DEFAULT_SETTINGS: ThemeSettings = {
  themeOverride: null,
  palette: "sand",
  use24Hour: true,
  showSeconds: false,
};

export default function ThemeSettingsPage() {
  const t = useTranslations("settings.theme");
  const locale = useLocale();
  const dateLocale = getDateFnsLocale(locale);
  const currentMonth = new Date().getMonth();
  const { theme, setTheme } = useTheme();

  // Localized month names + 3-letter abbreviations
  const monthLabel = (idx: number, full: boolean): string => {
    const date = new Date(2000, idx, 1);
    return format(date, full ? "MMMM" : "MMM", { locale: dateLocale });
  };

  // Load settings from Supabase
  const { data: settings, isLoading } = useSetting<ThemeSettings>("theme", DEFAULT_SETTINGS);
  const updateSetting = useUpdateSetting<ThemeSettings>();

  // Per-device text scale — localStorage, not the Supabase settings above.
  const [textScale, setTextScale] = useTextScale();

  const themeOverride = settings?.themeOverride ?? null;
  const palette: Palette = settings?.palette ?? "sand";
  const use24Hour = settings?.use24Hour ?? true;
  const showSeconds = settings?.showSeconds ?? false;

  const activeTheme = themeOverride !== null ? themeOverride : currentMonth;

  // Apply theme class to document
  useEffect(() => {
    if (isLoading) return;

    const html = document.documentElement;
    // Remove all theme classes
    MONTHLY_THEMES.forEach((t) => html.classList.remove(t.class));
    // Add active theme class
    html.classList.add(MONTHLY_THEMES[activeTheme].class);
  }, [activeTheme, isLoading]);

  // Apply neutral-palette class to document (instant feedback while on this page)
  useEffect(() => {
    if (isLoading) return;
    const html = document.documentElement;
    html.classList.remove("palette-salbei", "palette-warmgrey");
    if (palette !== "sand") html.classList.add(`palette-${palette}`);
  }, [palette, isLoading]);

  const currentSettings: ThemeSettings = {
    themeOverride: settings?.themeOverride ?? null,
    palette: settings?.palette ?? "sand",
    use24Hour: settings?.use24Hour ?? true,
    showSeconds: settings?.showSeconds ?? false,
  };

  const handlePaletteChange = (id: Palette) => {
    updateSetting.mutate({
      key: "theme",
      value: { ...currentSettings, palette: id },
    });
  };

  const handleThemeOverride = (index: number) => {
    const newOverride = index === currentMonth ? null : index;
    updateSetting.mutate({
      key: "theme",
      value: { ...currentSettings, themeOverride: newOverride },
    });
  };

  const handleResetTheme = () => {
    updateSetting.mutate({
      key: "theme",
      value: { ...currentSettings, themeOverride: null },
    });
  };

  const handleUse24HourChange = (checked: boolean) => {
    updateSetting.mutate({
      key: "theme",
      value: { ...currentSettings, use24Hour: checked },
    });
  };

  const handleShowSecondsChange = (checked: boolean) => {
    updateSetting.mutate({
      key: "theme",
      value: { ...currentSettings, showSeconds: checked },
    });
  };

  const handleDarkModeChange = (checked: boolean) => {
    setTheme(checked ? "dark" : "light");
  };

  const isDarkMode = theme === "dark";

  return (
    <main id="main-content" className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="relative z-10 max-w-2xl mx-auto">
        <PageHeader
          icon={Palette}
          title={t("title")}
          subtitle={t("subtitle")}
          backHref="/settings"
          className="mb-8"
        />

        {isLoading ? (
          <div className="flex flex-col gap-6">
            <Skeleton className="h-48 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        ) : (
          <>
            {/* Theme Section */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="mb-6"
            >
              <h2 className="text-sm font-medium text-muted-foreground mb-3 px-1">
                {t("monthlyThemeHeading")}
              </h2>
              <Card className="p-4">
                <p className="text-sm text-muted-foreground mb-4">
                  {t("monthlyThemeIntro")}
                </p>
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                  {MONTHLY_THEMES.map((themeItem, index) => (
                    <button
                      key={themeItem.class}
                      onClick={() => handleThemeOverride(index)}
                      disabled={updateSetting.isPending}
                      className={`relative p-2 rounded-lg text-center transition-all ${
                        activeTheme === index
                          ? "ring-2 ring-offset-2 ring-offset-background ring-white scale-105"
                          : "hover:scale-105"
                      } ${updateSetting.isPending ? "opacity-50" : ""}`}
                      style={{ backgroundColor: `${themeItem.color}20` }}
                    >
                      <div
                        className="size-6 rounded-full mx-auto mb-1"
                        style={{ backgroundColor: themeItem.color }}
                      />
                      <span className="text-xs">{monthLabel(index, false)}</span>
                      {index === currentMonth && themeOverride === null && (
                        <div className="absolute -top-1 -right-1 size-3 bg-success rounded-full" />
                      )}
                    </button>
                  ))}
                </div>
                {themeOverride !== null && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={handleResetTheme}
                    disabled={updateSetting.isPending}
                  >
                    {updateSetting.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
                    {t("resetToAuto")}
                  </Button>
                )}
              </Card>
            </motion.div>

            {/* Neutral Palette Section */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="mb-6"
            >
              <h2 className="text-sm font-medium text-muted-foreground mb-3 px-1">
                {t("paletteHeading")}
              </h2>
              <Card className="p-4">
                <p className="text-sm text-muted-foreground mb-4">{t("paletteIntro")}</p>
                <div className="grid grid-cols-3 gap-3">
                  {PALETTES.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => handlePaletteChange(p.id)}
                      disabled={updateSetting.isPending}
                      aria-pressed={palette === p.id}
                      className={`relative rounded-xl border p-3 text-left transition-all ${
                        palette === p.id
                          ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                          : "hover:scale-[1.02]"
                      } ${updateSetting.isPending ? "opacity-50" : ""}`}
                      style={{ backgroundColor: `hsl(${p.bg})`, borderColor: `hsl(${p.border})` }}
                    >
                      <div
                        className="mb-2 h-10 rounded-lg border"
                        style={{ backgroundColor: `hsl(${p.card})`, borderColor: `hsl(${p.border})` }}
                      />
                      <span className="text-xs font-medium" style={{ color: "hsl(30 14% 14%)" }}>
                        {t(`palette_${p.id}`)}
                      </span>
                    </button>
                  ))}
                </div>
              </Card>
            </motion.div>

            {/* Appearance Section */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="mb-6"
            >
              <h2 className="text-sm font-medium text-muted-foreground mb-3 px-1">
                {t("appearanceHeading")}
              </h2>
              <Card className="divide-y divide-border/50">
                {/* Dark Mode */}
                <div className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    {isDarkMode ? (
                      <Moon className="size-5 text-primary" />
                    ) : (
                      <Sun className="size-5 text-primary" />
                    )}
                    <div>
                      <Label className="font-medium">{t("darkModeLabel")}</Label>
                      <p className="text-xs text-muted-foreground">
                        {t("darkModeDescription")}
                      </p>
                    </div>
                  </div>
                  <Switch checked={isDarkMode} onCheckedChange={handleDarkModeChange} />
                </div>

                {/* 24h Format */}
                <div className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <Clock className="size-5 text-primary" />
                    <div>
                      <Label className="font-medium">{t("use24HourLabel")}</Label>
                      <p className="text-xs text-muted-foreground">
                        {use24Hour ? "14:30" : "2:30 PM"}
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={use24Hour}
                    onCheckedChange={handleUse24HourChange}
                    disabled={updateSetting.isPending}
                  />
                </div>

                {/* Show Seconds */}
                <div className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <Clock className="size-5 text-primary" />
                    <div>
                      <Label className="font-medium">{t("showSecondsLabel")}</Label>
                      <p className="text-xs text-muted-foreground">
                        {t("showSecondsDescription")}
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={showSeconds}
                    onCheckedChange={handleShowSecondsChange}
                    disabled={updateSetting.isPending}
                  />
                </div>

                {/* Text Size (per-device, localStorage) */}
                <div className="p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <Type className="size-5 text-primary" />
                    <Label className="font-medium">{t("textScaleLabel")}</Label>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {TEXT_SCALES.map((s) => (
                      <button
                        key={s.value}
                        onClick={() => setTextScale(s.value)}
                        aria-pressed={textScale === s.value}
                        className={`rounded-lg border px-3 py-2 text-sm font-medium text-center transition-all ${
                          textScale === s.value
                            ? "border-primary bg-primary/10 text-primary ring-1 ring-primary"
                            : "border-border text-muted-foreground hover:bg-muted/50"
                        }`}
                      >
                        {t(s.labelKey)}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">{t("textScaleHint")}</p>
                </div>
              </Card>
            </motion.div>

            {/* Preview */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="mt-8"
            >
              <h2 className="text-sm font-medium text-muted-foreground mb-3 px-1">
                {t("previewHeading")}
              </h2>
              <Card className="p-8 text-center">
                <div
                  className="inline-block p-4 rounded-xl mb-4"
                  style={{ backgroundColor: `${MONTHLY_THEMES[activeTheme].color}20` }}
                >
                  <div
                    className="text-6xl font-display font-extralight"
                    style={{ color: MONTHLY_THEMES[activeTheme].color }}
                  >
                    {use24Hour ? "14:30" : "2:30"}
                    {showSeconds && <span className="text-3xl">:45</span>}
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  {monthLabel(activeTheme, true)} - {MONTHLY_THEMES[activeTheme].name}
                </p>
              </Card>
            </motion.div>
          </>
        )}
      </div>
    </main>
  );
}
