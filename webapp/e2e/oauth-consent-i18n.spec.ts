import { test, expect } from "@playwright/test";
import en from "../messages/en.json";
import de from "../messages/de.json";
import fr from "../messages/fr.json";
import { MCP_SCOPES } from "../src/lib/oauth/config";

/**
 * The consent page is where a family decides what an assistant may do, so
 * every language must say all of it: the same oauthConsent keys in en, de
 * and fr, none empty, the same {placeholders}, and a label for every scope
 * the page can offer (`scope_<scope with : as _>`).
 */

type Dict = Record<string, unknown>;
const LOCALES: Record<string, Dict> = { en: en.oauthConsent, de: de.oauthConsent, fr: fr.oauthConsent };

function flatten(value: unknown, prefix = ""): Record<string, string> {
  if (typeof value === "string") return { [prefix]: value };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Dict)) Object.assign(out, flatten(v, prefix ? `${prefix}.${k}` : k));
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();

test("oauthConsent has the same keys in en, de and fr, none empty, with the same placeholders", () => {
  const flat = Object.fromEntries(Object.entries(LOCALES).map(([l, d]) => [l, flatten(d)]));
  const keys = Object.keys(flat.en).sort();
  expect(keys.length).toBeGreaterThan(20);
  for (const locale of ["de", "fr"]) {
    expect(Object.keys(flat[locale]).sort(), locale).toEqual(keys);
    for (const key of keys) {
      expect(flat[locale][key].trim().length, `${locale} ${key}`).toBeGreaterThan(0);
      expect(placeholders(flat[locale][key]), `${locale} ${key}`).toEqual(placeholders(flat.en[key]));
    }
  }
});

test("every scope the consent page offers has a label in every language", () => {
  for (const scope of MCP_SCOPES) {
    const key = `scope_${scope.replace(":", "_")}`;
    for (const [locale, dict] of Object.entries(LOCALES)) {
      expect(typeof dict[key], `${locale} ${key}`).toBe("string");
    }
  }
});

test("write scopes say they edit and delete, and home control says what waits for the PIN", () => {
  expect(en.oauthConsent.scope_tasks_write).toBe("Add, tick off, edit and delete tasks");
  expect(en.oauthConsent.scope_shopping_write).toBe("Add, tick off, rename and delete shopping items");
  expect(en.oauthConsent.scope_calendar_write).toBe("Add, change and delete calendar events");
  expect(en.oauthConsent.scope_notes_write).toBe("Add, edit and delete notes");
  expect(en.oauthConsent.scope_meals_write).toBe("Add and remove meals");
  for (const dict of [en, de, fr]) expect(dict.oauthConsent.scope_home_control).toMatch(/PIN/);
});

test("the vehicles scope names charge level and range, in every language", () => {
  expect(en.oauthConsent.scope_vehicles_read).toBe("See your vehicles' charge level, range and charging status");
  expect(de.oauthConsent.scope_vehicles_read).toMatch(/Ladestand/);
  expect(fr.oauthConsent.scope_vehicles_read).toMatch(/charge/);
});
