import type { SettingsEntry } from "./registry";

/**
 * Lowercase, accents stripped, ß spelled out, whitespace collapsed — so
 * "Türklingel", "turklingel" and "TÜRKLINGEL" are one word, and so are
 * "Straße" and "strasse".
 */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** An entry with its text already translated into the screen's language. */
export interface SearchableEntry {
  entry: SettingsEntry;
  label: string;
  description: string;
  keywords: string[];
  /** For a section: the page it is on. Empty for a page. */
  sectionLabel: string;
}

/** Translate every entry once, for searching. `t` takes full i18n paths. */
export function toSearchable(
  entries: readonly SettingsEntry[],
  t: (key: string) => string,
  descriptionOverrides: Record<string, string> = {},
): SearchableEntry[] {
  return entries.map((entry) => ({
    entry,
    label: t(entry.labelKey),
    description:
      descriptionOverrides[entry.id] ?? (entry.descriptionKey ? t(entry.descriptionKey) : ""),
    keywords: t(entry.keywordsKey)
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
    sectionLabel: entry.pageLabelKey ? t(entry.pageLabelKey) : "",
  }));
}

const words = (s: string) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * How well one normalized token matches one entry: 0 means not at all.
 * Label start 4, a label word's start 3, a keyword's start 2, anywhere in
 * label, keyword, description or page name 1.
 */
function tokenScore(
  token: string,
  e: { label: string; labelWords: string[]; keywords: string[]; keywordWords: string[]; rest: string },
): number {
  if (e.label.startsWith(token)) return 4;
  if (e.labelWords.some((w) => w.startsWith(token))) return 3;
  if (e.keywords.some((k) => k.startsWith(token)) || e.keywordWords.some((w) => w.startsWith(token))) return 2;
  if (e.label.includes(token) || e.keywords.some((k) => k.includes(token)) || e.rest.includes(token)) return 1;
  return 0;
}

/**
 * The entries matching every word of the query, best first. Ties go to
 * whole pages before their sections, then to the registry's own order.
 */
export function searchSettings(
  items: SearchableEntry[],
  query: string,
  limit = 20,
): SettingsEntry[] {
  const tokens = normalize(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return [];

  const scored: { entry: SettingsEntry; score: number; order: number }[] = [];
  items.forEach((item, order) => {
    const label = normalize(item.label);
    const keywords = item.keywords.map(normalize);
    const prepared = {
      label,
      labelWords: words(label),
      keywords,
      keywordWords: keywords.flatMap(words),
      rest: `${normalize(item.description)} ${normalize(item.sectionLabel)}`,
    };
    let score = 0;
    for (const token of tokens) {
      const s = tokenScore(token, prepared);
      if (s === 0) return;
      score += s;
    }
    scored.push({ entry: item.entry, score, order });
  });

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      Number(!!a.entry.anchor) - Number(!!b.entry.anchor) ||
      a.order - b.order,
  );
  return scored.slice(0, limit).map((s) => s.entry);
}
