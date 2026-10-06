"use client";
/** @jsxImportSource react */
// The pragma is a no-op for Next; see lib/pocket-money/creatures/skeleton.tsx.

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Shuffle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AvatarSpecies, AvatarTier } from "@/lib/pocket-money/types";
import {
  ACCESSORIES,
  COLOR_NAMES,
  EYE_SHAPES,
  HAIRSTYLES,
  LOOK_SWATCHES,
  clampName,
  PATTERNS,
  STYLES,
  cleanName,
  effectiveStyle,
  hasClassicArt,
  isDrawnStyle,
  speciesArt,
  startOverLook,
  surpriseLook,
  type AvatarStyle,
  type CreatureLook,
} from "@/lib/pocket-money/creatures";
import { AvatarStylePicker } from "./avatar-style-picker";
import { CreatureAvatar, replayClass } from "./creature-avatar";

interface Props {
  species: AvatarSpecies;
  tier: AvatarTier;
  style: AvatarStyle | string | null | undefined;
  look: CreatureLook;
  childName: string;
  saving?: boolean;
  onSave: (next: { style: AvatarStyle; look: CreatureLook }) => void;
  onCancel: () => void;
}

type ColorKey = "body" | "belly" | "accent" | "hair" | "skin";

/**
 * "Change look": a child changes their own creature (RFC-016 §4) -- a name,
 * colours, a pattern, eyes, an accessory and the style; for the princess and
 * the prince also a skin tone, hair colour and hairstyle.
 *
 * Every choice is a draft shown at once on the live preview, which pops on
 * each change; nothing is stored until Save. One write per visit, not one per
 * tap: pocket_money_accounts is not in the supabase_realtime publication, so
 * the family's other screens pick a change up when they next refetch the
 * accounts, and a child trying ten colours should not leave whichever of ten
 * half-made looks a screen happened to fetch. It also makes Surprise me and
 * Start over safe to try -- Cancel undoes them.
 */
