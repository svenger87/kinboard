"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Loader2, MonitorOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDevices } from "@/hooks/use-supabase-queries";
import { LayoutRequestError, useAssignLayout, useLayoutDefaults, useLayouts } from "@/hooks/use-layouts";
import { orientationOf } from "@/lib/layouts/grid";
import { layoutUsage } from "@/lib/layouts/usage";
import type { Layout } from "@/lib/layouts/types";
import type { Device } from "@/types/database";

/**
 * The screens this layout can be put on from the editor: those turned the
 * way it is drawn (or that reported no size), wall screens first. A screen
 * turned the other way would keep showing something else.
 */
export function assignableDevices(devices: Device[], layout: Layout): Device[] {
  const want = orientationOf(layout.width, layout.height);
  const fits = devices.filter(
    (d) => !d.screen || orientationOf(Math.round(d.screen.viewportWidth), Math.round(d.screen.viewportHeight)) === want,
  );
  return [...fits.filter((d) => d.is_kiosk), ...fits.filter((d) => !d.is_kiosk)];
}

/**
 * Above the editor while no screen shows this layout: saving one does not
 * put it on a screen, so say so and offer the screens it can go on.
 */
export function LayoutUnusedNotice({ layout }: { layout: Layout }) {
  const t = useTranslations("settings.layouts.editor.unused");
  const { data: devices } = useDevices();
  const { data: layouts } = useLayouts();
  const { data: defaults } = useLayoutDefaults();
  const assign = useAssignLayout();
  const [picked, setPicked] = useState<string | null>(null);

  // Wait for everything: a notice that flashes up and goes again is worse than none.
  if (!devices || !layouts || !defaults) return null;
  const use = layoutUsage(devices, layouts, defaults).get(layout.id);
  if (!use || use.assigned.length + use.viaDefault.length > 0) return null;

  const options = assignableDevices(devices, layout);
  const target = options.find((d) => d.id === picked) ?? options[0];

  const apply = async () => {
    if (!target) return;
    try {
      await assign.mutateAsync({ deviceId: target.id, layoutId: layout.id });
      toast.success(t("done", { name: target.name }));
    } catch (err) {
      if (err instanceof LayoutRequestError && err.code === "pin_required") return;
      toast.error(t("failed"));
    }
  };

  return (
    <div
      role="status"
      data-testid="editor-unused"
      className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm"
    >
      <MonitorOff className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">{options.length > 0 ? t("text") : t("noScreen")}</span>
      {target && (
        <div className="flex flex-wrap items-center gap-2">
          {options.length > 1 && (
            <Select value={target.id} onValueChange={setPicked} disabled={assign.isPending}>
              <SelectTrigger className="h-8 w-auto min-w-0 max-w-[14rem] text-sm" aria-label={t("pick")} data-testid="editor-unused-device">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button size="sm" variant="outline" className="gap-2" onClick={() => void apply()} disabled={assign.isPending} data-testid="editor-unused-assign">
            {assign.isPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {t("assign", { name: target.name })}
          </Button>
        </div>
      )}
    </div>
  );
}
