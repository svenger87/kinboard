/**
 * A child's own look for their creature (pocket_money_accounts.avatar_look):
 * a name, colours, a pattern, eyes, an accessory and, for the princess and
 * the prince, a skin tone, a hair colour and a hairstyle (RFC-016 §4).
 *
 * Everything is chosen from the fixed sets below, the creature workshop's,
 * so every combination still looks good and the eyes stay readable on every
 * body. The server refuses anything else (validateLook, used by
 * PATCH /api/pocket-money/accounts/[id]); a restore and the screens keep the
 * valid keys of a stored look and drop the rest (restorableLook), since a
 * cosmetic field must never fail a restore.
 *
 * `{}` is the creature's own colours. Every key is optional, so a new option
 * later needs no migration. No React here: the API route imports it.
 */

export const LOOK_SWATCHES = {
  body: ["#6FCF97", "#FF8A5B", "#8C7AE6", "#56B6E8", "#FFC83D", "#FF8FC0", "#2EC4B6", "#A47551", "#8FB8DE", "#FFB054"],
  belly: ["#FFF4C7", "#FFE3B8", "#F2E9FF", "#FFFFFF", "#DDF7E8", "#FFE6F0"],
  /** A princess's or prince's trim: the "tummy" swatches for a person. */
  trim: ["#FFF1A8", "#FFC83D", "#FFFFFF", "#F2E9FF", "#DDF7E8", "#FFE6F0"],
  accent: ["#56B6E8", "#FFB547", "#F6A6D7", "#3FA877", "#E8613A", "#B9AEF5", "#E8558F", "#7A4E2D"],
  hair: ["#2B1D14", "#3B2A20", "#8B5A2B", "#C97C3C", "#E8C170", "#F2E2B8", "#D9434F", "#B58CFF"],
  skin: ["#FBE0C8", "#F2C8A0", "#D9A27A", "#B07850", "#7A4E33"],
} as const;

export const PATTERNS = ["none", "spots", "stripes", "hearts"] as const;
export const EYE_SHAPES = ["round", "sparkly", "happy"] as const;
export const ACCESSORIES = ["none", "bow", "hat", "glasses", "flower"] as const;
export const HAIRSTYLES = ["short", "long", "ponytail", "curls"] as const;

export type Pattern = (typeof PATTERNS)[number];
export type EyeShape = (typeof EYE_SHAPES)[number];
export type Accessory = (typeof ACCESSORIES)[number];
export type Hairstyle = (typeof HAIRSTYLES)[number];

export const NAME_MAX = 16;

export interface CreatureLook {
  name?: string;
  body?: string;
  /** The tummy, or a person's trim. */
  belly?: string;
  /** Wings, ears and fins. */
  accent?: string;
  skin?: string;
  hair?: string;
  hairstyle?: Hairstyle;
  pattern?: Pattern;
  eyes?: EyeShape;
  acc?: Accessory;
}

const upper = (list: ReadonlyArray<string>) => new Set(list.map((c) => c.toUpperCase()));

/** Which values each key takes. The belly takes the tummy and the trim swatches alike. */
const ALLOWED: Record<Exclude<keyof CreatureLook, "name">, ReadonlySet<string>> = {
  body: upper(LOOK_SWATCHES.body),
  belly: upper([...LOOK_SWATCHES.belly, ...LOOK_SWATCHES.trim]),
  accent: upper(LOOK_SWATCHES.accent),
  skin: upper(LOOK_SWATCHES.skin),
  hair: upper(LOOK_SWATCHES.hair),
  hairstyle: new Set(HAIRSTYLES),
  pattern: new Set(PATTERNS),
  eyes: new Set(EYE_SHAPES),
  acc: new Set(ACCESSORIES),
};
const COLOR_KEYS = new Set(["body", "belly", "accent", "skin", "hair"]);

export const LOOK_KEYS: ReadonlyArray<keyof CreatureLook> = ["name", "body", "belly", "accent", "skin", "hair", "hairstyle", "pattern", "eyes", "acc"];

/**
 * The most a raw name may be before it is cleaned. The route refuses more
 * with a 400 rather than run the cleaning over a megabyte of text.
 */
export const NAME_RAW_MAX = 256;

/**
 * Bidi controls (U+202A-U+202E, U+2066-U+2069), the zero-width space and the
 * BOM: invisible, and the first can turn the text around it backwards. Not
 * all of \p{Cf}: the zero-width joiner holds 👨‍👩‍👧‍👦 together, and the
 * non-joiner is part of how Persian is written.
 */
const BIDI_AND_ZERO_WIDTH = /[\u202A-\u202E\u2066-\u2069\u200B\uFEFF]/g;
/** Characters that draw nothing: a name made only of these is no name. */
const INVISIBLE = /[\s\u3164\u2800\u115F\u1160\uFFA0\u200C\u200D\u2060]/gu;

const segmenter: { segment(s: string): Iterable<{ segment: string }> } | null =
  typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

/**
 * What a person sees as characters: 👍🏽, ❤️, 🇩🇪 and 👨‍👩‍👧‍👦 are one each.
 * Code points where Intl.Segmenter is missing (an old browser), which can
 * only make a name shorter there, never longer than the server allows.
 */
export function graphemes(s: string): string[] {
  return segmenter ? Array.from(segmenter.segment(s), (g) => g.segment) : Array.from(s);
}

/**
 * At most NAME_MAX characters as a person counts them, as the name field
 * types. Not cleaned or trimmed, so a space can still be typed between words.
 */
export function clampName(s: string): string {
  const g = graphemes(s);
  return g.length > NAME_MAX ? g.slice(0, NAME_MAX).join("") : s;
}

