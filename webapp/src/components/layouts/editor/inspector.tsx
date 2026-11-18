"use client";

import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import { SAVER_WIDGETS } from "@/lib/layouts/widgets";
import type { LayoutItem, SaverWidgetKey, TextSize } from "@/lib/layouts/types";

const TEXT_SIZES: TextSize[] = ["S", "M", "L", "XL"];

/** The selected widget: its size, its text size, and removing it. */
export function EditorInspector({
  item,
  disabled,
  names,
  onText,
  onRemove,
}: {
  item: LayoutItem | null;
  disabled: boolean;
  names: Record<SaverWidgetKey, string>;
  onText: (text: TextSize) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("settings.layouts.editor.inspector");

  return (
    <Card className="flex flex-col gap-4 p-4" data-testid="inspector">
      {!item ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <>
          <div>
            <h2 className="font-display text-base font-semibold">{names[item.widget]}</h2>
            <p className="text-xs text-muted-foreground">
              {t("size", { w: item.w, h: item.h })} · {t("min", { w: SAVER_WIDGETS[item.widget].min.w, h: SAVER_WIDGETS[item.widget].min.h })}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium" id="inspector-text-size">
              {t("textSize")}
            </span>
            <SegmentedControl
              value={item.text}
              onValueChange={(v) => onText(v as TextSize)}
              aria-labelledby="inspector-text-size"
              className="w-full"
              disabled={disabled}
            >
              {TEXT_SIZES.map((s) => (
                <SegmentedControlItem key={s} value={s} className="flex-1" data-testid={`text-size-${s}`} aria-label={t(`textSizes.${s}`)}>
                  {s}
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
          </div>
          <Button variant="outline" className="gap-2 text-destructive" onClick={onRemove} disabled={disabled} data-testid="inspector-remove">
            <Trash2 className="size-4" aria-hidden="true" />
            {t("remove")}
          </Button>
        </>
      )}
      <p className="border-t pt-3 text-xs text-muted-foreground">{t("keys")}</p>
    </Card>
  );
}
