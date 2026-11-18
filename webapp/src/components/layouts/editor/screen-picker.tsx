"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDevices } from "@/hooks/use-supabase-queries";
import { gridFor } from "@/lib/layouts/grid";

export interface PreviewScreen {
  key: string;
  width: number;
  height: number;
}

/** Common screens, in CSS pixels: 1080p portrait and landscape at 100% and 150%, and a tablet both ways. */
const PRESETS = [
  { key: "portrait1080", width: 1080, height: 1920 },
  { key: "portrait1080at150", width: 720, height: 1280 },
  { key: "landscape1080", width: 1920, height: 1080 },
  { key: "landscape1080at150", width: 1280, height: 720 },
  { key: "tabletLandscape", width: 1280, height: 800 },
  { key: "tabletPortrait", width: 800, height: 1280 },
] as const;

/** The screen the canvas shows: the layout's own size, a screen of the family that reported its size, or a preset. */
export function ScreenPicker({
  own,
  value,
  onChange,
}: {
  own: { width: number; height: number };
  value: string;
  onChange: (screen: PreviewScreen) => void;
}) {
  const t = useTranslations("settings.layouts.editor.screen");
  const { data: devices } = useDevices();

  const options = useMemo(() => {
    const fits = (w: number, h: number) => gridFor(w, h) !== null;
    const ownOption = { key: "own", width: own.width, height: own.height, label: t("own", { width: own.width, height: own.height }) };
    const deviceOptions = (devices ?? [])
      .filter((d) => d.screen && fits(d.screen.viewportWidth, d.screen.viewportHeight))
      .map((d) => ({
        key: `device:${d.id}`,
        width: d.screen!.viewportWidth,
        height: d.screen!.viewportHeight,
        label: t("device", { name: d.name, width: d.screen!.viewportWidth, height: d.screen!.viewportHeight }),
      }));
    const presetOptions = PRESETS.map((p) => ({
      key: `preset:${p.key}`,
      width: p.width,
      height: p.height,
      label: t(`presets.${p.key}`, { width: p.width, height: p.height }),
    }));
    return { ownOption, deviceOptions, presetOptions, all: [ownOption, ...deviceOptions, ...presetOptions] };
  }, [devices, own.width, own.height, t]);

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground" id="screen-picker-label">
        {t("label")}
      </span>
      <Select
        value={value}
        onValueChange={(key) => {
          const o = options.all.find((x) => x.key === key);
          if (o) onChange({ key: o.key, width: o.width, height: o.height });
        }}
      >
        <SelectTrigger className="w-[min(22rem,70vw)]" data-testid="screen-picker" aria-labelledby="screen-picker-label">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="own">{options.ownOption.label}</SelectItem>
          {options.deviceOptions.length > 0 && (
            <SelectGroup>
              <SelectLabel>{t("devices")}</SelectLabel>
              {options.deviceOptions.map((o) => (
                <SelectItem key={o.key} value={o.key}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          <SelectGroup>
            <SelectLabel>{t("presetsLabel")}</SelectLabel>
            {options.presetOptions.map((o) => (
              <SelectItem key={o.key} value={o.key}>
                {o.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
