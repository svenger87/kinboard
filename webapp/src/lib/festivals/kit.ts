/**
 * A festival kit (RFC-020 §2, §3.3): everything one festival brings to the
 * four layers, in one file of its own, lib/festivals/kits/<id>.ts.
 *
 * - **visitor**: what flies over Home and the screensaver every two minutes,
 *   as an archetype and its options (lib/festivals/visitors/types.ts)
 * - **dressing**: still decorations on Home's widget cards, as CSS scoped to
 *   the festival (`dressing(s)` gets the selectors to use)
 * - **outfit**: what the creatures wear instead of their own in a slot
 * - **wash**: the colour wash's two colours, light and dark
 * - **stage**: a part of the festival the dressing changes with (St
 *   Nicholas's boot, empty on the eve and filled in the morning)
 *
 * The dates are lib/festivals.ts, not here: a kit is the look, the calendar
 * is shared. Adding a festival is a kit, its art, and one line in
 * kits/index.ts (docs/festivals/ADDING-A-FESTIVAL.md).
 */

import type { ReactNode } from "react";
import type { ActiveFestival, FestivalId } from "@/lib/festivals";
import type { StyleSpec } from "@/lib/pocket-money/creatures/styles";
import type { EyeSpot } from "@/lib/pocket-money/creatures/item-draw";
import type { VisitorSpec } from "@/lib/festivals/visitors/types";

/** An HSL triple as the theme's variables take it: `"355 70% 46%"`. */
export type Hsl = `${number} ${number}% ${number}%`;

/**
 * The colour wash during the festival (§2.4): one colour glowing from the
 * top, one rising from the bottom, at the month's strengths (so contrast
 * doesn't change), for the light and the dark theme.
 */
export interface Wash {
  light: [top: Hsl, bottom: Hsl];
  dark: [top: Hsl, bottom: Hsl];
}

/**
 * A festival item (§2.3), worn instead of the child's own in its slot.
 * Either one of the shop's items by id (`scarf`, `star_glasses`), or the
 * festival's own, drawn here: head and neck items in the head's own space (a
 * head of radius 34 at the origin, as items.tsx draws the shop's), a face
 * item on the eyes, a background in the 200 x 200 box.
 */
export type FestivalItem =
  | { slot: "head" | "neck"; item: string; draw?: (st: StyleSpec) => ReactNode }
  | { slot: "face"; item: string; draw?: (st: StyleSpec, eyes: EyeSpot, cx: number, r: number) => ReactNode }
  | { slot: "background"; item: string; draw?: (uid: string) => ReactNode };

/** What a stage rule sees: today in the festival's window, and the family's country. */
export type StageInput = Pick<ActiveFestival, "day" | "start" | "end" | "dayIndex" | "days" | "minutes" | "afterDusk" | "visitorReady"> & {
  country: string | null;
};

/** The selectors a kit's dressing CSS uses: all scoped to its own festival and to Animations On or Reduced (§4). */
export interface DressingSelectors {
  /** `<html>` while the festival is on. Start every rule from this or one of the others. */
  root: string;
  /** `<html>` at one stage of the festival. */
  stage: (name: string) => string;
  /** Every widget card on Home's grid, except those that clip their content (the photo). */
  cards: string;
  /** The cards, at one stage. */
  cardsAt: (name: string) => string;
  /** The Tasks card alone. */
  tasks: string;
  /** The Tasks card, at one stage. */
  tasksAt: (name: string) => string;
  /** `url("/festivals/<id>/<name>.svg")`: a still drawing from the kit's own art folder. */
  art: (name: string) => string;
}

export interface FestivalKit {
  id: FestivalId;
  /**
   * Drawn, but not offered yet: it can be previewed (the gallery,
   * `?festival-preview=`) and reviewed, but not ticked in Settings or shown
   * by the date. Taken out when the owner has seen it on the household.
   */
  draft?: boolean;
  wash: Wash;
  /** A wash per stage, where the festival's colours depend on it (a national day's flag). */
  washByStage?: Readonly<Record<string, Wash>>;
  visitor: VisitorSpec | null;
  /** The dressing's CSS, or null for none. */
  dressing: ((s: DressingSelectors) => string) | null;
  outfit: readonly FestivalItem[];
  /** The stage today, or null; must be one of `stages`. */
  stage?: (at: StageInput) => string | null;
  /** Every stage `stage` can return, for the gallery and the before-first-paint script. */
  stages?: readonly string[];
  /** The stage a preview shows (St Nicholas's preview shows the filled boot). */
  previewStage?: string;
}

/** A kit, checked against the type (kits/<id>.ts's default export). */
export function defineFestival(kit: FestivalKit): FestivalKit {
  return kit;
}

/**
 * CSS as a template string, for the dressing: a tag so an editor can
 * highlight it, and nothing else. Values are interpolated as they are.
 */
export function css(strings: TemplateStringsArray, ...values: Array<string | number>): string {
  return strings.reduce((out, s, i) => out + s + (i < values.length ? String(values[i]) : ""), "");
}

/** The cards on Home's widget grid that dressing hangs on (app/page.tsx's `.festival-grid`). */
const CARDS = ".festival-grid > :not(button):not(.overflow-hidden)";
/** Dressing is still: on with Animations On and Reduced, never Off, which keeps the colour wash only (§4). */
const MOVING = ':not([data-motion="off"])';

export function dressingSelectors(id: FestivalId): DressingSelectors {
  const root = `:root[data-festival="${id}"]${MOVING}`;
  const stage = (name: string) => `:root[data-festival="${id}"][data-festival-stage="${name}"]${MOVING}`;
  return {
    root,
    stage,
    cards: `${root} ${CARDS}`,
    cardsAt: (name) => `${stage(name)} ${CARDS}`,
    tasks: `${root} .festival-tasks`,
    tasksAt: (name) => `${stage(name)} .festival-tasks`,
    art: (name) => `url("/festivals/${id}/${name}.svg")`,
  };
}

/** The wash as CSS: the two colours on `<html data-festival>`, light and dark, and per stage. */
export function washCss(kit: FestivalKit): string {
  const rule = (sel: string, [top, bottom]: [Hsl, Hsl]) => `${sel} { --festival-top: ${top}; --festival-bottom: ${bottom}; }`;
  const out = [
    rule(`:root[data-festival="${kit.id}"]`, kit.wash.light),
    rule(`:root.dark[data-festival="${kit.id}"]`, kit.wash.dark),
  ];
  for (const [stage, wash] of Object.entries(kit.washByStage ?? {})) {
    out.push(rule(`:root[data-festival="${kit.id}"][data-festival-stage="${stage}"]`, wash.light));
    out.push(rule(`:root.dark[data-festival="${kit.id}"][data-festival-stage="${stage}"]`, wash.dark));
  }
  return out.join("\n");
}

/** A kit's whole stylesheet: its wash, then its dressing. */
export function kitCss(kit: FestivalKit): string {
  const dressing = kit.dressing ? kit.dressing(dressingSelectors(kit.id)).trim() : "";
  return `/* ${kit.id} */\n${washCss(kit)}${dressing ? `\n${dressing}` : ""}`;
}
