"use client";

import { useTranslations } from "next-intl";
import { LayoutTemplate } from "lucide-react";

/**
 * A Home widget on the editor's canvas that has no component in a box yet
 * (missingHomeWidgets): its name in a tile the size of its box, so it can be
 * placed, sized and saved like any other while the widget itself is built.
 */
export function HomeWidgetPlaceholder({ label, widget }: { label: string; widget: string }) {
  const t = useTranslations("settings.layouts.editor");
  return (
    <div
      data-testid="home-placeholder"
      data-widget={widget}
      className="flex size-full flex-col items-center justify-center gap-[0.3em] rounded-xl border border-dashed border-border bg-card/70 p-[0.6em] text-center text-card-foreground"
    >
      <LayoutTemplate className="size-[1.4em] shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="max-w-full truncate font-display font-semibold">{label}</span>
      <span className="max-w-full text-[0.7em] leading-tight text-muted-foreground">{t("homePlaceholder")}</span>
    </div>
  );
}
