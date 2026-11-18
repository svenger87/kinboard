"use client";

import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { firstFreeBox } from "@/lib/layouts/place";
import { SAVER_WIDGETS } from "@/lib/layouts/widgets";
import type { LayoutItem, SaverWidgetKey } from "@/lib/layouts/types";

const ORDER = Object.keys(SAVER_WIDGETS) as SaverWidgetKey[];

/**
 * The widgets not on the screen yet. Adding one puts it at the first free
 * spot of its default box (smaller, down to its minimum, when that does not
 * fit); with no room even for the minimum the button is off and says why.
 */
export function EditorPalette({
  items,
  rows,
  disabled,
  names,
  onAdd,
}: {
  items: LayoutItem[];
  rows: number;
  disabled: boolean;
  names: Record<SaverWidgetKey, string>;
  onAdd: (item: LayoutItem) => void;
}) {
  const t = useTranslations("settings.layouts.editor.palette");
  const placed = new Set(items.map((i) => i.widget));
  const unplaced = ORDER.filter((w) => !placed.has(w));

  return (
    <Card className="flex flex-col gap-3 p-4" data-testid="palette">
      <h2 className="font-display text-sm font-semibold">{t("title")}</h2>
      {unplaced.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("allPlaced")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {unplaced.map((widget) => {
            const box = firstFreeBox(items, widget, rows);
            return (
              <li key={widget}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto w-full justify-start gap-2 py-1.5 text-left"
                  disabled={disabled || !box}
                  data-testid={`palette-add-${widget}`}
                  aria-label={t("add", { name: names[widget] })}
                  onClick={() => box && onAdd({ id: widget, widget, ...box, text: "M" })}
                >
                  <Plus className="size-4 shrink-0" aria-hidden="true" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{names[widget]}</span>
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
