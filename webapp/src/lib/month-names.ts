/**
 * Matching a month against an album name someone typed themselves.
 *
 * The Immich screensaver looks for an album called "Wallpaper <month>". It
 * built that month name with `toLocaleDateString("de-DE")` and nothing else,
 * so the feature only worked in German — on an app that ships English and
 * French too. "Wallpaper März" matched; "Wallpaper March" did not, and the
 * screensaver silently fell back to stock photos with no hint that the album
 * had been found and rejected.
 *
 * A few near-misses hid how broken it was: "wallpaper january" contains
 * "januar", so January worked by accident. March, May, June, July, October
 * and December did not.
 *
 * Rather than guess the user's language, match against every name the month
 * has in the languages the app speaks, plus its number. Album names are
 * user-chosen text; being generous costs nothing and a false positive would
 * need an album mentioning a different month in another language.
 */

/** Every locale the app ships, so an album matches whatever language it was named in. */
const LOCALES = ["de-DE", "en-US", "fr-FR"] as const;

/**
 * Lowercase strings that identify `date`'s month: its long and short name in
 * each supported locale, plus "01" and "1".
 */
export function monthNameCandidates(date: Date = new Date()): string[] {
  const candidates = new Set<string>();

  for (const locale of LOCALES) {
    for (const month of ["long", "short"] as const) {
      try {
        const name = new Intl.DateTimeFormat(locale, { month }).format(date);
        // Short names come with a trailing dot in some locales ("janv.").
        const cleaned = name.toLowerCase().replace(/\.$/, "").trim();
        // Two characters isn't enough to match on — it would hit any album
        // with those letters in it.
        if (cleaned.length >= 3) candidates.add(cleaned);
      } catch {
        // A runtime without full ICU data still gets the other locales.
      }
    }
  }

  const monthNumber = date.getMonth() + 1;
  candidates.add(String(monthNumber).padStart(2, "0"));
  candidates.add(String(monthNumber));

  return [...candidates];
}

/** True when an album name names this month, in any supported language. */
export function albumMatchesMonth(albumName: string, date: Date = new Date()): boolean {
  const name = albumName.toLowerCase();
  return monthNameCandidates(date).some((candidate) => {
    // A bare number has to stand alone — otherwise "8" matches "2018".
    if (/^\d+$/.test(candidate)) {
      return new RegExp(`(^|[^0-9])${candidate}([^0-9]|$)`).test(name);
    }
    return name.includes(candidate);
  });
}
