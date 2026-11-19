import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source guards for the layout routes: each asks for a session, and each
 * mutating handler asks for the settings PIN. The behaviour is in
 * layouts-api-live.spec.ts.
 */

const ROOT = join(__dirname, "..", "src", "app", "api");
const FILES: Record<string, string[]> = {
  "layouts/route.ts": ["POST"],
  "layouts/[id]/route.ts": ["PATCH", "DELETE"],
  "layouts/[id]/duplicate/route.ts": ["POST"],
  "layouts/defaults/route.ts": ["PUT"],
  "devices/[id]/layout/route.ts": ["PUT"],
};

for (const [rel, methods] of Object.entries(FILES)) {
  test(`${rel} asks for a session and, to write, the settings PIN`, () => {
    const src = readFileSync(join(ROOT, rel), "utf8");
    expect(src).toContain("requireSession");
    for (const m of methods) {
      const start = src.indexOf(`export async function ${m}(`);
      expect(start, `${m} handler`).toBeGreaterThanOrEqual(0);
      const next = src.indexOf("export async function", start + 1);
      const body = src.slice(start, next === -1 ? undefined : next);
      expect(body, `${m} calls requireSettingsUnlock`).toContain("requireSettingsUnlock(");
    }
  });
}

test("GET /api/layouts needs a session only", () => {
  const src = readFileSync(join(ROOT, "layouts/route.ts"), "utf8");
  const start = src.indexOf("export async function GET(");
  const end = src.indexOf("export async function POST(");
  expect(start).toBeGreaterThanOrEqual(0);
  expect(src.slice(start, end)).not.toContain("requireSettingsUnlock");
});

test("the generic settings route leaves layout_defaults to /api/layouts/defaults", () => {
  const src = readFileSync(join(ROOT, "settings/route.ts"), "utf8");
  expect(src).toMatch(/\[SETTINGS_KEYS\.layoutDefaults\]: "\/api\/layouts\/defaults"/);
});

test("a family import does not restore layout_defaults: the layouts it names are not exported", () => {
  const src = readFileSync(join(ROOT, "import/route.ts"), "utf8");
  expect(src).toMatch(/dropSettingKeys: \[SETTINGS_KEYS\.layoutDefaults\]/);
  expect(src).toContain("tableSpec.dropSettingKeys?.includes(row.key)");
});

/** The handler's source, from its export to the next one. */
function handler(rel: string, m: string): string {
  const src = readFileSync(join(ROOT, rel), "utf8");
  const start = src.indexOf(`export async function ${m}(`);
  const next = src.indexOf("export async function", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

test("the writes check the grid marker right after the PIN and the body, before anything else", () => {
  for (const [rel, m] of [["layouts/route.ts", "POST"], ["layouts/[id]/route.ts", "PATCH"], ["layouts/[id]/duplicate/route.ts", "POST"]] as const) {
    const body = handler(rel, m);
    const check = body.indexOf("gridOk(body)");
    expect(check, `${rel} ${m}`).toBeGreaterThan(body.indexOf("readJson(request)"));
    expect(check, `${rel} ${m}`).toBeGreaterThan(body.indexOf("requireSettingsUnlock("));
    expect(body.indexOf("createAdminClient("), `${rel} ${m}`).toBeGreaterThan(check);
    expect(body.indexOf("fail(\"bad_name\")") === -1 || body.indexOf("fail(\"bad_name\")") > check, `${rel} ${m}`).toBe(true);
    expect(body, `${rel} ${m}`).toContain("gridChanged()");
  }
});

test("assigning and defaults refuse a layout row that is not on the grid", () => {
  for (const [rel, m] of [["layouts/defaults/route.ts", "PUT"], ["devices/[id]/layout/route.ts", "PUT"]] as const) {
    const body = handler(rel, m);
    expect(body, `${rel} ${m}`).toMatch(/\.select\("[^"]*\bgrid\b[^"]*"\)/);
    expect(body, `${rel} ${m}`).toContain("!== LAYOUT_GRID");
    expect(body, `${rel} ${m}`).toContain("gridChanged()");
  }
});
