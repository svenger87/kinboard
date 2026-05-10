"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { Check, Lock, Star } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  TIER_THRESHOLDS_CENTS,
  type AvatarSpecies,
  type AvatarTier,
} from "@/lib/pocket-money/types";
import { tierFromLifetimeSaved } from "@/lib/pocket-money/interest";
import { formatCents } from "@/lib/pocket-money/format";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  species: AvatarSpecies;
  lifetimeSavedCents: number;
  currency: string;
}

export function StagesSheet({
  open,
  onOpenChange,
  species,
  lifetimeSavedCents,
  currency,
}: Props) {
  const t = useTranslations("pocketMoney");
  const currentTier = tierFromLifetimeSaved(lifetimeSavedCents);

  // Build the stage list from TIER_THRESHOLDS_CENTS so adding/removing
  // tiers in lib/pocket-money/types.ts is the single source of truth.
  const stages: ReadonlyArray<{ tier: AvatarTier; threshold: number }> =
    TIER_THRESHOLDS_CENTS.map((threshold, i) => ({
      tier: (i + 1) as AvatarTier,
      threshold,
    }));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t("stagesSheetTitle")}</SheetTitle>
          <SheetDescription>{t("stagesSheetDescription")}</SheetDescription>
        </SheetHeader>

        <ul className="mt-6 space-y-3">
          {stages.map(({ tier, threshold }) => {
            const isCurrent = tier === currentTier;
            const isUnlocked = tier <= currentTier;
            const stageName = t(`species.${species}.tier${tier}` as never);

            return (
              <li
                key={tier}
                className={`flex items-center gap-3 rounded-lg border p-3 ${
                  isCurrent
                    ? "border-month-primary bg-month-primary/5 ring-2 ring-month-primary/30"
                    : isUnlocked
                      ? "border-border"
                      : "border-border/50 opacity-60"
                }`}
              >
                <Image
                  src={`/pocket-money/avatars/${species}-${tier}.svg`}
                  alt=""
                  width={56}
                  height={56}
                  className="shrink-0"
                  unoptimized
                />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold flex items-center gap-2">
                    {stageName}
                    {isCurrent && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-month-primary text-month-primary-foreground font-medium">
                        {t("stagesCurrentBadge")}
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {threshold === 0
                      ? t("stagesStartingThreshold")
                      : t("stagesThreshold", {
                          amount: formatCents(threshold, currency),
                        })}
                  </p>
                </div>
                <div className="shrink-0">
                  {isCurrent ? (
                    <Star className="size-5 text-month-primary fill-month-primary" />
                  ) : isUnlocked ? (
                    <Check className="size-5 text-success" />
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
