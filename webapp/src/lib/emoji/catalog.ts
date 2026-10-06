/**
 * The emoji picker's data, in the browser (task and reward icons).
 *
 * One file per screen language, generated from Unicode CLDR via the pinned
 * emojibase-data (scripts/generate-emoji-data.mjs), and loaded with a dynamic
 * import only when a picker opens: a separate chunk of 45-75 KB gzipped,
 * served by Kinboard itself (no CDN, so it works offline and on a LAN-only
 * install), never part of a page's own bundle. Each language's file also
 * carries the English names and keywords, so the screen's language and
 * English are both searched from one file.
 */

export type EmojiLocale = "en" | "de" | "fr";

/** [emoji, group index, name, search string, five skin-tone variants?] */
export type EmojiRow = [string, number, string, string, string[]?];

export interface EmojiCatalog {
  source: string;
  groups: { key: string; label: string }[];
  emoji: EmojiRow[];
}

// Typed as unknown: JSON's inferred tuple types are looser than EmojiRow.
const LOADERS: Record<EmojiLocale, () => Promise<unknown>> = {
  en: () => import("./data/en.json"),
  de: () => import("./data/de.json"),
  fr: () => import("./data/fr.json"),
};

const loaded = new Map<EmojiLocale, Promise<EmojiCatalog>>();

export function emojiLocale(locale: string | null | undefined): EmojiLocale {
  const base = (locale ?? "en").slice(0, 2).toLowerCase();
  return base === "de" || base === "fr" ? base : "en";
}

/** The catalogue in this language, loaded once per page. */
export function loadEmojiCatalog(locale: string): Promise<EmojiCatalog> {
  const l = emojiLocale(locale);
  let p = loaded.get(l);
  if (!p) {
    p = LOADERS[l]().then((m) => ((m as { default?: unknown }).default ?? m) as EmojiCatalog);
    p.catch(() => loaded.delete(l));
    loaded.set(l, p);
  }
  return p;
}

/** Lower case, accents off: how the search strings are stored. */
export function foldSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Every emoji whose name or keywords, in the screen's language or English,
 * contain each word of the query.
 */
export function searchEmoji(catalog: EmojiCatalog, query: string): EmojiRow[] {
  const words = foldSearch(query).split(" ").filter(Boolean);
  if (words.length === 0) return [];
  const first = words[0];
  // Best first: the emoji's own name starts with the word ("cat face" for
  // "cat"), then any name or keyword does ("grinning cat"), then the rest.
  const tiers: EmojiRow[][] = [[], [], []];
  for (const row of catalog.emoji) {
    const search = row[3];
    if (!words.every((w) => search.includes(w))) continue;
    if (search.startsWith(first)) tiers[0].push(row);
    else if (search.includes(`|${first}`) || search.includes(` ${first}`)) tiers[1].push(row);
    else tiers[2].push(row);
  }
  return tiers.flat();
}

/** The emoji in the chosen skin tone (0 = the default yellow), where it has one. */
export function withTone(row: EmojiRow, tone: number): string {
  const tones = row[4];
  return tone >= 1 && tone <= 5 && tones ? tones[tone - 1] : row[0];
}

const RECENT_KEY = "kinboard.emoji-recent";
const TONE_KEY = "kinboard.emoji-tone";
export const RECENT_MAX = 24;

/** This device's recently picked emoji, newest first. Storage may be off: then none. */
export function readRecentEmoji(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function rememberEmoji(emoji: string): string[] {
  const next = [emoji, ...readRecentEmoji().filter((e) => e !== emoji)].slice(0, RECENT_MAX);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Private mode, storage full: the pick still counts, it is just not remembered.
  }
  return next;
}

export function readSkinTone(): number {
  try {
    const n = Number(window.localStorage.getItem(TONE_KEY) ?? 0);
    return Number.isInteger(n) && n >= 0 && n <= 5 ? n : 0;
  } catch {
    return 0;
  }
}

export function saveSkinTone(tone: number): void {
  try {
    window.localStorage.setItem(TONE_KEY, String(tone));
  } catch {
    // As above.
  }
}
