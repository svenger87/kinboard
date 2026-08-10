"use client";

import { useSetting } from "./use-supabase-queries";
import { SETTINGS_KEYS } from "@/lib/settings-keys";

/**
 * The household's currency, for pocket money.
 *
 * Accounts carried a `currency` column from the start, always written as
 * "EUR", with nothing in the interface to change it — so a family outside the
 * eurozone got a euro sign on their child's savings and no way to correct it.
 *
 * The default stays EUR rather than being guessed from the interface language.
 * Language is not currency: English is spoken where people are paid in dollars,
 * pounds, euros and a dozen other things, and quietly re-labelling a child's
 * balance because the display language is English would be worse than the bug
 * it replaced. Money gets asked about, not inferred.
 */
export const DEFAULT_CURRENCY = "EUR";

/**
 * The ones offered in the picker. Any ISO 4217 code works if it is already in
 * the database — this is a convenience list, not a validation rule.
 */
export const CURRENCIES = [
  "EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "CAD", "AUD", "NZD",
] as const;

export function useCurrency(): { currency: string } {
  const { data } = useSetting<string>(SETTINGS_KEYS.currency, DEFAULT_CURRENCY);
  return { currency: data ?? DEFAULT_CURRENCY };
}
