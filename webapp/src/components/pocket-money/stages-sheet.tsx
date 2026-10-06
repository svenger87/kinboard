"use client";

import { useTranslations } from "next-intl";
import { Check, Lock, Star } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import type { AvatarSpecies, AvatarTier } from "@/lib/pocket-money/types";
import type { AvatarStage } from "@/lib/pocket-money/points";
import { CreatureAvatar } from "./creature-avatar";
import type { CreatureLook } from "@/lib/pocket-money/creatures/look";
import { formatCents } from "@/lib/pocket-money/format";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  species: AvatarSpecies;
  /** The account's avatar_style: every stage is shown in the child's own look. */
  avatarStyle?: string | null;
  /** The child's own look (avatar_look). */
  look?: CreatureLook;
  /** What the avatar shows, in money or points mode (avatarStage). */
  stage: AvatarStage;
  currency: string;
}

export function StagesSheet({
  open,
  onOpenChange,
  species,
  avatarStyle,
  look,
  stage,
  currency,
}: Props) {
  const t = useTranslations("pocketMoney");
  const currentTier = stage.tier;
  // Stages above the current one but at or below the best-ever mark
  // are shown as previously reached rather than locked — the kid did
  // earn them, they just spent back down.
  const bestReached = stage.best;

  // Build the stage list from the mode's thresholds (TIER_THRESHOLDS_CENTS
  // or TIER_THRESHOLDS_POINTS in lib/pocket-money/types.ts), so adding or
  // removing tiers there is the single source of truth.
  const stages: ReadonlyArray<{ tier: AvatarTier; threshold: number }> =
    stage.thresholds.map((threshold, i) => ({
      tier: (i + 1) as AvatarTier,
      threshold,
    }));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t("stagesSheetTitle")}</SheetTitle>
          <SheetDescription>
            {stage.mode === "points" ? t("stagesSheetDescriptionPoints") : t("stagesSheetDescription")}
          </SheetDescription>
        </SheetHeader>

        <ul className="mt-6 space-y-3">
          {stages.map(({ tier, threshold }) => {
            const isCurrent = tier === currentTier;
            const isUnlocked = tier <= currentTier;
            // Reached before, spent back down out of. Distinguished
            // from never-reached so the sheet reads as a record of what
            // the kid achieved, not just what they hold today.
            const wasReached = !isUnlocked && tier <= bestReached;
            const stageName = t(`species.${species}.tier${tier}` as never);

            return (
              <li
                key={tier}
                className={`flex items-center gap-3 rounded-lg border p-3 ${
                  isCurrent
                    ? "border-month-primary bg-month-primary/5 ring-2 ring-month-primary/30"
                    : isUnlocked
                      ? "border-border"
                      : wasReached
                        ? "border-amber-400/40 bg-amber-400/[0.04]"
                        : "border-border/50 opacity-60"
                }`}
              >
                {/* Eight at once: static, the motion is for the avatar itself. */}
                <CreatureAvatar
                  species={species}
                  tier={tier}
                  style={avatarStyle}
                  look={look}
                  size={56}
                  animated={false}
                  label=""
                />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold flex items-center gap-2">
                    {stageName}
                    {isCurrent && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-month-primary text-month-primary-foreground font-medium">
                        {t("stagesCurrentBadge")}
                      </span>
                    )}
                    {wasReached && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-400/15 text-amber-300 font-medium">
                        {t("stagesReachedBadge")}
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {threshold === 0
                      ? t("stagesStartingThreshold")
                      : stage.mode === "points"
                        ? t("stagesThresholdPoints", { count: threshold })
                        : t("stagesThreshold", { amount: formatCents(threshold, currency) })}
                  </p>
                </div>
                <div className="shrink-0">
                  {isCurrent ? (
                    <Star className="size-5 text-month-primary fill-month-primary" />
                  ) : isUnlocked ? (
                    <Check className="size-5 text-success" />
                  ) : wasReached ? (
                    <Star className="size-5 text-amber-400" />
                  ) : (
                    <Lock className="size-5 text-muted-foreground/60" />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
