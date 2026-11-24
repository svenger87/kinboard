"use client";

import { useEffect, useId, useState, type KeyboardEvent } from "react";
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
import { Input } from "@/components/ui/input";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import { specOf } from "@/lib/layouts/place";
import { surfaceOf, type SurfaceAt } from "@/lib/layouts/home-size";
import { VALUE_FILL } from "@/lib/layouts/grid";
import { autoAlign, storedAlign, type Align } from "@/lib/layouts/align";
import type { AlignEdge, ArrangeReason, Box } from "@/lib/layouts/arrange";
import type { LayoutItem, TextSize } from "@/lib/layouts/types";

/** A placed box of either surface. */
type Item = LayoutItem<string>;

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

const FIELDS = ["x", "y", "w", "h"] as const;
type Field = (typeof FIELDS)[number];

/**
 * The selected box's position and size as numbers, in steps. A field is
 * applied on Enter or on leaving it; one that cannot be (off the screen,
 * under the minimum, onto another box, not a whole number) goes back to the
 * box's value and the reason stays under the fields until the next value
 * that fits or the box is moved some other way. Escape puts back what the
 * box has. Mounted per box, so another selection starts clean.
 */
function BoxFields({
  item,
  min,
  disabled,
  onBox,
}: {
  item: Item;
  /** The widget's smallest box on its surface, in steps. */
  min: { w: number; h: number };
  disabled: boolean;
  onBox: (box: Box) => ArrangeReason | null;
}) {
  const t = useTranslations("settings.layouts.editor.inspector");
  const id = useId();
  // What is being typed into a field, until it is applied; otherwise the field shows the box.
  const [typed, setTyped] = useState<Partial<Record<Field, string>>>({});
  const [refused, setRefused] = useState<{ field: Field; reason: ArrangeReason; at: string } | null>(null);
  const errorId = `${id}-error`;

  const drop = (field: Field) =>
    setTyped((d) => {
      const rest = { ...d };
      delete rest[field];
      return rest;
    });
  // Where the box was when a value was refused: once it is moved some other way, the reason no longer applies.
  const at = `${item.x},${item.y},${item.w},${item.h}`;
  const refusal = refused?.at === at ? refused : null;

  const applyField = (field: Field) => {
    const text = typed[field];
    drop(field);
    if (text === undefined) return;
    // Emptied: nothing to apply, the field shows the box again.
    if (text.trim() === "") return;
    const value = Number(text);
    if (value === item[field]) return;
    const reason = onBox({ x: item.x, y: item.y, w: item.w, h: item.h, [field]: value });
    setRefused(reason ? { field, reason, at } : null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>, field: Field) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applyField(field);
    } else if (e.key === "Escape") {
      drop(field);
    }
  };

  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled} data-testid="inspector-box">
      <legend className="mb-2 text-sm font-medium">{t("box.title")}</legend>
      <div className="grid grid-cols-4 gap-2">
        {FIELDS.map((field) => {
          const invalid = refusal?.field === field;
          return (
            <label key={field} className="flex flex-col gap-1 text-xs text-muted-foreground" title={t(`box.${field}Name`)}>
              <span aria-hidden="true">{t(`box.${field}`)}</span>
              <Input
                type="number"
                inputMode="numeric"
                step={1}
                min={0}
                className="h-8 px-2 tabular-nums"
                data-testid={`inspector-${field}`}
                aria-label={t(`box.${field}Name`)}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? errorId : undefined}
                value={typed[field] ?? String(item[field])}
                onChange={(e) => setTyped((d) => ({ ...d, [field]: e.target.value }))}
                onKeyDown={(e) => onKeyDown(e, field)}
                onBlur={() => applyField(field)}
              />
            </label>
          );
        })}
      </div>
      {refusal && (
        <p id={errorId} role="alert" className="text-xs text-destructive" data-testid="inspector-box-error" data-reason={refusal.reason}>
          {t(`box.refused.${refusal.reason}`)}
        </p>
      )}
      <p className="text-xs text-muted-foreground" data-testid="inspector-min">
        {t("min", { w: min.w, h: min.h })}
      </p>
    </fieldset>
  );
}

/**
 * The selected widget: its position and size as numbers, its text size,
 * and removing it. With several selected, how many (`item` is null then) and the commands that
 * line them up: align, distribute (three or more) and same size.
 */
export function EditorInspector({
  surface = "screensaver",
  item,
  count,
  disabled,
  label,
  onText,
  onAlign,
  onRemove,
  onArrange,
  onBox,
  onFit,
}: {
  /** On Home with the layout's area: a widget's minimum follows it and the box's text size (home-size.ts). */
  surface?: SurfaceAt;
  item: Item | null;
  count: number;
  disabled: boolean;
  /** A box's name, as the palette and the canvas give it. */
  label: (item: Item) => string;
  onText: (text: TextSize) => void;
  onAlign: (align: Align | null) => void;
  onRemove: () => void;
  onArrange: (command: ArrangeCommand) => void;
  /** The selected box put at these numbers: null when done, else why not. */
  onBox: (box: Box) => ArrangeReason | null;
  /**
   * Grows every box under its minimum to fit (the layout's "Fit"), moving
   * what is below; false when there is no room to. Offered while the
   * selected box is under its minimum.
   */
  onFit?: () => boolean;
}) {
  const t = useTranslations("settings.layouts.editor.inspector");
  const plain = surfaceOf(surface);
  const spec = item ? specOf(item.widget, surface, item.text) : undefined;
  const isValue = spec?.kind === "value";
  // Where a value sits across its box is a screensaver setting: Home's values fill theirs.
  const canAlign = isValue && plain === "screensaver";
  // A value that fills its box (the screensaver's, Home's clock) gets larger with the box, not the text size.
  const fills = isValue && (plain === "screensaver" || item?.widget === "clock");
  const below = !!item && !!spec && (item.w < spec.min.w || item.h < spec.min.h);
  const [fitFailed, setFitFailed] = useState(false);
  const selectedId = item?.id;
  useEffect(() => setFitFailed(false), [selectedId]);

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
          <h2 className="font-display text-base font-semibold" data-testid="inspector-title">{label(item)}</h2>
          {below && (
            <div className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3" data-testid="inspector-below-minimum">
              <p className="text-xs text-destructive">{t("belowMinimum", { w: spec!.min.w, h: spec!.min.h })}</p>
              {onFit && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  data-testid="inspector-fit"
                  onClick={() => setFitFailed(!onFit())}
                >
                  {t("fit")}
                </Button>
              )}
              {fitFailed && <p className="text-xs text-muted-foreground" data-testid="inspector-fit-failed">{t("fitFailed")}</p>}
            </div>
          )}
          <BoxFields key={item.id} item={item} min={spec?.min ?? { w: 1, h: 1 }} disabled={disabled} onBox={onBox} />
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
                  // A value widget that fills its box already does at M: larger needs a larger box.
                  disabled={fills && VALUE_FILL[s] === 1 && s !== "M"}
                >
                  {s}
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
            {fills && (
              <p className="text-xs text-muted-foreground" data-testid="inspector-fills-box">
                {t("fillsBox")}
              </p>
            )}
          </div>
          {canAlign && item && (
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
