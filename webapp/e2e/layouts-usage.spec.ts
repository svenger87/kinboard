import { test, expect } from "@playwright/test";
import { fallbackAfterDelete, layoutUsage, type UsageDevice } from "../src/lib/layouts/usage";
import type { Layout, LayoutDefaults } from "../src/lib/layouts/types";

/**
 * Which screens Settings shows as using a layout: resolved for the size each
 * screen reported, so a layout of the other orientation is not counted, a
 * default only reaches wall screens, and a screen that reported no size
 * counts only for its own layout. Stack-free.
 */

const layout = (id: string, width: number, height: number): Layout => ({
  id,
  family_id: "f",
  name: id,
  width,
  height,
  grid: 48,
  home: [],
  screensaver: [],
  created_at: "",
  updated_at: "",
});
const PORTRAIT = layout("portrait", 1080, 1920);
const OTHER_PORTRAIT = layout("portrait2", 1080, 1920);
const LANDSCAPE = layout("landscape", 1920, 1080);
const LAYOUTS = [PORTRAIT, OTHER_PORTRAIT, LANDSCAPE];
const DEFAULTS: LayoutDefaults = { portrait: "portrait", landscape: null };

const device = (name: string, over: Partial<UsageDevice>): UsageDevice => ({
  id: name,
  name,
  is_kiosk: false,
  layout_id: null,
  screen: null,
  ...over,
});
const PORTRAIT_SCREEN = { viewportWidth: 1080, viewportHeight: 1920 };
const LANDSCAPE_SCREEN = { viewportWidth: 1280, viewportHeight: 800 };

const names = (ds: UsageDevice[]) => ds.map((d) => d.name);

test("a screen's own layout counts as assigned, a kiosk on the default as via default", () => {
  const own = device("own", { layout_id: "portrait2", screen: PORTRAIT_SCREEN });
  const kiosk = device("kiosk", { is_kiosk: true, screen: PORTRAIT_SCREEN });
  const u = layoutUsage([own, kiosk], LAYOUTS, DEFAULTS);
  expect(names(u.get("portrait2")!.assigned)).toEqual(["own"]);
  expect(names(u.get("portrait")!.viaDefault)).toEqual(["kiosk"]);
  expect(u.get("portrait")!.assigned).toEqual([]);
  expect(u.get("landscape")).toEqual({ assigned: [], viaDefault: [] });
});

test("an own layout of the other orientation is not counted; a kiosk then counts for the default", () => {
  const turned = device("turned", { layout_id: "portrait2", screen: LANDSCAPE_SCREEN });
  const turnedKiosk = device("turnedKiosk", { is_kiosk: true, layout_id: "landscape", screen: PORTRAIT_SCREEN });
  const u = layoutUsage([turned, turnedKiosk], LAYOUTS, DEFAULTS);
  expect(u.get("portrait2")!.assigned).toEqual([]);
  expect(u.get("landscape")!.assigned).toEqual([]);
  expect(names(u.get("portrait")!.viaDefault)).toEqual(["turnedKiosk"]);
});

test("a screen that is no kiosk ignores the defaults", () => {
  const desk = device("desk", { screen: PORTRAIT_SCREEN });
  const u = layoutUsage([desk], LAYOUTS, DEFAULTS);
  for (const use of u.values()) expect(use).toEqual({ assigned: [], viaDefault: [] });
});

test("without a reported size a screen counts only for its own layout", () => {
  const own = device("own", { layout_id: "landscape" });
  const kiosk = device("kiosk", { is_kiosk: true });
  const u = layoutUsage([own, kiosk], LAYOUTS, DEFAULTS);
  expect(names(u.get("landscape")!.assigned)).toEqual(["own"]);
  expect(u.get("portrait")).toEqual({ assigned: [], viaDefault: [] });
});

test("a screen too small for the grid shows no layout", () => {
  const phone = device("phone", { is_kiosk: true, layout_id: "portrait", screen: { viewportWidth: 390, viewportHeight: 844 } });
  const u = layoutUsage([phone], LAYOUTS, DEFAULTS);
  expect(u.get("portrait")).toEqual({ assigned: [], viaDefault: [] });
});

test("after a delete: a kiosk falls back to another default, others and the default's screens to built-in", () => {
  const kiosk = device("kiosk", { is_kiosk: true, layout_id: "portrait2", screen: PORTRAIT_SCREEN });
  const desk = device("desk", { layout_id: "portrait2", screen: PORTRAIT_SCREEN });
  expect(fallbackAfterDelete(kiosk, "portrait2", LAYOUTS, DEFAULTS)?.id).toBe("portrait");
  expect(fallbackAfterDelete(desk, "portrait2", LAYOUTS, DEFAULTS)).toBeNull();
  const onDefault = device("onDefault", { is_kiosk: true, screen: PORTRAIT_SCREEN });
  expect(fallbackAfterDelete(onDefault, "portrait", LAYOUTS, DEFAULTS)).toBeNull();
  // No reported size: taken as turned the way the deleted layout is.
  const unsized = device("unsized", { is_kiosk: true, layout_id: "portrait2" });
  expect(fallbackAfterDelete(unsized, "portrait2", LAYOUTS, DEFAULTS)?.id).toBe("portrait");
});
