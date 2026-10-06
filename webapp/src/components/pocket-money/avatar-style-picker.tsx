"use client";

import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import type { AvatarSpecies, AvatarTier } from "@/lib/pocket-money/types";
import {
  AVATAR_STYLES,
  STYLES,
  effectiveStyle,
  hasClassicArt,
  hasDrawnArt,
  isDrawnStyle,
  type AvatarStyle,
  type CreatureLook,
} from "@/lib/pocket-money/creatures";
import { CreatureAvatar } from "./creature-avatar";

interface Props {
  species: AvatarSpecies;
  /** The stage the previews show: the child's own, so they see what they will get. */
  tier: AvatarTier;
  value: AvatarStyle | string | null | undefined;
  onChange: (style: AvatarStyle) => void;
  disabled?: boolean;
  /** Whose avatar, for the group's accessible name. */
  childName: string;
  previewSize?: number;
  /** The child's own look, so the previews show their colours. */
  look?: CreatureLook;
}

/**
 * The four looks as small pictures of the child's own avatar at its current
 * stage -- not a list of names, because the names mean nothing until seen.
 * Used under Settings -> Pocket money and on the child's own page.
 *
 * A species without drawings yet shows the three drawn looks disabled, with a
 * swatch of each look's colours and "Coming for this species" -- rather than
 * letting a child pick one that would quietly look exactly like Classic.
 */
export function AvatarStylePicker({ species, tier, value, onChange, disabled, childName, previewSize = 64, look }: Props) {
  const t = useTranslations("pocketMoney");
  const drawn = hasDrawnArt(species);
  const current = effectiveStyle(species, value);
  // A creature that only exists drawn: Classic is its Gumdrop drawing, still.
  const classicStill = drawn && !hasClassicArt(species);

  return (
    <div className="space-y-2">
      <div
        role="radiogroup"
        aria-label={t("avatarStyleGroupAria", { name: childName })}
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        data-testid="avatar-style-picker"
      >
        {AVATAR_STYLES.map((style) => {
          const available = style === "classic" || drawn;
          const selected = current === style;
          return (
            <button
              key={style}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled || !available}
              onClick={() => !selected && onChange(style)}
              data-style={style}
              className={`relative flex flex-col items-center gap-1.5 rounded-xl border-2 p-2 text-center transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed ${
                selected
                  ? "border-primary bg-primary/5"
                  : available
                    ? "border-border hover:bg-accent/50"
                    : "border-dashed border-border/70 opacity-60"
              }`}
            >
              {available ? (
                <CreatureAvatar species={species} tier={tier} style={style} look={look} size={previewSize} animated={false} label="" />
              ) : (
                <StyleSwatch style={style} size={previewSize} />
              )}
              <span className="text-sm font-medium leading-tight">{t(`avatarStyles.${style}`)}</span>
              {!available && <span className="text-2xs leading-tight text-muted-foreground">{t("avatarStyleComingSoon")}</span>}
              {style === "classic" && classicStill && (
                <span className="text-2xs leading-tight text-muted-foreground">{t("avatarStyleClassicStill")}</span>
              )}
              {selected && (
                <span className="absolute right-1.5 top-1.5 rounded-full bg-primary p-0.5 text-primary-foreground">
                  <Check className="size-3" aria-hidden="true" />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {!drawn && (
        <p className="text-xs text-muted-foreground">
          {t("avatarStyleComingSoonHint", { species: t(`species.${species}.label` as never) })}
        </p>
      )}
    </div>
  );
}

/** A look's colours, for a species it has not been drawn for yet. */
function StyleSwatch({ style, size }: { style: AvatarStyle; size: number }) {
  if (!isDrawnStyle(style)) return null;
  const { pal, stroke } = STYLES[style];
  const dots = [pal.body, pal.belly, pal.wing, pal.horn];
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      {dots.map((c, i) => (
        <circle
          key={i}
          cx={20 + (i % 2) * 24}
          cy={20 + Math.floor(i / 2) * 24}
          r="10"
          fill={c}
          stroke={stroke ?? "none"}
          strokeWidth={stroke ? 2.5 : 0}
        />
      ))}
    </svg>
  );
}
