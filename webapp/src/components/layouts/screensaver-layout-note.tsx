"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { LayoutTemplate } from "lucide-react";
import { useDevices } from "@/hooks/use-supabase-queries";
import { useLayoutDefaults, useLayouts } from "@/hooks/use-layouts";
import { useNameList } from "@/hooks/use-name-list";

/**
 * At the top of Settings → Screensaver while the family uses a designed
 * layout (assigned to a screen or set as a default): which screens draw which
 * layout, and where to change it. The settings below the note still apply to
 * every screen without a layout.
 */
export function ScreensaverLayoutNote() {
  const t = useTranslations("settings.screensaver.layoutNote");
  const names = useNameList();
  const { data: layouts } = useLayouts();
  const { data: devices } = useDevices();
  const { data: defaults } = useLayoutDefaults();
  if (!layouts || !devices || !defaults) return null;

  const lines = layouts.flatMap((layout) => {
    const users = devices.filter((d) => d.layout_id === layout.id).map((d) => d.name);
    const out: { key: string; text: string }[] = [];
    if (users.length > 0) out.push({ key: `${layout.id}:devices`, text: t("assigned", { names: names(users), count: users.length, layout: layout.name }) });
    for (const orientation of ["portrait", "landscape"] as const) {
      if (defaults[orientation] === layout.id) out.push({ key: `${layout.id}:${orientation}`, text: t("default", { orientation, layout: layout.name }) });
    }
    return out;
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
