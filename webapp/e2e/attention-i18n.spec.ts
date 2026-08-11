import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";
import { evaluate } from "../src/lib/attention/engine";
import { RULES } from "../src/lib/attention/rules";
import type { Signals } from "../src/lib/attention/types";

/**
 * A hint has to be sayable in the household's own language.
 *
 * The first version stored rendered English, because the evaluator runs
 * server-side and produced strings — so a German family read "Henrik needs to
 * pack for tomorrow" in the middle of an otherwise German interface. Nothing
 * failed; it just quietly spoke the wrong language.
 *
 * Server-side translation would not have fixed it either: the locale is per
 * device, so one household can run a German wall tablet and an English phone.
 */

const LOCALES = ["en", "de", "fr"] as const;

type HintEntry = { title?: string; detail?: string };
type HintNode = { [key: string]: HintNode | string | undefined };

/**
 * Resolve a message key the way next-intl does: a dot means nesting.
 *
 * `messageKey` values such as `leave-soon.at` are paths, not literal keys. A
 * flat `"leave-soon.at"` entry cannot be reached at runtime — next-intl throws
 * INVALID_KEY on it — so indexing the table once with the whole key asserted
 * exactly the shape the app rejects, and this suite passed while the hint fell
 * back to stored English on every wall display.
 */
function entryFor(table: HintNode, key: string): HintEntry | undefined {
  let node: HintNode | string | undefined = table;
  for (const part of key.split(".")) {
    if (node == null || typeof node === "string") return undefined;
    node = node[part];
  }
  return node != null && typeof node !== "string" ? (node as HintEntry) : undefined;
}

function messages(locale: string): HintNode {
  const raw = JSON.parse(
    readFileSync(join(process.cwd(), "messages", `${locale}.json`), "utf8"),
  );
  return raw.attention.hints;
}

function signals(overrides: Partial<Signals> = {}): Signals {
  return {
    now: new Date("2026-08-10T19:00:00+02:00"),
    timeZone: "Europe/Berlin",
    events: [],
    todos: [],
    lessons: [],
    meals: [],
    birthdays: [],
    shoppingItemCount: 0,
    ...overrides,
  };
}

test("every rule states a message key, not only English words", () => {
  // A rule that returns only `title` renders in English on every device, and
  // nothing complains — which is exactly how this shipped the first time.
  const withoutKey = RULES.filter((rule) => {
    const source = rule.evaluate.toString();
    return !source.includes("messageKey");
  });
  expect(withoutKey.map((r) => r.id)).toEqual([]);
});

for (const locale of LOCALES) {
  test(`${locale} has a translation for every message a rule can raise`, () => {
    const table = messages(locale);
    // Collected from the rules themselves rather than hand-listed, so a rule
    // added tomorrow fails this until it is translated.
    const keys = new Set<string>();
    for (const rule of RULES) {
      for (const match of rule.evaluate.toString().matchAll(/messageKey:\s*"([^"]+)"/g)) {
        keys.add(match[1]);
      }
      for (const match of rule.evaluate.toString().matchAll(/\?\s*"([a-z-]+\.[a-z-]+)"\s*:\s*"([a-z-]+\.[a-z-]+)"/g)) {
        keys.add(match[1]);
        keys.add(match[2]);
      }
    }
    expect(keys.size).toBeGreaterThan(0);
    const missing = [...keys].filter((k) => !entryFor(table, k)?.title);
    expect(missing, `${locale} is missing: ${missing.join(", ")}`).toEqual([]);
  });
}

test("the params a rule sends are the ones its message interpolates", () => {
  // A placeholder with no matching param renders literally as {name} on the
  // wall; a param with no placeholder is silently dropped. Both look fine in
  // code review.
  const en = messages("en");
  const produced = evaluate(
    signals({
      lessons: [
        { personId: "p1", personName: "Henrik", dayOfWeek: 2, period: 1, subject: "Sport", packList: ["Sportzeug"] },
      ],
      todos: [
        { id: "t1", title: "Müll", dueDate: new Date("2026-08-09T12:00:00+02:00"), completed: false, personId: null, personName: null },
      ],
    }),
    RULES,
  );

  expect(produced.length).toBeGreaterThan(0);
  for (const item of produced) {
    if (!item.messageKey) continue;
    const entry = entryFor(en, item.messageKey);
    expect(entry, `no en message for ${item.messageKey}`).toBeTruthy();

    const text = `${entry?.title ?? ""} ${entry?.detail ?? ""}`;
    const placeholders = [...text.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]);
    for (const name of placeholders) {
      expect(
        Object.keys(item.params ?? {}),
        `${item.messageKey} interpolates {${name}} but sends no such param`,
      ).toContain(name);
    }
  }
});
