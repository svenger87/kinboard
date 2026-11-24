"use client";

import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { firstFreeBox } from "@/lib/layouts/place";
import { surfaceOf, type SurfaceAt } from "@/lib/layouts/home-size";
import type { LayoutItem } from "@/lib/layouts/types";

/** A placed box of either surface. */
type Item = LayoutItem<string>;

/**
 * One thing the palette offers: a widget, and on Home a per-child widget once
 * per child (`options.personId`). `id` is the item id it is added with, and
 * names its button (`palette-add-<id>`): the widget's key, or for a child's
 * widget `<widget>:<personId>`, as builtInHome names them.
 */
export interface PaletteEntry {
  id: string;
  widget: string;
  label: string;
  options?: Record<string, unknown>;
}

/**
 * The widgets not on the screen yet. Adding one puts it at the first free
 * spot of its default box (smaller, down to its minimum, when that does not
 * fit); with no room even for the minimum the button is off and says why.
 * The editor passes only the entries not placed yet, for the surface shown.
 */
export function EditorPalette({
  surface = "screensaver",
  entries,
  items,
  rows,
  disabled,
  onAdd,
}: {
  /** On Home with the layout's area: a widget's minimum and default box follow it (home-size.ts). */
  surface?: SurfaceAt;
  entries: PaletteEntry[];
  items: Item[];
  rows: number;
  disabled: boolean;
  onAdd: (item: Item) => void;
}) {
  const t = useTranslations("settings.layouts.editor.palette");

  return (
    <Card className="flex flex-col gap-3 p-4" data-testid="palette" data-surface={surfaceOf(surface)}>
      <h2 className="font-display text-sm font-semibold">{t("title")}</h2>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("allPlaced")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {entries.map((entry) => {
            const box = firstFreeBox(items, entry.widget, rows, surface);
            return (
              <li key={entry.id}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto w-full justify-start gap-2 py-1.5 text-left"
                  disabled={disabled || !box}
                  data-testid={`palette-add-${entry.id}`}
                  aria-label={t("add", { name: entry.label })}
                  onClick={() =>
                    box && onAdd({ id: entry.id, widget: entry.widget, ...box, text: "M", ...(entry.options ? { options: entry.options } : {}) })
                  }
                >
                  <Plus className="size-4 shrink-0" aria-hidden="true" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{entry.label}</span>
                    {!box && <span className="whitespace-normal text-xs font-normal text-muted-foreground">{t("noRoom")}</span>}
                  </span>
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
