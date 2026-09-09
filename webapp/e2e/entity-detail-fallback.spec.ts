import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "./source-helpers";
import {
  classifyAttributeValue,
  classifyEntityState,
  humanizeAttributeKey,
  humanizeDomain,
  isPlumbingAttribute,
} from "../src/lib/ha-entity-display";

/**
 * The detail sheet against a domain nobody has heard of — RFC-008 §5.
 *
 * Home Assistant ships hundreds of domains and custom integrations invent
 * more, so the fallback is not an edge case: it is the branch most entities in
 * a real house take. Before this, an unrecognised entity got a raw state
 * string, an empty attributes list and a 24h chart of `parseFloat` fallbacks —
 * a flat line at zero that reads exactly like a reading. That is not "no
 * support", it is a screen that looks broken.
 *
 * These assert on the shape rules rather than on a rendered page because the
 * sheet has no caller yet (RFC-008 lands it on every tile in a later step),
 * and because the rules are where the mistakes are: a timestamp that
 * `parseFloat`s to its year, an object stringified into a table row, a
 * `supported_features` bit read without knowing the domain's flag enum.
 */

test.describe("state, by the shape of the value", () => {
  test("a whole-string number is a number", () => {
    expect(classifyEntityState("42")).toEqual({ kind: "number", value: 42 });
    expect(classifyEntityState("-0.5")).toEqual({ kind: "number", value: -0.5 });
  });

  test("a timestamp is a date, not the year parseFloat finds in it", () => {
    // parseFloat("2026-09-09T18:42:00+00:00") is 2026. Rendering an entity's
    // last-pressed time as "2,026" is the exact failure this rules out.
    const shape = classifyEntityState("2026-09-09T18:42:00+00:00");
    expect(shape.kind).toBe("datetime");
    if (shape.kind === "datetime") expect(shape.parts).toBe("datetime");

    const dateOnly = classifyEntityState("2026-09-09");
    expect(dateOnly.kind).toBe("datetime");
    // Local midnight, not UTC: `new Date("2026-09-09")` renders as the 8th
    // anywhere west of Greenwich.
    if (dateOnly.kind === "datetime") expect(dateOnly.date.getDate()).toBe(9);

    const timeOnly = classifyEntityState("18:42:00");
    expect(timeOnly.kind).toBe("datetime");
    if (timeOnly.kind === "datetime") expect(timeOnly.parts).toBe("time");
  });

  test("a number with a unit stuck to it is text, not a number", () => {
    // parseFloat("42 AQI") is 42; showing 42 would drop what it measures.
    expect(classifyEntityState("42 AQI")).toEqual({ kind: "text", value: "42 AQI" });
  });

  test("on and off are the toggle pair; anything else is its own word", () => {
    expect(classifyEntityState("on")).toEqual({ kind: "toggle", on: true });
    expect(classifyEntityState("off")).toEqual({ kind: "toggle", on: false });
    expect(classifyEntityState("heat_pump")).toEqual({ kind: "text", value: "heat_pump" });
    expect(classifyEntityState("Away")).toEqual({ kind: "text", value: "Away" });
  });

  test("unavailable, unknown and empty all mean no reading", () => {
    expect(classifyEntityState("unavailable").kind).toBe("unavailable");
    expect(classifyEntityState("unknown").kind).toBe("unavailable");
    expect(classifyEntityState("").kind).toBe("unavailable");
    expect(classifyEntityState(undefined).kind).toBe("unavailable");
  });
});

test.describe("attributes", () => {
  test("plumbing stays hidden, everything else is shown", () => {
    for (const key of [
      "friendly_name", "icon", "supported_features", "entity_picture",
      "attribution", "editable", "id", "assumed_state", "restored",
      "_private_handle",
    ]) {
      expect(isPlumbingAttribute(key), key).toBe(true);
    }
    for (const key of ["current_position", "available_tones", "operation_list", "device_class"]) {
      expect(isPlumbingAttribute(key), key).toBe(false);
    }
  });

  test("a list of plain values is joined; an object goes behind a disclosure", () => {
    expect(classifyAttributeValue(["eco", "heat_pump"])).toEqual({
      kind: "list",
      items: ["eco", "heat_pump"],
    });
    // The row is the wrong place for this: `String({})` is "[object Object]"
    // and a stringified object is a line of noise as wide as the sheet.
    expect(classifyAttributeValue({ species: "Robin" }).kind).toBe("complex");
    expect(classifyAttributeValue([{ species: "Robin" }]).kind).toBe("complex");
    expect(classifyAttributeValue(48.5)).toEqual({ kind: "scalar", value: 48.5 });
  });

  test("keys read as words, in sentence case", () => {
    expect(humanizeAttributeKey("current_position")).toBe("Current position");
    expect(humanizeAttributeKey("available_tones")).toBe("Available tones");
    expect(humanizeDomain("air_quality")).toBe("Air quality");
    expect(humanizeDomain("siren")).toBe("Siren");
  });
});

test("the fallback action is homeassistant.turn_on/off, and nothing bit-gated", () => {
  const source = codeOnly(
    readFileSync(
      join(__dirname, "../src/components/home-assistant/entity-detail-sheet.tsx"),
      "utf8",
    ),
  );
  const fallback = source.slice(source.indexOf("      default:"));

  // The one service pair HA guarantees for anything with on/off semantics.
  expect(fallback).toContain('domain: "homeassistant"');
  expect(fallback).toContain('service: isOn ? "turn_off" : "turn_on"');

  // `supported_features` is an IntFlag whose meaning belongs to the domain, so
  // a bit test here would offer buttons that do something else entirely.
  expect(fallback).not.toContain("supported_features");
});
