// Shared client-side helper for POSTing a locale change to /api/locale.
// Used by the settings language page, the locale switcher pill, and the
// join-page family-creation flow. Persists the cookie server-side and,
// when a familyId is supplied, the family-level `locale` setting used by
// server-generated push notifications.
export async function postLocale(locale: string, familyId?: string | null) {
  const response = await fetch("/api/locale", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locale, familyId }),
  });
  if (!response.ok) throw new Error("locale change failed");
  return response;
}
