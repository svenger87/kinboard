"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDevices } from "@/hooks/use-supabase-queries";
import { gridFor } from "@/lib/layouts/grid";

/** A screen size in CSS pixels, with the picker entry it came from. */
export interface ScreenChoice {
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

const CUSTOM_KEY = "kinboard_layout_custom_size";
/** The entry that opens the custom size form; never the picker's value. */
const OPEN_CUSTOM = "custom-open";

const customKey = (w: number, h: number) => `custom:${w}x${h}`;

/** Whether a size can hold a layout: the grid has to exist (600px wide, six rows). */
export function sizeFits(width: number, height: number): boolean {
  return Number.isInteger(width) && Number.isInteger(height) && width <= 20000 && height <= 20000 && gridFor(width, height) !== null;
}

function readCustom(): { width: number; height: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { width?: unknown; height?: unknown };
    return typeof v.width === "number" && typeof v.height === "number" && sizeFits(v.width, v.height)
      ? { width: v.width, height: v.height }
      : null;
  } catch {
    return null;
  }
}

function writeCustom(size: { width: number; height: number }): void {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(size));
  } catch {
    /* Storage unavailable: the size is not remembered, nothing else changes. */
  }
}

/**
 * A screen size to draw a layout for: optionally the layout's own size, the
 * family's screens that reported their size, common sizes, and a custom
 * size typed in (remembered in this browser). Controlled: `value` is the
 * current choice, `onChange` gets the next one.
 */
export function ScreenPicker({
  own,
  value,
  onChange,
}: {
  /** The layout's own size, offered first; left out where there is no layout yet. */
  own?: { width: number; height: number };
  value: ScreenChoice;
  onChange: (screen: ScreenChoice) => void;
}) {
  const t = useTranslations("settings.layouts.editor.screen");
  const { data: devices } = useDevices();
  const [lastCustom, setLastCustom] = useState(readCustom);
  const [formOpen, setFormOpen] = useState(false);

  const options = useMemo(() => {
    const ownOption = own ? { key: "own", width: own.width, height: own.height, label: t("own", { width: own.width, height: own.height }) } : null;
    // A screen's reported size can carry a fraction (a zoomed browser); layouts are whole pixels.
    // A screen too small for a grid (a phone) is listed, greyed out, rather than missing without a word.
    const deviceOptions = (devices ?? []).flatMap((d) => {
      if (!d.screen) return [];
      const width = Math.round(d.screen.viewportWidth);
      const height = Math.round(d.screen.viewportHeight);
      const fits = sizeFits(width, height);
      const label = fits ? t("device", { name: d.name, width, height }) : t("deviceTooSmall", { name: d.name, width, height });
      return [{ key: `device:${d.id}`, width, height, label, fits }];
    });
    const presetOptions = PRESETS.map((p) => ({
      key: `preset:${p.key}`,
      width: p.width,
      height: p.height,
      label: t(`presets.${p.key}`, { width: p.width, height: p.height }),
    }));
    // The custom size shown: the one chosen now, else the one remembered.
    const custom = value.key.startsWith("custom:") ? { width: value.width, height: value.height } : lastCustom;
    const customOption = custom
      ? { key: customKey(custom.width, custom.height), width: custom.width, height: custom.height, label: t("custom", { width: custom.width, height: custom.height }) }
      : null;
    const all = [ownOption, ...deviceOptions, ...presetOptions, customOption].filter((o) => o !== null);
    return { ownOption, deviceOptions, presetOptions, customOption, all };
  }, [devices, own, t, value, lastCustom]);

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground" id="screen-picker-label">
        {t("label")}
      </span>
      <Select
        value={value.key}
        onValueChange={(key) => {
          if (key === OPEN_CUSTOM) return setFormOpen(true);
          const o = options.all.find((x) => x.key === key);
          if (o) onChange({ key: o.key, width: o.width, height: o.height });
        }}
      >
        <SelectTrigger className="w-[min(22rem,70vw)]" data-testid="screen-picker" aria-labelledby="screen-picker-label">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.ownOption && <SelectItem value="own">{options.ownOption.label}</SelectItem>}
          {options.deviceOptions.length > 0 && (
            <SelectGroup>
              <SelectLabel>{t("devices")}</SelectLabel>
              {options.deviceOptions.map((o) => (
                <SelectItem key={o.key} value={o.key} disabled={!o.fits} data-testid={o.fits ? undefined : "screen-picker-too-small"}>
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
          <SelectSeparator />
          {options.customOption && <SelectItem value={options.customOption.key}>{options.customOption.label}</SelectItem>}
          <SelectItem value={OPEN_CUSTOM} data-testid="screen-picker-custom">
            {t("customOpen")}
          </SelectItem>
        </SelectContent>
      </Select>
      <CustomSizeDialog
        open={formOpen}
        initial={options.customOption ?? own ?? { width: value.width, height: value.height }}
        onOpenChange={setFormOpen}
        onApply={(size) => {
          writeCustom(size);
          setLastCustom(size);
          setFormOpen(false);
          onChange({ key: customKey(size.width, size.height), ...size });
        }}
      />
    </div>
  );
}

/** Width and height in CSS pixels, accepted once the grid fits them. */
function CustomSizeDialog({
  open,
  initial,
  onOpenChange,
  onApply,
}: {
  open: boolean;
  initial: { width: number; height: number };
  onOpenChange: (open: boolean) => void;
  onApply: (size: { width: number; height: number }) => void;
}) {
  const t = useTranslations("settings.layouts.editor.screen.customForm");
  const [width, setWidth] = useState(String(initial.width));
  const [height, setHeight] = useState(String(initial.height));
  const [prevOpen, setPrevOpen] = useState(open);
  // Each time the form opens it starts from the size it was opened with.
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setWidth(String(initial.width));
      setHeight(String(initial.height));
    }
  }
  const w = Number(width);
  const h = Number(height);
  const filled = width.trim() !== "" && height.trim() !== "";
  const ok = filled && sizeFits(w, h);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" data-testid="custom-size-form">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (ok) onApply({ width: w, height: h });
          }}
          className="flex flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="custom-width">{t("width")}</Label>
              <Input id="custom-width" data-testid="custom-width" type="number" inputMode="numeric" min={600} step={1} value={width} onChange={(e) => setWidth(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="custom-height">{t("height")}</Label>
              <Input id="custom-height" data-testid="custom-height" type="number" inputMode="numeric" min={1} step={1} value={height} onChange={(e) => setHeight(e.target.value)} />
            </div>
          </div>
          {filled && !ok && (
            <p role="alert" className="text-sm text-destructive" data-testid="custom-size-error">
              {t("tooSmall")}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={!ok} data-testid="custom-apply">
              {t("apply")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
