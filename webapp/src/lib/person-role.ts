import { differenceInYears, parseISO } from "date-fns";

/** Years old from an ISO "YYYY-MM-DD" birth date, or null. */
export function ageFromBirthDate(birthDate?: string | null, now: Date = new Date()): number | null {
  if (!birthDate) return null;
  return differenceInYears(now, parseISO(birthDate + "T12:00:00"));
}

/** "Elternteil" / "Kind · 7 Jahre" — role from is_child, age appended when known. */
export function personRoleLabel(
  isChild: boolean | undefined,
  birthDate: string | null | undefined,
  labels: { parent: string; child: string; years: (n: number) => string },
): string {
  const base = isChild ? labels.child : labels.parent;
  const age = ageFromBirthDate(birthDate);
  return age === null ? base : `${base} · ${labels.years(age)}`;
}
