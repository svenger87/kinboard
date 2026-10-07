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
  expect(en.oauthConsent.scope_calendar_write).toBe("Add, change and delete calendar events and countdowns");
  expect(en.oauthConsent.scope_notes_write).toBe("Add, edit and delete notes");
  expect(en.oauthConsent.scope_meals_write).toBe("Add and remove meals, and save recipes");
  for (const dict of [en, de, fr]) expect(dict.oauthConsent.scope_home_control).toMatch(/PIN/);
});

test("saving a recipe is named where it is granted, in every language", () => {
  expect(de.oauthConsent.scope_meals_write).toMatch(/Rezepte/);
  expect(fr.oauthConsent.scope_meals_write).toMatch(/recettes/);
  expect(en.oauthConsent.scope_meals_write).toMatch(/recipes/);
});

test("countdowns and marking a message seen are named where they are granted, in every language", () => {
  expect(de.oauthConsent.scope_calendar_write).toMatch(/Countdowns/);
  expect(fr.oauthConsent.scope_calendar_write).toMatch(/comptes à rebours/);
  expect(en.oauthConsent.scope_announcements_write).toMatch(/mark one as seen/);
  expect(de.oauthConsent.scope_announcements_write).toMatch(/gesehen/);
  expect(fr.oauthConsent.scope_announcements_write).toMatch(/vu/);
});

test("the announcements scope says it can put a camera on the wall displays, in every language", () => {
  // show_camera (#335) shares announcements:write, so an assistant holding it
  // can take over every wall display; the consent page has to say so.
  expect(en.oauthConsent.scope_announcements_write).toMatch(/show a camera on the wall displays/);
  expect(de.oauthConsent.scope_announcements_write).toMatch(/Kamera/);
  expect(fr.oauthConsent.scope_announcements_write).toMatch(/caméra/);
});

test("the vehicles scope names charge level and range, in every language", () => {
  expect(en.oauthConsent.scope_vehicles_read).toBe("See your vehicles' charge level, range and charging status");
  expect(de.oauthConsent.scope_vehicles_read).toMatch(/Ladestand/);
  expect(fr.oauthConsent.scope_vehicles_read).toMatch(/charge/);
});

test("the timers scope says start and stop, in every language", () => {
  expect(en.oauthConsent.scope_timers_write).toBe("Start and stop timers on the screens");
  expect(de.oauthConsent.scope_timers_write).toMatch(/Timer/);
  expect(fr.oauthConsent.scope_timers_write).toMatch(/minuteur/i);
});

test("the birthdays scope says add, change and delete, in every language", () => {
  expect(en.oauthConsent.scope_birthdays_write).toBe("Add, change and delete birthdays");
  expect(de.oauthConsent.scope_birthdays_write).toMatch(/Geburtstage/);
  expect(fr.oauthConsent.scope_birthdays_write).toMatch(/anniversaire/i);
});

test("the pocket money scope needs the PIN, and names rewards too, in every language", () => {
  expect(en.oauthConsent.scope_pocket_money_write).toBe("Ask to book pocket money or ask for a child's reward — a parent approves each with the settings PIN. A reward request notifies the parents and holds the child's points until then");
  for (const dict of [en, de, fr]) expect(dict.oauthConsent.scope_pocket_money_write).toMatch(/PIN/);
  // Asking for a reward rides on this scope (no new one, so no assistant has
  // to be connected again); the family agrees to it here, so it is named.
  expect(de.oauthConsent.scope_pocket_money_write).toMatch(/Belohnung/);
  expect(fr.oauthConsent.scope_pocket_money_write).toMatch(/récompense/);
  // What a request does besides asking: it tells the parents and holds the points.
  for (const [dict, words] of [[en, /notifies the parents.*holds the child's points/], [de, /benachrichtigt die Eltern.*Punkte/], [fr, /prévient les parents.*points/]] as const) {
    expect(dict.oauthConsent.scope_pocket_money_write).toMatch(words);
  }
});

// family:read grew with every assistant feature that only reads; the label is
// what the family agrees to, so it has to name each of them, not just the
// four it started with.
test("the family read scope names everything it reads, in every language", () => {
  const names: Record<"en" | "de" | "fr", RegExp[]> = {
    en: [/calendar/, /people/, /tasks/, /shopping list/, /meal plan/, /recipes/, /school timetable/, /birthdays/, /pocket money/, /points, rewards/, /species and stage/, /timers/, /countdowns/, /screen messages/, /attention hints/, /weather forecast/, /recycle bin/],
    de: [/Kalender/, /Personen/, /Aufgaben/, /Einkaufsliste/, /Mahlzeiten/, /Rezepte/, /Stundenplan/, /Geburtstage/, /Taschengeld/, /Belohnungen/, /Art und Stufe/, /Timer/, /Countdowns/, /Nachrichten/, /Hinweise/, /Wettervorhersage/, /Papierkorb/],
    fr: [/calendrier/, /membres/, /tâches/, /courses/, /repas/, /recettes/, /emploi du temps/, /anniversaires/, /argent de poche/, /récompenses/, /espèce et le stade/, /minuteurs/, /comptes à rebours/, /messages/, /conseils/, /prévisions météo/, /corbeille/],
  };
  const dicts = { en, de, fr };
  for (const locale of ["en", "de", "fr"] as const) {
    for (const name of names[locale]) {
      expect(dicts[locale].oauthConsent.scope_family_read, `${locale} ${name}`).toMatch(name);
    }
  }
});

// A client that replays the scope list it cached at setup never asks for a
// permission added since; the page offers those under their own heading,
// naming the assistant, with a line saying why they are there.
test("the scopes the assistant did not ask for have a heading and an explanation, in every language", () => {
  expect(en.oauthConsent.availableHeading).toBe("Also available — {client} didn't ask for these");
  expect(en.oauthConsent.availableHint).toBe("Kinboard has added these since this assistant was set up. Tick any you want it to have.");
  for (const dict of [en, de, fr]) {
    expect(dict.oauthConsent.availableHeading).toContain("{client}");
    expect(dict.oauthConsent.availableHint.length).toBeGreaterThan(20);
  }
});
