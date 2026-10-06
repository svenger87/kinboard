"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { AvatarSpecies } from "@/lib/pocket-money/types";
import type { AvatarStyle, CreatureLook } from "@/lib/pocket-money/creatures";
import { SpeciesPicker } from "./species-picker";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  childName: string;
  current: AvatarSpecies;
  avatarStyle: AvatarStyle | string | null;
  look: CreatureLook;
  saving: boolean;
  /**
   * Saves the new species, and only the species: the stage comes from money
   * or points and best_tier, the style and the look stay as they are.
   * Resolves true when it was saved.
   */
  onSave: (species: AvatarSpecies) => Promise<boolean>;
}

/**
 * A parent changing a child's creature after the account exists (Settings ->
 * Pocket money, behind the settings PIN). The child's own page has no such
 * switch: the creature stays the parent's choice (RFC-016 §4.1).
 */
export function ChangeCreatureSheet({ open, onOpenChange, childName, current, avatarStyle, look, saving, onSave }: Props) {
  const t = useTranslations("settings.pocketMoney");
  const tPM = useTranslations("pocketMoney");
  const [picked, setPicked] = useState<AvatarSpecies | null>(null);
  const speciesLabel = (s: AvatarSpecies): string => tPM(`species.${s}.label` as never);

  // The species to switch to: null until a different one is picked.
  const target = picked !== null && picked !== current ? picked : null;
  // "Funkel becomes a T-Rex": the creature's own name if it has one,
  // otherwise "Mia's creature".
  const who = look.name || t("changeCreatureWhoFallback", { name: childName });

  const close = (next: boolean) => {
    if (!next) setPicked(null);
    onOpenChange(next);
  };

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto" data-testid="change-creature-sheet">
        <SheetHeader>
          <SheetTitle>{t("changeCreatureTitle", { name: childName })}</SheetTitle>
          <SheetDescription>{t("changeCreatureHint")}</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          <SpeciesPicker
            picked={picked ?? current}
            onPick={setPicked}
            avatarStyle={avatarStyle}
            look={look}
            current={current}
          />

          {/* Kept in view while the list scrolls: the confirmation and Save
              are what the pick is for. */}
          <div className="sticky -bottom-6 -mx-6 space-y-2 border-t border-border bg-background px-6 pb-6 pt-3">
            {target && (
              <p
                className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm font-medium"
                data-testid="change-creature-confirm"
                aria-live="polite"
              >
                {t("changeCreatureConfirm", { who, species: target, label: speciesLabel(target) })}
              </p>
            )}

            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => close(false)}>
                {t("cancel")}
              </Button>
              <Button
                type="button"
                className="flex-1"
                disabled={!target || saving}
                data-testid="change-creature-save"
                onClick={async () => {
                  if (!target) return;
                  if (await onSave(target)) close(false);
                }}
              >
                {target ? t("changeCreatureSave", { label: speciesLabel(target) }) : t("changeCreatureSaveIdle")}
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
