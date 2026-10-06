"use client";
/** @jsxImportSource react */
// The pragma is a no-op for Next; see lib/pocket-money/creatures/skeleton.tsx.

import { useTranslations } from "next-intl";
import type { AvatarSpecies, AvatarTier } from "@/lib/pocket-money/types";
import { hasDrawnArt, type AvatarStyle, type CreatureLook } from "@/lib/pocket-money/creatures";
import avatarCatalog from "@/plugins/pocket-money/catalog/avatars.json";
import { CreatureAvatar } from "./creature-avatar";

// Every species in the catalog: adding one to avatars.json adds it here.
export const SPECIES_IDS: ReadonlyArray<AvatarSpecies> = avatarCatalog.species.map((s) => s.id);
const PREVIEW_TIERS: ReadonlyArray<AvatarTier> = [1, 2, 3, 4, 5, 6, 7, 8];

interface Props {
  picked: AvatarSpecies | null;
  onPick: (species: AvatarSpecies) => void;
  /**
   * The child's avatar_style, when there is a child already: every preview
   * is drawn in it (CreatureAvatar falls back per species). Left out at
   * setup, where each species shows its Gumdrop drawing, or its classic
   * pictures if it has no drawing.
   */
  avatarStyle?: AvatarStyle | string | null;
  /** The child's own look, so the previews show their colours. */
  look?: CreatureLook;
  /** The species the child has now, marked as such. */
  current?: AvatarSpecies;
}

function SpeciesStage({ species, tier, size, avatarStyle, look }: {
  species: AvatarSpecies;
  tier: AvatarTier;
  size: number;
  avatarStyle?: AvatarStyle | string | null;
  look?: CreatureLook;
}) {
  return (
    <CreatureAvatar
      species={species}
      tier={tier}
      style={avatarStyle !== undefined ? avatarStyle : hasDrawnArt(species) ? "gumdrop" : "classic"}
      look={look}
      size={size}
      animated={false}
      label=""
    />
  );
}

/**
 * Every creature, each with its eight stages, and the picked one larger with
 * the stage names -- so a parent sees the journey before picking. Used when
 * a child's account is set up and when a parent changes the creature later.
 */
export function SpeciesPicker({ picked, onPick, avatarStyle, look, current }: Props) {
  const t = useTranslations("settings.pocketMoney");
  const tPM = useTranslations("pocketMoney");
  const speciesLabel = (s: AvatarSpecies): string => tPM(`species.${s}.label` as never);
  const stageLabel = (s: AvatarSpecies, tier: number): string => tPM(`species.${s}.tier${tier}` as never);
  const pickedPreview = picked && SPECIES_IDS.includes(picked) ? picked : null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" data-testid="species-picker">
        {SPECIES_IDS.map((preview) => {
          const isPicked = picked === preview;
          return (
            <button
              key={preview}
              type="button"
              data-species={preview}
              onClick={() => onPick(preview)}
              className={`flex flex-col items-start gap-2 rounded-lg border-2 p-3 transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                isPicked
                  ? "border-primary bg-primary/5 ring-2 ring-primary/30"
                  : "border-border hover:bg-accent/50"
              }`}
              aria-pressed={isPicked}
            >
              <span className="flex w-full items-center justify-between gap-2 text-sm font-semibold">
                {speciesLabel(preview)}
                {current === preview && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-3xs font-medium text-muted-foreground">
                    {t("speciesCurrent")}
                  </span>
                )}
              </span>
              <div className="flex w-full items-center justify-between gap-1">
                {PREVIEW_TIERS.map((tier) => (
                  <SpeciesStage key={tier} species={preview} tier={tier} size={28} avatarStyle={avatarStyle} look={look} />
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {pickedPreview && (
        <div className="rounded-lg border border-border bg-accent/30 p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            {t("speciesPreviewTitle", { species: speciesLabel(pickedPreview) })}
          </p>
          <div className="flex items-start gap-2 overflow-x-auto">
            {PREVIEW_TIERS.map((tier) => (
              <div key={tier} className="flex flex-col items-center gap-1 min-w-[64px]">
                <SpeciesStage species={pickedPreview} tier={tier} size={40} avatarStyle={avatarStyle} look={look} />
                <span className="text-3xs text-muted-foreground text-center leading-tight">
                  {stageLabel(pickedPreview, tier)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
