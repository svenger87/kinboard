/**
 * The family's festivals (RFC-020 §4): which ones it celebrates on its
 * screens, and what each one built so far brings to the four layers (§2).
 * Pure; the dates are lib/festivals.ts, the provider that puts the festival
 * on `<html data-festival>` is hooks/use-festival.ts, the scene that flies
 * the visitor is components/weather-effects.tsx.
 *
 * The setting is `{ enabled, chosen }`. `chosen: null` means "the country's
 * common festivals" (§3.1) and follows the holiday region until someone in
 * the family ticks or unticks one; from then on it is the list they made.
 */

import { FESTIVALS, activeFestival, commonFestivals, isFestival, type ActiveFestival, type ActiveOptions, type FestivalId } from "@/lib/festivals";

export interface FestivalSettings {
  /** One switch for all of it (§4). */
  enabled: boolean;
  /** The festivals ticked, or null for the country's common ones. */
  chosen: FestivalId[] | null;
}

export const DEFAULT_FESTIVAL_SETTINGS: FestivalSettings = { enabled: true, chosen: null };

/** A stored value (anything, from any version) as complete, valid settings. */
export function normalizeFestivalSettings(value: unknown): FestivalSettings {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const chosen = Array.isArray(v.chosen) ? FESTIVALS.filter((id) => (v.chosen as unknown[]).includes(id)) : null;
  return { enabled: v.enabled !== false, chosen };
}

/* ---------------------------------------------------------------- what each festival brings */

export type VisitorKind = "sleigh" | "lanterns";
export type DressingKind = "snow" | "boot" | "lanterns";

export interface FestivalKit {
  /** Flies over Home and the screensaver every two minutes (§2.1); none for a quiet festival. */
  visitor: VisitorKind | null;
  /** Still, on Home's widget cards (§2.2): CSS in globals.css keyed off `data-festival`. */
  dressing: DressingKind | null;
  /** Worn instead of the child's own item in that slot (§2.3). */
  outfit: { slot: "head" | "neck"; item: string } | null;
}

/**
 * The festivals that have their artwork (RFC-020 §6, steps 1 and 2). Only
 * these are offered in Settings and only these can be on: a festival ticked
 * by default but not drawn yet would win its days over Christmas and show
 * nothing at all.
 */
export const FESTIVAL_KITS: Partial<Record<FestivalId, FestivalKit>> = {
  christmas: { visitor: "sleigh", dressing: "snow", outfit: { slot: "head", item: "santa_hat" } },
  // §3.3: no visitor; the boot by the Tasks card, empty on the eve, filled
  // on the morning; the shop's scarf.
  "st-nicholas": { visitor: null, dressing: "boot", outfit: { slot: "neck", item: "scarf" } },
  // §3.3: the lantern walk along the bottom, lanterns hanging from the cards, from dusk.
  "st-martin": { visitor: "lanterns", dressing: "lanterns", outfit: null },
};

export const BUILT_FESTIVALS: FestivalId[] = FESTIVALS.filter((id) => FESTIVAL_KITS[id]);

/** The festivals ticked: the family's list, or the country's common ones, and only those drawn so far. */
export function chosenFestivals(settings: FestivalSettings, country: string | null | undefined): FestivalId[] {
  if (!settings.enabled) return [];
  const list = settings.chosen ?? commonFestivals(country);
  return list.filter((id) => FESTIVAL_KITS[id]);
}

/** On Home and the screensaver right now, from the family's settings; null when none. */
export function currentFestival(
  now: Date,
  settings: FestivalSettings,
  country: string | null | undefined,
  timeZone?: string,
  options: Omit<ActiveOptions, "country"> = {},
): ActiveFestival | null {
  return activeFestival(now, chosenFestivals(settings, country), timeZone, { ...options, country });
}

/**
 * Which part of the festival it is, for a dressing that changes over it:
 * St Nicholas's boot stands empty on the evening of the 5th and is filled on
 * the morning of the 6th (§3.3).
 */
export function festivalStage(active: Pick<ActiveFestival, "id" | "day" | "start"> | null): "eve" | "day" | null {
  if (!active) return null;
  if (active.id === "st-nicholas") return active.day === active.start ? "eve" : "day";
  return null;
}

/* ---------------------------------------------------------------- preview */

/** `?festival-preview=christmas` on Home, or a Preview button in settings: this long (§4). */
export const FESTIVAL_PREVIEW_MS = 2 * 60_000;

/** A preview names a festival that is drawn, and nothing else. */
export function parseFestivalPreview(param: string | null | undefined): FestivalId | null {
  const id = (param ?? "").trim();
  return isFestival(id) && FESTIVAL_KITS[id] ? id : null;
}

/* ---------------------------------------------------------------- outfits */

/** The kid-side switch (creatures.look.festive = "off"): this child's creature wears no festival outfit. */
export interface FestiveLookFields {
  festive?: "off";
  head?: string;
  neck?: string;
}

/**
 * A creature's look with the festival's item worn instead of the child's own
 * in that slot (§2.3). The child's own item is untouched in the stored look,
 * so it is back the day after. Nothing changes for a child who switched
 * festival outfits off, or when no festival is on.
 */
export function withFestivalOutfit<L extends FestiveLookFields>(look: L, festival: FestivalId | null): L {
  const outfit = festival ? FESTIVAL_KITS[festival]?.outfit : null;
  if (!outfit || look.festive === "off") return look;
  return { ...look, [outfit.slot]: outfit.item };
}

/* ---------------------------------------------------------------- before first paint */

/** The festival this device last worked out, with its window: `{ id, stage, start, end }`. */
export const FESTIVAL_STORAGE_KEY = "kinboard_festival";

/**
 * Inline in <body> ahead of the app, beside MOTION_INIT_SCRIPT: puts the
 * festival this device last worked out on `<html data-festival>` while its
 * window is still on by this device's calendar, so the colour wash and the
 * dressing are there from the first frame instead of arriving a second later.
 * hooks/use-festival.ts corrects it as soon as the family's setting is in.
 */
export const FESTIVAL_INIT_SCRIPT = `(function(){try{var f=JSON.parse(localStorage.getItem(${JSON.stringify(
  FESTIVAL_STORAGE_KEY
)})||"null");if(!f||typeof f.id!=="string"||!/^[a-z-]+$/.test(f.id))return;var d=new Date(),t=d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2);if(t<f.start||t>f.end)return;var h=document.documentElement;h.setAttribute("data-festival",f.id);if(f.stage==="eve"||f.stage==="day")h.setAttribute("data-festival-stage",f.stage)}catch(e){}})();`;
