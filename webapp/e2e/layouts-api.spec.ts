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
