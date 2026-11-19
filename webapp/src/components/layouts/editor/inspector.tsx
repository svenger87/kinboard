"use client";

import { useTranslations } from "next-intl";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  MoveHorizontal,
  MoveVertical,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import { SAVER_WIDGETS } from "@/lib/layouts/widgets";
import { VALUE_FILL } from "@/lib/layouts/grid";
import { autoAlign, storedAlign, type Align } from "@/lib/layouts/align";
import type { AlignEdge } from "@/lib/layouts/arrange";
import type { LayoutItem, SaverWidgetKey, TextSize } from "@/lib/layouts/types";

const TEXT_SIZES: TextSize[] = ["S", "M", "L", "XL"];

/** A command on several boxes, as the inspector's arrange buttons send it. */
export type ArrangeCommand =
  | { kind: "align"; edge: AlignEdge }
  | { kind: "distribute"; axis: "x" | "y" }
  | { kind: "size"; dim: "w" | "h" };

/** The arrange buttons in order: test id, message key, icon, command. */
const ARRANGE: { id: string; label: string; Icon: LucideIcon; command: ArrangeCommand }[] = [
  { id: "arrange-left", label: "left", Icon: AlignStartVertical, command: { kind: "align", edge: "left" } },
  { id: "arrange-hcenter", label: "hcenter", Icon: AlignCenterVertical, command: { kind: "align", edge: "hcenter" } },
  { id: "arrange-right", label: "right", Icon: AlignEndVertical, command: { kind: "align", edge: "right" } },
  { id: "arrange-top", label: "top", Icon: AlignStartHorizontal, command: { kind: "align", edge: "top" } },
  { id: "arrange-vcenter", label: "vcenter", Icon: AlignCenterHorizontal, command: { kind: "align", edge: "vcenter" } },
  { id: "arrange-bottom", label: "bottom", Icon: AlignEndHorizontal, command: { kind: "align", edge: "bottom" } },
  { id: "distribute-x", label: "distributeX", Icon: AlignHorizontalDistributeCenter, command: { kind: "distribute", axis: "x" } },
  { id: "distribute-y", label: "distributeY", Icon: AlignVerticalDistributeCenter, command: { kind: "distribute", axis: "y" } },
  { id: "same-w", label: "sameW", Icon: MoveHorizontal, command: { kind: "size", dim: "w" } },
  { id: "same-h", label: "sameH", Icon: MoveVertical, command: { kind: "size", dim: "h" } },
];

/**
 * The selected widget: its size, its text size, and removing it. With
 * several selected, how many (`item` is null then) and the commands that
 * line them up: align, distribute (three or more) and same size.
 */
export function EditorInspector({
  item,
  count,
  disabled,
  names,
  onText,
  onAlign,
  onRemove,
  onArrange,
}: {
  item: LayoutItem | null;
  count: number;
  disabled: boolean;
  names: Record<SaverWidgetKey, string>;
  onText: (text: TextSize) => void;
  onAlign: (align: Align | null) => void;
  onRemove: () => void;
  onArrange: (command: ArrangeCommand) => void;
}) {
  const t = useTranslations("settings.layouts.editor.inspector");
  const isValue = !!item && SAVER_WIDGETS[item.widget]?.kind === "value";

  return (
    <Card className="flex flex-col gap-4 p-4" data-testid="inspector">
      {count > 1 ? (
        <>
          <h2 className="font-display text-base font-semibold" data-testid="inspector-selection">
            {t("selected", { count })}
          </h2>
          <div className="flex flex-col gap-2" data-testid="inspector-arrange">
            <span className="text-sm font-medium">
              {t("arrange.title")}
            </span>
            {/* No role="group": arrow keys on a focused button still move the boxes. */}
            <div className="grid grid-cols-6 gap-1">
              {ARRANGE.map(({ id, label, Icon, command }) => {
                const tooFew = command.kind === "distribute" && count < 3;
                const text = t(`arrange.${label}`);
                return (
                  <Button
                    key={id}
                    variant="outline"
                    size="icon"
                    className="size-8"
                    data-testid={id}
                    aria-label={text}
                    title={tooFew ? `${text} — ${t("arrange.distributeHint")}` : text}
                    disabled={disabled || tooFew}
                    onClick={() => onArrange(command)}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                  </Button>
                );
              })}
            </div>
          </div>
        </>
      ) : !item ? (
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
                <SegmentedControlItem
                  key={s}
                  value={s}
                  className="flex-1"
                  data-testid={`text-size-${s}`}
                  aria-label={t(`textSizes.${s}`)}
                  // A value widget already fills its box at M: larger needs a larger box.
                  disabled={isValue && VALUE_FILL[s] === 1 && s !== "M"}
                >
                  {s}
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
            {isValue && (
              <p className="text-xs text-muted-foreground" data-testid="inspector-fills-box">
                {t("fillsBox")}
              </p>
            )}
          </div>
          {isValue && item && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium" id="inspector-align">
                {t("align")}
              </span>
              <SegmentedControl
                value={storedAlign(item) ?? "auto"}
                onValueChange={(v) => onAlign(v === "auto" ? null : (v as Align))}
                aria-labelledby="inspector-align"
                className="w-full"
                disabled={disabled}
              >
                {(["auto", "start", "center", "end"] as const).map((a) => (
                  <SegmentedControlItem key={a} value={a} className="flex-1" data-testid={`align-${a}`}>
                    {t(`aligns.${a}`)}
                  </SegmentedControlItem>
                ))}
              </SegmentedControl>
              {!storedAlign(item) && (
                <p className="text-xs text-muted-foreground" data-testid="inspector-align-auto">
                  {t("alignAuto", { side: t(`aligns.${autoAlign(item)}`) })}
                </p>
              )}
            </div>
          )}
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
