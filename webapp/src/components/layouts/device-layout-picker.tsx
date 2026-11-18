"use client";

import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LayoutRequestError, useAssignLayout } from "@/hooks/use-layouts";
import { aspectDiffers, gridFor, orientationOf } from "@/lib/layouts/grid";
import { runningLayout } from "@/lib/layouts/usage";
import { useNameList } from "@/hooks/use-name-list";
import { rescaleItems } from "@/lib/layouts/rescale";
import type { Layout, LayoutDefaults, SaverWidgetKey } from "@/lib/layouts/types";
import type { Device } from "@/types/database";

const BUILT_IN = "builtin";

/**
 * What a screen draws at the size it last reported: the running layout (its
 * own, or for a wall screen the default for the way it is turned) and the
 * widgets that do not fit when it is rescaled to that size.
 */
function applied(device: Device, layouts: Layout[], defaults: LayoutDefaults) {
  const layout = runningLayout(device, layouts, defaults);
  if (!layout || !device.screen) return null;
  const from = gridFor(layout.width, layout.height);
  const to = gridFor(Math.round(device.screen.viewportWidth), Math.round(device.screen.viewportHeight));
  if (!from || !to) return null;
  const { dropped } = rescaleItems(layout.screensaver, from, to);
  const widgetOf = new Map(layout.screensaver.map((i) => [i.id, i.widget]));
  return { layout, dropped: dropped.map((id) => widgetOf.get(id)).filter((w): w is SaverWidgetKey => !!w) };
}

/**
 * A device's layout in Settings → Devices: built-in or one of the family's
 * layouts. Below it, about the layout the screen actually draws at its
 * reported size: when its own layout is for the other orientation, what it
 * shows instead; when that is a default, which; a warning when the screen's
 * shape is far from the running layout's; the widgets that will not be shown
 * on it; and, for a screen that is no wall screen and has no layout, that the
 * defaults do not reach it.
 */
export function DeviceLayoutPicker({
  device,
  layouts,
  defaults,
}: {
  device: Device;
  layouts: Layout[];
  defaults: LayoutDefaults;
}) {
  const t = useTranslations("settings.devices");
  const widgetNames = useTranslations("settings.layouts.editor.widgets");
  const assign = useAssignLayout();
  const own = layouts.find((l) => l.id === device.layout_id) ?? null;
  const screen = device.screen
    ? { width: Math.round(device.screen.viewportWidth), height: Math.round(device.screen.viewportHeight) }
    : null;
  const result = applied(device, layouts, defaults);
  const names = useNameList();
  // Its own layout is drawn for the other orientation, so the screen shows something else while turned this way.
  const ownIdle = !!own && !!screen && orientationOf(own.width, own.height) !== orientationOf(screen.width, screen.height);

  const change = async (value: string) => {
    try {
      await assign.mutateAsync({ deviceId: device.id, layoutId: value === BUILT_IN ? null : value });
    } catch (err) {
      if (err instanceof LayoutRequestError && err.code === "pin_required") return;
      toast.error(t("layoutFailed"));
    }
  };

  return (
    <div className="flex flex-col gap-1 sm:mt-1">
      <Select value={own?.id ?? BUILT_IN} onValueChange={(v) => void change(v)} disabled={assign.isPending}>
        <SelectTrigger
          className="h-8 w-auto min-w-0 max-w-[18rem] gap-1.5 text-sm"
          aria-label={t("layoutAria", { name: device.name })}
          data-testid="device-layout"
        >
          <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">{t("layoutLabel")}</span>
          <span className="min-w-0 truncate">
            <SelectValue />
          </span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={BUILT_IN}>{t("layoutBuiltIn")}</SelectItem>
          {layouts.map((l) => (
            <SelectItem key={l.id} value={l.id}>
              {l.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {ownIdle && own && (
        <p className="text-xs text-muted-foreground" data-testid="device-layout-other-orientation">
          {result
            ? t("layoutOtherOrientationDefault", { name: own.name, orientation: orientationOf(own.width, own.height), fallback: result.layout.name })
            : t("layoutOtherOrientationBuiltIn", { name: own.name, orientation: orientationOf(own.width, own.height) })}
        </p>
      )}
      {!ownIdle && result && result.layout.id !== own?.id && (
        <p className="text-xs text-muted-foreground" data-testid="device-layout-default">
          {t("layoutUsesDefault", { name: result.layout.name })}
        </p>
      )}
      {result && screen && aspectDiffers(result.layout, screen) && (
        <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400" data-testid="device-layout-aspect">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          {t("layoutAspect", { layoutWidth: result.layout.width, layoutHeight: result.layout.height, width: screen.width, height: screen.height })}
        </p>
      )}
      {result && result.dropped.length > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="device-layout-dropped">
          {t("layoutDropped", { names: names(result.dropped.map((w) => widgetNames(w))) })}
        </p>
      )}
      {!own && !device.is_kiosk && (
        <p className="text-xs text-muted-foreground" data-testid="device-layout-no-defaults">
          {t("layoutNoDefaults")}
        </p>
      )}
    </div>
  );
}
