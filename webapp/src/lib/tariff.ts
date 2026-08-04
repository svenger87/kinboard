/**
 * Energy prices, where zero is a real answer.
 *
 * A tariff of €0.00/kWh is not exotic — free workplace or destination
 * charging, a fixed-price contract billed elsewhere, a feed-in arrangement
 * that pays nothing for export. It was impossible to enter. Three separate
 * `||` stood in the way, and each one on its own was enough:
 *
 *   value={config.cost_per_kwh_import || ""}          // 0 shows a blank box
 *   parseFloat(e.target.value) || undefined           // typing 0 stores nothing
 *   (energyConfig?.cost_per_kwh_import || 0.35)       // 0 falls back to 0.35
 *
 * So the field appeared to accept a zero, then quietly went on charging the
 * default. The numbers on the energy page were wrong and nothing said why.
 */

/** Fallbacks for a tariff that has genuinely never been set. */
export const DEFAULT_IMPORT_PRICE = 0.35;
export const DEFAULT_EXPORT_PRICE = 0.08;
/** Charging cost, same default as grid import. */
export const DEFAULT_KWH_PRICE = DEFAULT_IMPORT_PRICE;

/**
 * Read a price out of a number input.
 *
 * `undefined` means "not set, use the default"; `0` means zero. Clearing the
 * field has to reach `undefined`, and typing 0 has to reach 0 — which is the
 * distinction `parseFloat(x) || undefined` threw away.
 */
export function parsePrice(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const value = parseFloat(trimmed);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return value;
}