export function CreatureLookEditor({ species, tier, style, look, childName, saving, onSave, onCancel }: Props) {
  const t = useTranslations("pocketMoney");
  const art = speciesArt(species);
  const person = !!art?.person;
  const [draftStyle, setDraftStyle] = useState<AvatarStyle>(() => effectiveStyle(species, style));
  const [draft, setDraft] = useState<CreatureLook>(look);
  const preview = useRef<HTMLSpanElement>(null);
  const changes = useRef(0);
  const [changeCount, setChangeCount] = useState(0);
  const ids = useId();

  // The preview pops on every change.
  useEffect(() => {
    if (changes.current === changeCount) return;
    changes.current = changeCount;
    replayClass(preview.current, "creature-pop");
  }, [changeCount]);

  const change = (next: CreatureLook) => {
    setDraft(next);
    // A classic picture cannot show a colour or a bow: the first change moves
    // the draft to Gumdrop, visibly, in the style row below.
    if (draftStyle === "classic" && hasClassicArt(species)) setDraftStyle("gumdrop");
    setChangeCount((n) => n + 1);
  };
  const set = <K extends keyof CreatureLook>(key: K, value: CreatureLook[K]) => change({ ...draft, [key]: value });

  // What the drawing shows when the look leaves a colour unset: the
  // creature's own, or for the dragon its style's.
  const ownColors = (() => {
    if (art?.colors) return art.colors;
    const pal = STYLES[isDrawnStyle(draftStyle) ? draftStyle : "gumdrop"].pal;
    return { body: pal.body, belly: pal.belly, accent: pal.wing };
  })() as { body: string; belly: string; accent: string; skin?: string; hair?: string };
  const current = (key: ColorKey) => (draft[key] ?? ownColors[key] ?? "").toUpperCase();

  const swatches = (key: ColorKey, list: ReadonlyArray<string>, label: string): ReactNode => {
    const headingId = `${ids}-${key}`;
    return (
      <section className="space-y-2" key={key}>
        <h3 id={headingId} className="text-sm font-semibold">{label}</h3>
        <div role="group" aria-labelledby={headingId} className="flex flex-wrap gap-2" data-testid={`look-${key}`}>
          {list.map((hex) => {
            const pressed = current(key) === hex.toUpperCase();
            return (
              <button
                key={hex}
                type="button"
                aria-pressed={pressed}
                aria-label={t(`lookColors.${COLOR_NAMES[hex.toUpperCase()]}` as never)}
                title={t(`lookColors.${COLOR_NAMES[hex.toUpperCase()]}` as never)}
                data-color={hex}
                onClick={() => set(key, hex)}
                className={`size-10 rounded-full border-[3px] border-background transition active:scale-95 focus-visible:outline-dashed focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-foreground ${
                  // Selected is a solid ring in the accent colour; focus is a
                  // dashed outline in the text colour, further out, so the
                  // two never look alike and both show when they coincide.
                  pressed ? "ring-[3px] ring-primary" : "ring-2 ring-border"
                }`}
                style={{ background: hex }}
              />
            );
          })}
        </div>
      </section>
    );
  };

  const chips = <K extends "pattern" | "eyes" | "acc" | "hairstyle">(
    key: K,
    list: ReadonlyArray<NonNullable<CreatureLook[K]>>,
    label: string,
    names: string,
    fallback: NonNullable<CreatureLook[K]>,
  ): ReactNode => {
    const headingId = `${ids}-${key}`;
    const value = draft[key] ?? fallback;
    return (
      <section className="space-y-2" key={key}>
        <h3 id={headingId} className="text-sm font-semibold">{label}</h3>
        <div role="group" aria-labelledby={headingId} className="flex flex-wrap gap-2" data-testid={`look-${key}`}>
          {list.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={value === v}
              data-value={v}
              onClick={() => set(key, v as CreatureLook[K])}
              className={`min-h-10 rounded-full border-2 px-4 text-sm font-semibold transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                value === v ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-accent/50"
              }`}
            >
              {t(`lookEditor.${names}.${v}` as never)}
            </button>
          ))}
        </div>
      </section>
    );
  };

  const defaultHair = species === "princess" ? "long" : "short";

  return (
    <div className="grid gap-5 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] sm:items-start" data-testid="look-editor">
      {/* The preview stays in view while the choices scroll past. */}
      <div className="sticky top-0 z-10 -mx-1 flex flex-col items-center gap-1 rounded-2xl bg-background px-1 pb-2 pt-1 sm:top-2">
        <p className="min-h-7 text-xl font-bold" data-testid="look-preview-name">
          {cleanName(draft.name ?? "")}
        </p>
        <span ref={preview} className="creature-body" style={{ width: 140, height: 140 }} onAnimationEnd={(e) => e.currentTarget.classList.remove("creature-pop")}>
          <CreatureAvatar
            species={species}
            tier={tier}
            style={draftStyle}
            look={draft}
            size={140}
            label={t("lookEditor.previewAria", { name: childName })}
          />
        </span>
      </div>

      <div className="space-y-5">
        <section className="space-y-2">
          <label htmlFor={`${ids}-name`} className="text-sm font-semibold">
            {t("lookEditor.name")}
          </label>
          <Input
            id={`${ids}-name`}
            value={draft.name ?? ""}
            // Counted as the server counts it (graphemes, lib/.../look.ts), not
            // in UTF-16 units as maxLength would: 👨‍👩‍👧‍👦 is one character.
            autoComplete="off"
            placeholder={t("lookEditor.namePlaceholder")}
            onChange={(e) => setDraft({ ...draft, name: clampName(e.target.value) })}
            className="max-w-xs text-base"
            data-testid="look-name"
          />
        </section>

        {person && swatches("skin", LOOK_SWATCHES.skin, t("lookEditor.skin"))}
        {swatches("body", LOOK_SWATCHES.body, t(person ? "lookEditor.outfit" : "lookEditor.body"))}
        {swatches("belly", person ? LOOK_SWATCHES.trim : LOOK_SWATCHES.belly, t(person ? "lookEditor.trim" : "lookEditor.belly"))}
        {person
          ? swatches("hair", LOOK_SWATCHES.hair, t("lookEditor.hair"))
          : swatches("accent", LOOK_SWATCHES.accent, t("lookEditor.accent"))}
        {person && chips("hairstyle", HAIRSTYLES, t("lookEditor.hairstyle"), "hairstyles", defaultHair)}
        {chips("pattern", PATTERNS, t("lookEditor.pattern"), "patterns", "none")}
        {chips("eyes", EYE_SHAPES, t("lookEditor.eyes"), "eyeShapes", "round")}
        {chips("acc", ACCESSORIES, t("lookEditor.accessory"), "accessories", "none")}

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">{t("lookEditor.style")}</h3>
          <AvatarStylePicker
            species={species}
            tier={tier}
            value={draftStyle}
            look={draft}
            childName={childName}
            previewSize={64}
            onChange={(s) => {
              setDraftStyle(s);
              setChangeCount((n) => n + 1);
            }}
          />
        </section>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => change(surpriseLook(draft, person))} data-testid="look-surprise">
            <Shuffle className="mr-1.5 size-4" />
            {t("lookEditor.surprise")}
          </Button>
          <Button type="button" variant="outline" onClick={() => change(startOverLook(draft))} data-testid="look-start-over">
            <RotateCcw className="mr-1.5 size-4" />
            {t("lookEditor.startOver")}
          </Button>
        </div>

        <div className="sticky bottom-0 -mx-1 flex gap-2 bg-background px-1 py-3">
          <Button type="button" variant="ghost" className="flex-1" onClick={onCancel}>
            {t("lookEditor.cancel")}
          </Button>
          <Button
            type="button"
            className="flex-1"
            disabled={saving}
            onClick={() => onSave({ style: draftStyle, look: { ...draft, name: cleanName(draft.name ?? "") } })}
            data-testid="look-save"
          >
            {t("lookEditor.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
