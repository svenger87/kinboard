/**
 * The family's festivals (RFC-020 §4): which ones it celebrates on its
 * screens, and which part of a festival it is. Pure; the dates are
 * lib/festivals.ts, what each festival looks like is its kit
 * (lib/festivals/kits/), the provider that puts the festival on
 * `<html data-festival>` is hooks/use-festival.ts, the scene that flies the
 * visitor is components/weather-effects.tsx.
 *
 * The setting is `{ enabled, chosen }`. `chosen: null` means "the country's
 * common festivals" (§3.1) and follows the holiday region until someone in
 * the family ticks or unticks one; from then on it is the list they made.
 */

import { FESTIVALS, activeFestival, commonFestivals, isFestival, type ActiveFestival, type ActiveOptions, type FestivalId } from "@/lib/festivals";
import { BUILT_FESTIVALS, DRAWN_FESTIVALS, festivalKit } from "@/lib/festivals/kits";

export { BUILT_FESTIVALS, DRAWN_FESTIVALS, FESTIVAL_KITS, festivalKit } from "@/lib/festivals/kits";

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

/** The festivals ticked: the family's list, or the country's common ones, and only those drawn so far. */
export function chosenFestivals(settings: FestivalSettings, country: string | null | undefined): FestivalId[] {
  if (!settings.enabled) return [];
  const list = settings.chosen ?? commonFestivals(country);
  return list.filter((id) => BUILT_FESTIVALS.includes(id));
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
 * Which part of the festival it is, for a dressing that changes over it --
 * St Nicholas's boot stands empty on the evening of the 5th and is filled on
 * the morning of the 6th (§3.3) -- from the kit's own rule; null when the
 * festival has none. `<html data-festival-stage>` carries it.
 */
export type FestivalStage = string;

export function festivalStage(
  active: Pick<ActiveFestival, "id" | "day" | "start" | "end" | "dayIndex" | "days" | "minutes" | "afterDusk" | "visitorReady"> | null,
  country: string | null = null,
): FestivalStage | null {
  if (!active) return null;
  const rule = festivalKit(active.id)?.stage;
  if (!rule) return null;
  const stage = rule({ ...active, country: country ? country.slice(0, 2).toUpperCase() : null });
  return stage && STAGE.test(stage) ? stage : null;
}

/** What a stage may be: it ends up in an attribute and in the before-first-paint script's check. */
const STAGE = /^[a-z0-9-]{1,24}$/;

/* ---------------------------------------------------------------- preview */

/** `?festival-preview=christmas` on Home, or a Preview button in settings: this long (§4). */
export const FESTIVAL_PREVIEW_MS = 2 * 60_000;

/** A preview names a festival that is drawn (a draft too, for review), and nothing else. */
export function parseFestivalPreview(param: string | null | undefined): FestivalId | null {
  const id = (param ?? "").trim();
  return isFestival(id) && DRAWN_FESTIVALS.includes(id) ? id : null;
}

/** A stage a preview may show: one the kit has. */
export function parseFestivalPreviewStage(id: FestivalId, stage: string | null | undefined): FestivalStage | null {
  const kit = festivalKit(id);
  if (stage && kit?.stages?.includes(stage)) return stage;
  return kit?.previewStage ?? null;
}

/* ---------------------------------------------------------------- outfits */

/** The kid-side switch (creatures.look.festive = "off"): this child's creature wears no festival outfit. */
export interface FestiveLookFields {
  festive?: "off";
  head?: string;
  face?: string;
  neck?: string;
  background?: string;
}

/**
 * A creature's look with the festival's item worn instead of the child's own
 * in that slot (§2.3). The child's own item is untouched in the stored look,
 * so it is back the day after. Nothing changes for a child who switched
 * festival outfits off, or when no festival is on.
 */
export function withFestivalOutfit<L extends FestiveLookFields>(look: L, festival: FestivalId | null): L {
  const outfit = festivalKit(festival)?.outfit ?? [];
  if (outfit.length === 0 || look.festive === "off") return look;
  const worn: L = { ...look };
  for (const { slot, item } of outfit) worn[slot] = item;
  return worn;
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
)})||"null");if(!f||typeof f.id!=="string"||!/^[a-z-]+$/.test(f.id))return;var d=new Date(),t=d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2);if(t<f.start||t>f.end)return;var h=document.documentElement;h.setAttribute("data-festival",f.id);if(typeof f.stage==="string"&&/^[a-z0-9-]{1,24}$/.test(f.stage))h.setAttribute("data-festival-stage",f.stage)}catch(e){}})();`;