/**
 * A name as it is stored: line breaks and tabs become spaces; other control
 * characters, bidi controls, the zero-width space and the BOM are removed;
 * white space is collapsed and trimmed; at most NAME_MAX graphemes, so an
 * emoji with a skin tone, a flag or a family is never cut in half. A name of
 * nothing but white space and invisible fillers (U+3164, U+2800, ...) is "".
 */
export function cleanName(raw: string): string {
  const stripped = raw
    .replace(/[\t\n\r\v\f\u2028\u2029]/g, " ")
    .replace(/\p{Cc}/gu, "")
    .replace(BIDI_AND_ZERO_WIDTH, "")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped.replace(INVISIBLE, "") === "") return "";
  return graphemes(stripped).slice(0, NAME_MAX).join("").trim();
}

export type LookResult = { ok: true; look: CreatureLook } | { ok: false; error: string };

/**
 * Check a look against the fixed sets. Unknown keys and out-of-set values are
 * refused, never dropped silently: a client sending them is out of date or
 * up to something. Colours are stored upper-case. An empty name is left out.
 */
export function validateLook(input: unknown): LookResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "avatar_look must be an object" };
  }
  const look: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!(LOOK_KEYS as ReadonlyArray<string>).includes(key)) return { ok: false, error: `unknown avatar_look key: ${key}` };
    if (typeof value !== "string") return { ok: false, error: `avatar_look.${key} must be a string` };
    if (key === "name") {
      if (value.length > NAME_RAW_MAX) return { ok: false, error: "avatar_look.name is too long" };
      const name = cleanName(value);
      if (name) look.name = name;
      continue;
    }
    const v = COLOR_KEYS.has(key) ? value.toUpperCase() : value;
    if (!ALLOWED[key as keyof typeof ALLOWED].has(v)) return { ok: false, error: `avatar_look.${key} is not one of the choices` };
    look[key] = v;
  }
  return { ok: true, look: look as CreatureLook };
}

/**
 * A stored look as the screens show it and a restore writes it: every key
 * the editor knows with a value from its set, and nothing else. One bad key
 * -- from a newer version after a rollback, or a newer backup -- drops only
 * itself, so the name and the colours survive. Anything not an object is {}.
 * The PATCH stays strict (validateLook): a client sending a bad key is out of
 * date, and is told so.
 */
export function restorableLook(value: unknown): CreatureLook {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const look: CreatureLook = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    const one = validateLook({ [key]: v });
    if (one.ok) Object.assign(look, one.look);
  }
  return look;
}

/** A stored look as the screens read it: see restorableLook. */
export function readLook(value: unknown): CreatureLook {
  return restorableLook(value);
}

/**
 * Colour names, for the swatches' accessible names (pocketMoney.lookColors.*):
 * a screen reader says "Mint", not "#6FCF97".
 */
export const COLOR_NAMES: Readonly<Record<string, string>> = {
  "#6FCF97": "mint",
  "#FF8A5B": "coral",
  "#8C7AE6": "violet",
  "#56B6E8": "sky",
  "#FFC83D": "sunflower",
  "#FF8FC0": "pink",
  "#2EC4B6": "turquoise",
  "#A47551": "brown",
  "#8FB8DE": "cloud",
  "#FFB054": "apricot",
  "#FFF4C7": "cream",
  "#FFE3B8": "peach",
  "#F2E9FF": "palelilac",
  "#FFFFFF": "white",
  "#DDF7E8": "palemint",
  "#FFE6F0": "palepink",
  "#FFF1A8": "lemon",
  "#FFB547": "amber",
  "#F6A6D7": "candy",
  "#3FA877": "leaf",
  "#E8613A": "tomato",
  "#B9AEF5": "lilac",
  "#E8558F": "raspberry",
  "#7A4E2D": "chocolate",
  "#2B1D14": "black",
  "#3B2A20": "darkbrown",
  "#8B5A2B": "chestnut",
  "#C97C3C": "ginger",
  "#E8C170": "blond",
  "#F2E2B8": "lightblond",
  "#D9434F": "red",
  "#B58CFF": "purple",
  "#FBE0C8": "skin1",
  "#F2C8A0": "skin2",
  "#D9A27A": "skin3",
  "#B07850": "skin4",
  "#7A4E33": "skin5",
};

/**
 * "Surprise me": random colours, pattern, eyes and accessory from the sets --
 * and for a person a skin tone, hair colour and hairstyle. The name, and the
 * choices that do not apply to this creature, stay as they were.
 */
export function surpriseLook(current: CreatureLook, person: boolean, rand: () => number = Math.random): CreatureLook {
  const pick = <T,>(list: ReadonlyArray<T>): T => list[Math.floor(rand() * list.length)];
  const look: CreatureLook = {
    ...current,
    body: pick(LOOK_SWATCHES.body),
    belly: pick(person ? LOOK_SWATCHES.trim : LOOK_SWATCHES.belly),
    pattern: pick(PATTERNS),
    eyes: pick(EYE_SHAPES),
    acc: pick(ACCESSORIES),
  };
  if (person) {
    look.skin = pick(LOOK_SWATCHES.skin);
    look.hair = pick(LOOK_SWATCHES.hair);
    look.hairstyle = pick(HAIRSTYLES);
  } else {
    look.accent = pick(LOOK_SWATCHES.accent);
  }
  return look;
}

/**
 * "Start over": the creature's own colours, plain, round eyes, nothing worn.
 * The name stays -- a child starting the colours over has not asked to lose it.
 */
export function startOverLook(current: CreatureLook): CreatureLook {
  return current.name ? { name: current.name } : {};
}
