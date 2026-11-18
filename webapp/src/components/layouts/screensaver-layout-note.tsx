"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { LayoutTemplate } from "lucide-react";
import { useDevices } from "@/hooks/use-supabase-queries";
import { useLayoutDefaults, useLayouts } from "@/hooks/use-layouts";
import { useNameList } from "@/hooks/use-name-list";
import { layoutUsage } from "@/lib/layouts/usage";

/**
 * At the top of Settings → Screensaver while some screen draws a designed
 * layout (its own, or a default): which screens draw which layout, and where
 * to change it. The settings below the note still apply to
 * every screen without a layout.
 */
export function ScreensaverLayoutNote() {
  const t = useTranslations("settings.screensaver.layoutNote");
  const names = useNameList();
  const { data: layouts } = useLayouts();
  const { data: devices } = useDevices();
  const { data: defaults } = useLayoutDefaults();
  if (!layouts || !devices || !defaults) return null;

  // Only the screens that actually draw a designed layout at the size they reported (or, with no size reported, their own).
  const usage = layoutUsage(devices, layouts, defaults);
  const lines = layouts.flatMap((layout) => {
    const u = usage.get(layout.id);
    const shown = u ? [...u.assigned, ...u.viaDefault].map((d) => d.name) : [];
    return shown.length > 0 ? [{ key: layout.id, text: t("assigned", { names: names(shown), count: shown.length, layout: layout.name }) }] : [];
  });
  if (lines.length === 0) return null;

  return (
    <div role="note" className="mb-6 flex gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm" data-testid="screensaver-layout-note">
      <LayoutTemplate className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        {lines.map((l) => (
          <p key={l.key}>{l.text}</p>
        ))}
        <p className="text-muted-foreground">
          {t.rich("change", {
            link: (chunks) => (
              <Link href="/settings/layouts" className="font-medium text-foreground underline underline-offset-2">
                {chunks}
              </Link>
            ),
          })}
        </p>
      </div>
    </div>
  );
}
