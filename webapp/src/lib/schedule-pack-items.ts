/**
 * What a subject means you have to bring, and how a subject is matched to it.
 *
 * One definition, because there are now three readers: the timetable page, the
 * settings page that edits it, and the Heute-Motor deciding whether to tell a
 * family to pack a sports kit tonight. Three copies of a list that determines
 * what a child takes to school is exactly the kind of duplication that goes
 * unnoticed until two screens disagree about a swimming lesson.
 */

export interface PackItemConfig {
  subject: string;
  items: string[];
}

/** The per-family setting these are the fallback for. */
export const PACK_ITEMS_SETTING_KEY = "schedule_pack_items";

export const DEFAULT_PACK_ITEMS: PackItemConfig[] = [
  { subject: "Sport", items: ["Sportkleidung", "Turnschuhe", "Trinkflasche"] },
  { subject: "Schwimmen", items: ["Badeanzug/Badehose", "Handtuch", "Schwimmbrille", "Badekappe"] },
  { subject: "Kunst", items: ["Malkittel", "Pinsel & Farben"] },
  { subject: "Musik", items: ["Instrument", "Notenheft"] },
  { subject: "Religion", items: ["Religionsheft"] },
  { subject: "Werken", items: ["Arbeitskittel"] },
  { subject: "Textilgestaltung", items: ["Nähzeug", "Stoffe"] },
];

/**
 * Find what a lesson requires.
 *
 * Substring, case-insensitive, and on the *lesson's* name containing the
 * *config's* subject — so "Sport" is found inside "Sportförderung" and
 * "Schwimmen" inside "Schwimmen (Halle)". A family names its subjects however
 * the school does, and an exact match would quietly stop reminding anybody
 * whose timetable says "Kunst/Werken".
 *
 * Shared rather than reimplemented per caller: the timetable page and the
 * Heute-Motor disagreeing about whether today counts as a sports day would be
 * both confusing and invisible.
 */
export function packItemsForSubject(
  subject: string,
  config: PackItemConfig[]
): string[] {
  const needle = subject.toLowerCase();
  return config.find((entry) => needle.includes(entry.subject.toLowerCase()))?.items ?? [];
}
