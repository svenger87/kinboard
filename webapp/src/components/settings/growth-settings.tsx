"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useGrowthPointsSetting, useSaveGrowthPoints } from "@/hooks/use-point-rewards";
import { isGrowthPoints } from "@/lib/pocket-money/points";
import { TIER_THRESHOLDS_POINTS } from "@/lib/pocket-money/types";

/**
 * Settings -> Creatures -> Growing: how many earned task points each stage
 * needs (stages 2 to 8; stage 1, the egg, is where every creature starts).
 * Saved on leaving a field through PUT /api/creatures/growth (settings PIN),
 * which keeps every creature at the stage it has, so raising a number never
 * shrinks one. A stage changed shows its standard number; one button puts
 * them all back. Creatures growing with pocket money follow the money.
 */
export function GrowthSettings() {
  const t = useTranslations("settings.creatures");
  const { thresholds, ready } = useGrowthPointsSetting();
  const save = useSaveGrowthPoints();
  // Locked until the family's numbers are in, and while one change is saving:
  // each save is the whole list, built on what is shown.
  const locked = !ready || save.isPending;
  const standard = thresholds.every((v, i) => v === TIER_THRESHOLDS_POINTS[i]);

  const failed = (err: unknown) =>
    toast.error(err instanceof Error && err.message === "pin_required" ? t("errorPinRequired") : t("errorGeneric"));

  const send = (points: number[] | null) =>
    save
      .mutateAsync(points)
      .then(({ kept }) => {
        if (kept > 0) toast.success(t("growthKept", { count: kept }));
      });

  const commit = (stage: number, field: HTMLInputElement) => {
    const now = thresholds[stage - 1];
    const raw = field.value.trim();
    // Emptied: back to the standard number for that stage.
    const value = raw === "" ? TIER_THRESHOLDS_POINTS[stage - 1] : Number(raw);
    if (value === now) {
      field.value = String(now);
      return;
    }
    const list = thresholds.slice(1).map((v, i) => (i + 2 === stage ? value : v));
    if (!isGrowthPoints(list)) {
      field.value = String(now);
      toast.error(t("growthInvalid"));
      return;
    }
    const isStandard = list.every((v, i) => v === TIER_THRESHOLDS_POINTS[i + 1]);
    send(isStandard ? null : list).catch((err: unknown) => {
      field.value = String(now);
      failed(err);
    });
  };

  return (
    <Card id="growth" data-setting="growth" className="p-4 space-y-4" data-testid="growth-points">
      <div className="space-y-1">
        <Label className="text-base">{t("growthLabel")}</Label>
        <p className="text-sm text-muted-foreground">{t("growthHint")}</p>
      </div>
      <ul className="space-y-2">
        {thresholds.slice(1).map((points, i) => {
          const stage = i + 2;
          const label = stage === 2 ? t("growthHatch") : t("growthStage", { n: stage });
          return (
            <li key={stage} className="flex items-center gap-3">
              <label htmlFor={`growth-${stage}`} className="min-w-0 flex-1 text-sm">
                {label}
              </label>
              {points !== TIER_THRESHOLDS_POINTS[stage - 1] && (
                <span className="text-xs text-muted-foreground" data-testid={`growth-standard-${stage}`}>
                  {t("pricesStandard", { count: TIER_THRESHOLDS_POINTS[stage - 1] })}
                </span>
              )}
              <Input
                // A new key when the stored number changes, so the field shows it.
                key={`${stage}:${points}`}
                id={`growth-${stage}`}
                aria-label={t("growthAria", { n: stage })}
                className="w-28 text-right tabular-nums"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                defaultValue={points}
                disabled={locked}
                onBlur={(e) => commit(stage, e.target)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
            </li>
          );
        })}
      </ul>
      {!standard && (
        <Button variant="outline" size="sm" disabled={locked} onClick={() => send(null).catch(failed)}>
          {t("growthReset")}
        </Button>
      )}
    </Card>
  );
}
