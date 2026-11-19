import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "./source-helpers";

/**
 * The hooks that find the layout a screen shows. Source guards: there is no
 * React harness in this repo. No database needed.
 */
const SRC = join(__dirname, "..", "src");
const read = (p: string) => codeOnly(readFileSync(join(SRC, p), "utf8"));

test("realtime refetches layouts, device assignment included, on a change", () => {
  const src = read("hooks/use-realtime.ts");
  expect(src).toMatch(/\|\s*"layouts"/);
  expect(src).toMatch(/case "layouts":[\s\S]{0,200}queryKey:\s*\["layouts", family\.id\]/);
});

test("the device assignment query sits under the layouts prefix", () => {
  const src = read("hooks/use-layouts.ts");
  expect(src).toMatch(/\["layouts", familyId, "device", deviceId\]/);
  expect(src).toMatch(/export function useOwnDeviceLayout\(/);
  expect(src).toMatch(/is_kiosk/);
});

test("every layout mutation invalidates the layouts prefix, defaults also the settings", () => {
  const src = read("hooks/use-layouts.ts");
  for (const name of ["useSaveLayout", "useCreateLayout", "useDeleteLayout", "useDuplicateLayout", "useAssignLayout", "useSetLayoutDefaults"]) {
    expect(src, name).toContain(`export function ${name}(`);
  }
  expect(src).toMatch(/queryKey:\s*\["layouts", familyId\]/);
  expect(src).toMatch(/queryKey:\s*\["settings", familyId\]/);
  expect(src).toContain("LayoutRequestError");
  expect(src).toContain("relockSettings");
});

test("the layout defaults are a family setting", () => {
  expect(read("lib/settings-keys.ts")).toMatch(/layoutDefaults:\s*"layout_defaults"/);
  expect(read("hooks/use-layouts.ts")).toContain("SETTINGS_KEYS.layoutDefaults");
});

test("useActiveLayout resolves, rescales and listens for resizes", () => {
  const src = read("hooks/use-active-layout.ts");
  expect(src).toContain("resolveLayout(");
  expect(src).toContain("rescaleItems(");
  expect(src).toContain("gridFor(");
  expect(src).toMatch(/addEventListener\("resize"/);
  expect(src).toMatch(/removeEventListener\("resize"/);
});

test("the hooks are exported from the barrel", () => {
  const src = read("hooks/index.ts");
  expect(src).toContain("use-layouts");
  expect(src).toContain("use-active-layout");
});

test("create, save and duplicate send grid: LAYOUT_GRID, so the server can refuse an old bundle", () => {
  const src = read("hooks/use-layouts.ts");
  expect(src).toMatch(/import \{[^}]*LAYOUT_GRID[^}]*\} from "@\/lib\/layouts\/grid"/);
  for (const name of ["useSaveLayout", "useCreateLayout", "useDuplicateLayout"]) {
    const start = src.indexOf(`export function ${name}(`);
    expect(start, name).toBeGreaterThanOrEqual(0);
    const next = src.indexOf("export function", start + 1);
    expect(src.slice(start, next === -1 ? undefined : next), name).toContain("grid: LAYOUT_GRID");
  }
});

test("LAYOUT_GRID is the 48 columns of the grid", async () => {
  const { LAYOUT_GRID, GRID } = await import("../src/lib/layouts/grid");
  expect(LAYOUT_GRID).toBe(48);
  expect(LAYOUT_GRID).toBe(GRID.COLUMNS);
});
