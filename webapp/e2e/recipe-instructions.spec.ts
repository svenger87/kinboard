import { test, expect } from "@playwright/test";
import { parseInstructions } from "../src/lib/recipe-instructions";

/**
 * `recipes.instructions` is a Json column, so readers get whatever was
 * written. Three call sites handled that three different ways: two did a
 * bare JSON.parse during render (a pasted paragraph throws and blanks the
 * page) and the meal-planner dialog didn't parse at all, showing raw
 * `[{"step":1,...}]` to the user.
 */

test("an array of steps parses as-is", () => {
  expect(
    parseInstructions([
      { step: 1, text: "Boil the water" },
      { step: 2, text: "Add pasta" },
    ]),
  ).toEqual([
    { step: 1, text: "Boil the water" },
    { step: 2, text: "Add pasta" },
  ]);
});

test("the same array stored as a string parses too", () => {
  expect(parseInstructions('[{"step":1,"text":"Boil the water"}]')).toEqual([
    { step: 1, text: "Boil the water" },
  ]);
});

test("a pasted paragraph becomes steps instead of throwing", () => {
  // This is what used to blank the recipe page with a SyntaxError.
  const result = parseInstructions("Boil the water.\nAdd pasta.\nDrain.");
  expect(result).toHaveLength(3);
  expect(result[0]).toEqual({ step: 1, text: "Boil the water." });
  expect(result[2].step).toBe(3);
});

test("blank lines split before single newlines do", () => {
  const result = parseInstructions("Step one\nstill step one\n\nStep two");
  expect(result).toHaveLength(2);
  expect(result[0].text).toBe("Step one\nstill step one");
});

test("malformed JSON is kept as readable text, not lost", () => {
  const result = parseInstructions('[{"step":1,"text":"Boil');
  expect(result).toHaveLength(1);
  expect(result[0].text).toContain("Boil");
});

test("plain strings in the array are numbered by position", () => {
  expect(parseInstructions(["Boil", "Add pasta"])).toEqual([
    { step: 1, text: "Boil" },
    { step: 2, text: "Add pasta" },
  ]);
});

test("alternative keys importers use are picked up", () => {
  expect(parseInstructions([{ instruction: "Boil" }, { description: "Drain" }])).toEqual([
    { step: 1, text: "Boil" },
    { step: 2, text: "Drain" },
  ]);
});

test("unusable step numbers are replaced by position", () => {
  // A stored 0 would render a "step 0" bubble; a missing one, "undefined".
  expect(parseInstructions([{ step: 0, text: "Boil" }, { text: "Drain" }])).toEqual([
    { step: 1, text: "Boil" },
    { step: 2, text: "Drain" },
  ]);
});

test("empty and junk values yield an empty list, never a throw", () => {
  for (const value of [null, undefined, "", "   ", [], {}, 42, [null, "", {}]]) {
    expect(parseInstructions(value), String(JSON.stringify(value))).toEqual([]);
  }
});

test("an image on a step survives", () => {
  expect(parseInstructions([{ step: 1, text: "Boil", image_url: "https://x/a.jpg" }])).toEqual([
    { step: 1, text: "Boil", image_url: "https://x/a.jpg" },
  ]);
});
