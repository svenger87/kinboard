/**
 * Currency-formatted display string from a cents amount.
 *
 * Falls back to `<n.nn> <code>` for non-ISO-4217 currency codes (Yahoo
 * sometimes hands back `GBp` for London-pence stocks; same kind of
 * problem may surface here on certain locales). Same fallback pattern
 * we already use in the Stonks plugin.
 */
export function formatCents(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}
