import { test, expect } from "@playwright/test";

/**
 * Emptying a field in the recipe or event editor did nothing: the form
 * sent `undefined`, supabase-js serialises the update to JSON, and JSON
 * has no `undefined` — so the key vanished from the request body and the
 * column kept its old value, while the save reported success.
 *
 * `null` survives serialisation and is what actually clears a nullable
 * column. These pin the distinction, since it's invisible in TypeScript:
 * both types are assignable, and only one works.
 */

test("undefined disappears from a serialised update; null does not", () => {
  const withUndefined = { title: "Lasagne", description: undefined, image_url: undefined };
  const withNull = { title: "Lasagne", description: null, image_url: null };

  const sentU = JSON.parse(JSON.stringify(withUndefined));
  const sentN = JSON.parse(JSON.stringify(withNull));

  // The old behaviour: the server was never told about these fields.
  expect("description" in sentU).toBe(false);
  expect("image_url" in sentU).toBe(false);

  // The new behaviour: the server is told to clear them.
  expect("description" in sentN).toBe(true);
  expect(sentN.description).toBeNull();
  expect(sentN.image_url).toBeNull();
});

test("the form's own expressions produce null for an emptied field", () => {
  // Exactly the expressions the edit form uses.
  const forValue = (description: string, imageUrl: string, prepTime: string) => ({
    description: description.trim() || null,
    image_url: imageUrl || null,
    prep_time_minutes: prepTime ? parseInt(prepTime, 10) : null,
  });

  const cleared = forValue("", "", "");
  expect(cleared.description).toBeNull();
  expect(cleared.image_url).toBeNull();
  expect(cleared.prep_time_minutes).toBeNull();

  const filled = forValue("Nice pasta", "https://example.com/a.jpg", "20");
  expect(filled.description).toBe("Nice pasta");
  expect(filled.image_url).toBe("https://example.com/a.jpg");
  expect(filled.prep_time_minutes).toBe(20);
});

test("whitespace-only input clears rather than storing blanks", () => {
  expect(("   ".trim() || null)).toBeNull();
});

test("a total time of zero clears instead of storing 0", () => {
  // (prep || 0) + (cook || 0) || null — an empty form must not write 0,
  // which would render as a "0m" badge.
  const total = (p: string, c: string) =>
    (p ? parseInt(p, 10) : 0) + (c ? parseInt(c, 10) : 0) || null;

  expect(total("", "")).toBeNull();
  expect(total("20", "40")).toBe(60);
  expect(total("20", "")).toBe(20);
});
