/**
 * Which bin a calendar entry is about.
 *
 * Extracted from the widget so the API can classify a collection too. It was a
 * client component, and importing it server-side would have pulled React into
 * the server bundle to answer a question about strings.
 *
 * Only the matching lives here. Icons and colours stayed with the widget,
 * because they are presentation and nothing else needs them.
 */

export type WasteTypeId = "rest" | "bio" | "paper" | "recyclable" | "packaging";

export const WASTE_TYPES: { id: WasteTypeId; keywords: string[] }[] = [
  {
    id: "rest",
    keywords: [
      // de
      "restabfall", "restmüll", "restmuell", "schwarze tonne", "graue tonne", "hausmüll",
      // en
      "general waste", "residual waste", "household waste", "black bin", "grey bin", "gray bin", "landfill",
      // fr
      "ordures ménagères", "ordures menageres", "déchets résiduels", "bac gris", "bac noir",
    ],
  },
  {
    id: "bio",
    keywords: [
      // de
      "bioabfall", "biotonne", "biomüll", "biomuell", "grüne tonne", "gruene tonne", "grünabfall",
      // en
      "food waste", "organic waste", "garden waste", "green bin", "brown bin", "compost", "caddy",
      // fr
      "déchets verts", "dechets verts", "biodéchets", "biodechets", "bac vert", "compost",
    ],
  },
  {
    id: "paper",
    keywords: [
      // de
      "papier", "pappe", "altpapier", "blaue tonne", "karton",
      // en
      "paper", "cardboard", "blue bin",
      // fr
      "papier", "carton", "bac bleu",
    ],
  },
  {
    id: "recyclable",
    keywords: [
      // de
      "wertstoff", "gelbe tonne", "gelber sack", "verpackung", "duale system",
      // en
      "recycling", "recyclables", "dry mixed", "yellow bin", "co-mingled", "commingled",
      // fr
      "recyclage", "emballages", "tri sélectif", "tri selectif", "bac jaune", "sac jaune",
    ],
  },
  {
    id: "packaging",
    keywords: [
      // de
      "leichtverpackung",
      // en
      "light packaging", "plastic packaging",
      // fr
      "emballages légers", "emballages legers",
    ],
  },
];

/**
 * Which bin, if any, a calendar entry is about.
 *
 * Every language's keywords are checked regardless of the interface locale,
 * deliberately. A household in Germany may subscribe to an English-language
 * council feed, and a household in the UK may run Kinboard in German; matching
 * only the active locale would show an empty widget in both cases, silently.
 * Before this, only German matched at all — an English calendar produced
 * nothing, with no indication anything was wrong.
 *
 * Longest keyword first, so a specific match beats a general one: "light
 * packaging" must not be decided by "packaging", and "garden waste" must not
 * be swallowed by "waste".
 */
export function detectWasteType(title: string): { id: WasteTypeId; keywords: string[] } | null {
  const lower = title.toLowerCase();
  const matches = WASTE_TYPES.flatMap((wasteType) =>
    wasteType.keywords
      .filter((keyword) => lower.includes(keyword))
      .map((keyword) => ({ wasteType, keyword })),
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.keyword.length - a.keyword.length);
  return matches[0].wasteType;
}
