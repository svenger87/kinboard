import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { parseDeviceScreen, readDeviceScreen, sameDeviceScreen } from "../src/lib/device-screen";

/**
 * Each screen reports its size (migrations/085_device_screen.sql), so
 * Settings -> Devices can show it and a layout can be drawn for the size a
 * wall screen really has. #468 looked right at the sizes it was measured at
 * and far too big on the kitchen screen, whose size nobody knew.
 */

const good = { viewportWidth: 720, viewportHeight: 1232, screenWidth: 1080, screenHeight: 1920, pixelRatio: 1.5 };

test("a Windows screen at 150% reports its panel's pixels and the page's", () => {
  const s = readDeviceScreen({ innerWidth: 720, innerHeight: 1232, devicePixelRatio: 1.5, screen: { width: 720, height: 1280 } as Screen });
  expect(s).toEqual({ viewportWidth: 720, viewportHeight: 1232, screenWidth: 1080, screenHeight: 1920, pixelRatio: 1.5 });
});

test("the route takes whole pixels in range and a sane ratio, nothing else", () => {
  expect(parseDeviceScreen(good)).toEqual({ ok: true, screen: good });
  for (const bad of [
    null,
    "1080x1920",
    { ...good, viewportWidth: 0 },
    { ...good, screenHeight: 20001 },
    { ...good, viewportHeight: 1232.5 },
    { ...good, screenWidth: "1080" },
    { ...good, pixelRatio: 0 },
    { ...good, pixelRatio: 9 },
    { ...good, pixelRatio: Number.NaN },
  ]) {
    expect(parseDeviceScreen(bad).ok, JSON.stringify(bad)).toBe(false);
  }
});

test("only a changed size is sent again; the time it was sent does not count", () => {
  expect(sameDeviceScreen(good, { ...good, reportedAt: "2026-11-18T00:00:00Z" })).toBe(true);
  expect(sameDeviceScreen(good, { ...good, viewportHeight: 1280 })).toBe(false);
  expect(sameDeviceScreen(good, null)).toBe(false);
});

test("the route writes the session's own device, never one named in the request", () => {
  const src = readFileSync("src/app/api/screen/route.ts", "utf8");
  expect(src).toContain("const { familyId, deviceId } = auth.session;");
  expect(src).toMatch(/\.eq\("id", deviceId\)\s*\.eq\("family_id", familyId\)/);
});

test("the browser roles get no grant on the column", () => {
  const sql = readFileSync("docker/migrations/085_device_screen.sql", "utf8");
  expect(sql).not.toMatch(/^\s*GRANT/im);
});
