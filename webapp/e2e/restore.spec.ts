/**
 * Export -> import round trip e2e (Milestone D Task 4).
 *
 * Verifies the restore-from-backup path end to end at the API level:
 * GET /api/export for the demo family, POST that payload straight to
 * /api/import, and confirm the rebuilt family carries the same data —
 * then clean up the imported family so repeat runs don't accumulate
 * orphaned families on the target stack.
 *
 * API-level only (Playwright `request` fixture, no browser) — the join-page
 * UI wiring (src/app/join/page.tsx) is exercised by hand / in a future
 * Playwright UI pass; this spec locks down the server-side contract between
 * GET /api/export and POST /api/import that the UI depends on.
 *
 * Demo family id is fixed (webapp/docker/seed-demo.sql):
 *   00000000-0000-0000-0000-000000000001 (join code DEMO01)
 * The imported family's id is never hardcoded — it's read back from the
 * POST /api/import response, per src/app/api/import/route.ts's contract
 * ({ family_id, join_code, name, warnings }).
 *
 * Env contract:
 *   PLAYWRIGHT_BASE_URL — Kinboard webapp origin, e.g. http://localhost:3000
 *   (see playwright.config.ts — defaults to http://localhost:3000)
 *
 * Usage:
 *   PLAYWRIGHT_BASE_URL=http://localhost:3000 \
 *     npx playwright test e2e/restore.spec.ts --project=desktop
 */

import { test, expect } from "@playwright/test";

const DEMO_FAMILY_ID = "00000000-0000-0000-0000-000000000001";

// Table counts asserted to survive the round trip untouched (brief: events,
// recipes, people). Comparing raw array lengths is enough here — the import
// route's id-remapping correctness (FK resolution, skip/warning counting) is
// covered by its own unit-level self-review, not re-verified row-by-row here.
const COMPARED_TABLES = ["events", "recipes", "people"] as const;

test.describe("Restore from backup", () => {
  test("export -> import round trip rebuilds the family under a fresh join code", async ({
    request,
  }) => {
    const exportRes = await request.get(`/api/export?family_id=${DEMO_FAMILY_ID}`);
    test.skip(
      exportRes.status() === 404,
      "demo family not present on this stack — skipping restore round trip",
    );
    expect(exportRes.status(), "GET /api/export (demo family)").toBe(200);
    const exportBody = await exportRes.json();

    const importRes = await request.post("/api/import", { data: exportBody });
    expect(importRes.status(), "POST /api/import").toBe(200);
    const importBody: {
      family_id: string;
      join_code: string;
      name: string;
      warnings: string[];
    } = await importRes.json();

    expect(typeof importBody.family_id, "family_id is a string").toBe("string");
    expect(importBody.family_id, "imported family gets a fresh id").not.toBe(DEMO_FAMILY_ID);
    expect(typeof importBody.join_code, "join_code is a string").toBe("string");
    expect(Array.isArray(importBody.warnings), "warnings is an array").toBe(true);

    try {
      const reExportRes = await request.get(`/api/export?family_id=${importBody.family_id}`);
      expect(reExportRes.status(), "GET /api/export (restored family)").toBe(200);
      const reExportBody = await reExportRes.json();

      for (const table of COMPARED_TABLES) {
        const originalCount = exportBody.data[table]?.length ?? 0;
        const restoredCount = reExportBody.data[table]?.length ?? 0;
        expect(restoredCount, `data.${table} count matches the original export`).toBe(
          originalCount,
        );
      }
    } finally {
      const deleteRes = await request.delete("/api/family", {
        data: { family_id: importBody.family_id, confirm_name: importBody.name },
      });
      expect(deleteRes.status(), "DELETE /api/family cleanup").toBe(200);
    }
  });
});
