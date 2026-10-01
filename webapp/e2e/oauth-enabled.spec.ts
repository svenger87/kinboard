import { test, expect } from "@playwright/test";
import {
  assistantsEnabledAnywhere, assistantsEnabledFor, assistantsGate, forgetAssistantsEnabled, ENABLED_CACHE_MS,
} from "../src/lib/oauth/enabled";

/**
 * "Allow AI assistants" (RFC-010): off by default, and while no family has
 * switched it on the anonymous OAuth routes and /api/mcp answer 404. Pure —
 * every loader is injected, so none of this reaches Postgres.
 */

test.beforeEach(() => forgetAssistantsEnabled());

test("the gate is a 404 not_found while nobody has switched assistants on, and null once someone has", async () => {
  const off = await assistantsGate(async () => false);
  expect(off?.status).toBe(404);
  expect(await off?.json()).toEqual({ error: "not_found" });
  expect(await assistantsGate(async () => true)).toBeNull();
});

test("'on anywhere' is cached for 30 seconds, then asked again", async () => {
  let calls = 0;
  const load = async () => { calls++; return calls === 1; };
  const t0 = 1_700_000_000_000;
  expect(await assistantsEnabledAnywhere(load, t0)).toBe(true);
  expect(await assistantsEnabledAnywhere(load, t0 + ENABLED_CACHE_MS - 1)).toBe(true);
  expect(calls).toBe(1);
  expect(await assistantsEnabledAnywhere(load, t0 + ENABLED_CACHE_MS)).toBe(false);
  expect(calls).toBe(2);
});

test("forgetting the cached answer makes the next request ask again", async () => {
  let value = false;
  const load = async () => value;
  const t0 = 1_700_000_000_000;
  expect(await assistantsEnabledAnywhere(load, t0)).toBe(false);
  value = true;
  expect(await assistantsEnabledAnywhere(load, t0 + 1)).toBe(false);
  forgetAssistantsEnabled();
  expect(await assistantsEnabledAnywhere(load, t0 + 2)).toBe(true);
});

test("a lookup that fails reads as off, and is not cached", async () => {
  const t0 = 1_700_000_000_000;
  expect(await assistantsEnabledAnywhere(async () => { throw new Error("db down"); }, t0)).toBe(false);
  expect(await assistantsEnabledAnywhere(async () => true, t0 + 1)).toBe(true);
});

test("per family: the family's own answer, and a failed lookup throws rather than guessing", async () => {
  const asked: string[] = [];
  expect(await assistantsEnabledFor("fam-1", async (f) => { asked.push(f); return true; })).toBe(true);
  expect(await assistantsEnabledFor("fam-2", async (f) => { asked.push(f); return false; })).toBe(false);
  expect(asked).toEqual(["fam-1", "fam-2"]);
  await expect(assistantsEnabledFor("fam-3", async () => { throw new Error("db down"); })).rejects.toThrow("db down");
});
