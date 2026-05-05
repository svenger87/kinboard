/**
 * German public holidays (Niedersachsen) with Easter-based movable feasts.
 * Uses the Anonymous Gregorian algorithm for Easter computation.
 *
 * `nameKey` maps to the `holidays` translation namespace; consumers should
 * resolve via `useTranslations("holidays")(holiday.nameKey)`.
 */

export interface Holiday {
  nameKey: string;
  date: Date;
  emoji: string;
}

function computeEaster(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function getGermanHolidays(year: number): Holiday[] {
  const easter = computeEaster(year);

  return [
    { nameKey: "neujahr", date: new Date(year, 0, 1), emoji: "🎆" },
    { nameKey: "karfreitag", date: addDays(easter, -2), emoji: "✝️" },
    { nameKey: "ostersonntag", date: easter, emoji: "🐣" },
    { nameKey: "ostermontag", date: addDays(easter, 1), emoji: "🐰" },
    { nameKey: "tagDerArbeit", date: new Date(year, 4, 1), emoji: "🛠️" },
    { nameKey: "christiHimmelfahrt", date: addDays(easter, 39), emoji: "⛅" },
    { nameKey: "pfingstsonntag", date: addDays(easter, 49), emoji: "🕊️" },
    { nameKey: "pfingstmontag", date: addDays(easter, 50), emoji: "🕊️" },
    { nameKey: "tagDerDeutschenEinheit", date: new Date(year, 9, 3), emoji: "🇩🇪" },
    { nameKey: "reformationstag", date: new Date(year, 9, 31), emoji: "📜" },
    { nameKey: "heiligabend", date: new Date(year, 11, 24), emoji: "🎄" },
    { nameKey: "weihnachten1", date: new Date(year, 11, 25), emoji: "🎁" },
    { nameKey: "weihnachten2", date: new Date(year, 11, 26), emoji: "🎁" },
    { nameKey: "silvester", date: new Date(year, 11, 31), emoji: "🎇" },
  ];
}

/**
 * Returns upcoming holidays within the next N days, sorted by date.
 */
export function getUpcomingHolidays(daysAhead: number = 14): Holiday[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const cutoff = addDays(today, daysAhead);
  const year = today.getFullYear();

  // Check current year and next year (for Dec→Jan boundary)
  const holidays = [...getGermanHolidays(year), ...getGermanHolidays(year + 1)];

  return holidays
    .filter((h) => h.date >= today && h.date <= cutoff)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * Returns the next upcoming holiday regardless of distance.
 */
export function getNextHoliday(): Holiday | null {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const year = today.getFullYear();

  const holidays = [...getGermanHolidays(year), ...getGermanHolidays(year + 1)];

  return holidays
    .filter((h) => h.date >= today)
    .sort((a, b) => a.date.getTime() - b.date.getTime())[0] || null;
}
