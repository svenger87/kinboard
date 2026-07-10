// The three recipe surfaces (library, detail, search) render cook/prep
// durations identically; `t` must be bound to the "recipes" namespace.
export function formatRecipeTime(
  t: (key: string, values?: Record<string, number>) => string,
  minutes: number | null
): string | null {
  if (!minutes) return null;
  if (minutes < 60) return t("timeMinutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? t("timeHoursMinutes", { hours, minutes: mins }) : t("timeHours", { hours });
}
