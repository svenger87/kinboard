import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createTranslator } from "next-intl";
import { codeOnly } from "./source-helpers";
import { establishSession } from "./session";
import { dbContainer } from "./whole-database";

/** RFC-014 §5.4, §8 and plan ruling 27 for the sync section. */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const section = () => codeOnly(read("src/components/settings/school-holiday-sync-section.tsx"));

test("the section sits on Settings → Holidays, above the family's own card", () => {
  const page = codeOnly(read("src/app/settings/holidays/page.tsx"));
  expect(page.indexOf("<SchoolHolidaySyncSection")).toBeGreaterThan(-1);
  expect(page.indexOf("<SchoolHolidaySyncSection")).toBeLessThan(page.indexOf("<SchoolHolidaysCard"));
});

test("it is shown only where a sync can exist, and the switch waits for a chosen region", () => {
  const s = section();
  expect(s).toContain("!status.installEnabled || !status.covered");
  expect(s).toMatch(/disabled=\{[^}]*!status\.chosen/);
});

test("synced rows are read-only and carry the ODbL attribution", () => {
  const s = section();
  expect(s).toContain('data-testid="synced-holidays"');
  expect(s).toContain('title={t("odblTitle")}');
  // Whole words: useUpdateSchoolHolidaySync is the switch, not a row editor.
  for (const forbidden of ["useDeleteSchoolHoliday", "useUpdateSchoolHoliday", "Pencil"]) {
    expect(s, forbidden).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
  }
  // Raw source: codeOnly cuts a line at the "//" in "https://".
  const raw = read("src/components/settings/school-holiday-sync-section.tsx");
  expect(raw).toMatch(/^\s+oh: external\("https:\/\/www\.openholidaysapi\.org"\),$/m);
  expect(raw).toMatch(/^\s+odbl: external\("https:\/\/opendatacommons\.org\/licenses\/odbl\/1-0\/"\),$/m);
});

test("the ODbL line is §8's text in English, and present in every language", () => {
  const en = JSON.parse(read("messages/en.json")).settings.holidays.sync;
  expect(en.odbl).toBe(
    "Contains information from <oh>OpenHolidays API</oh>, which is made available here under the <odbl>Open Database License (ODbL)</odbl>.",
  );
  for (const lang of ["de", "fr"]) {
    const sync = JSON.parse(read(`messages/${lang}.json`)).settings.holidays.sync;
    expect(sync.odbl, lang).toMatch(/<oh>.+<\/oh>.*<odbl>.*Open Database License \(ODbL\).*<\/odbl>/);
    expect(sync.odblTitle, lang).toContain("Open Database License (ODbL)");
  }
});

test("the ODbL line renders both links in every language", () => {
  // The regex above passed while French rendered "de l'<oh>API OpenHolidays</oh>"
  // as text: in ICU an apostrophe before "<" quotes it, so the tags never
  // became links. Format the message the way the page does and count them.
  for (const locale of ["en", "de", "fr"]) {
    const messages = JSON.parse(read(`messages/${locale}.json`));
    const t = createTranslator({ locale, messages, namespace: "settings.holidays.sync" });
    const links: string[] = [];
    const text = t.rich("odbl", {
      oh: (chunks) => { links.push(`oh:${chunks}`); return ""; },
      odbl: (chunks) => { links.push(`odbl:${chunks}`); return ""; },
    });
    expect(links, locale).toEqual([expect.stringMatching(/^oh:.*OpenHolidays/), "odbl:Open Database License (ODbL)"]);
    expect(JSON.stringify(text), locale).not.toContain("<");
  }
});

test("client code reaches the sync only through its routes", () => {
  for (const file of ["src/components/settings/school-holiday-sync-section.tsx", "src/hooks/use-school-holiday-sync.ts"]) {
    const source = read(file);
    expect(source, file).not.toMatch(/^import (?!type)[^;]*from "@\/lib\/school-sync\//m);
  }
});

test("the region options are cached per country, not only per subdivision", () => {
  // Switching Germany → Netherlands kept serving Germany's Länder: both ask
  // with no subdivision, and the server answers for the family's country.
  const hook = codeOnly(read("src/hooks/use-school-holiday-sync.ts"));
  expect(hook).toContain('queryKey: schoolSyncKeys.options(family?.id ?? "", country, subdivision)');
  expect(hook).toMatch(/options: \(familyId: string, country: string \| null, subdivision: string \| null\) =>\s+\["school-region-options", familyId, country, subdivision\]/);
});

test("the demo has a chosen region and the sync on, so visitors see the attribution", () => {
  const seed = read("docker/seed-demo.sql");
  expect(seed).toContain(`'school_holiday_sync',`);
  expect(seed).toContain(`"enabled":true,"region":"DE-HH"`);
});

/*
  Rendered, against a running stack (FAMILY_CODE), with every source of the
  section stubbed: the sync status, the region options and the family's
  school_holidays rows. Nothing reaches OpenHolidays and nothing is written
  but this spec's own device row. Run it with --project=webkit and
  --project=mobile: three selects, long German names and a status line on a
  390 px phone.
*/
test.describe("rendered, with the routes stubbed", () => {
  const familyCode = process.env.FAMILY_CODE;
  test.skip(!familyCode, "Set FAMILY_CODE for the local stack");
  // The PWA service worker answers fetches before page.route sees them.
  test.use({ serviceWorkers: "block" });

  test.afterEach(() => {
    execFileSync(
      "docker",
      ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-c",
        "DELETE FROM devices WHERE hardware_id LIKE 'e2e-claude-school-sync-ui%'"],
      { encoding: "utf8" },
    );
  });

  const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

  test("the synced rows carry the ODbL title, the line links its sources, and it fits", async ({ page }) => {
    const hits = { status: 0, options: 0, rows: 0, refresh: 0 };
    const setting = {
      enabled: true, region: "CH-GR-ML", group: "CH-GR-VS", pending: null,
      last_success_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      last_error_at: new Date(Date.now() - 86_400_000).toISOString(),
      last_error: "timeout",
    };
    await page.route(/\/api\/school-holidays\/sync$/, async (route) => {
      if (route.request().method() === "POST") {
        hits.refresh++;
        expect(route.request().postDataJSON()).toEqual({});
        return route.fulfill({ json: { setting, outcome: { status: "rate-limited", retryAfterMs: 40_000 } } });
      }
      hits.status++;
      return route.fulfill({ json: { installEnabled: true, covered: true, chosen: true, setting } });
    });
    await page.route(/\/api\/school-holidays\/options/, (route) => {
      hits.options++;
      return route.fulfill({
        json: {
          subdivisions: [{ code: "CH-GR", name: "Graubünden" }, { code: "CH-ZH", name: "Zürich" }],
          children: [{ code: "CH-GR-ML", name: "Maloja" }, { code: "CH-GR-PL", name: "Plessur" }],
          groups: [{ code: "CH-GR-VS", name: "Volksschule und Kindergarten (öffentliche Schulen)" }],
        },
      });
    });
    const row = (id: number, name: string, from: number, to: number, source = "openholidays") => ({
      id: `00000000-0000-4000-8000-00000000000${id}`, family_id: "x", name, starts_on: iso(from), ends_on: iso(to),
      source, external_id: source === "manual" ? null : `oh-${id}`, hidden: false, synced_at: null,
      created_at: iso(0), updated_at: iso(0),
    });
    await page.route(/\/rest\/v1\/school_holidays/, (route) => {
      hits.rows++;
      return route.fulfill({
        json: [
          row(1, "Brückentage zu Christi Himmelfahrt und Zusätzlicher Ferientag", 10, 12),
          row(2, "Weihnachtsferien", 80, 95),
          row(3, "Long gone", -400, -380),
          { ...row(4, "Hidden by the family", 30, 31), hidden: true },
          row(5, "claude-manual", 40, 45, "manual"),
        ],
      });
    });

    await establishSession(page, familyCode!, "claude-school-sync-ui");
    await page.goto("/settings/holidays", { waitUntil: "domcontentloaded" });

    const synced = page.getByTestId("synced-holidays").locator("li");
    await expect(synced).toHaveCount(2, { timeout: 20_000 });
    for (const li of await synced.all()) {
      await expect(li).toHaveAttribute("title", /Open Database License \(ODbL\)/);
      expect(await li.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    }
    // Read-only: no buttons on a synced row; the manual row is not listed here.
    await expect(page.getByTestId("synced-holidays").getByRole("button")).toHaveCount(0);
    await expect(page.getByTestId("synced-holidays")).not.toContainText("claude-manual");

    await expect(page.locator("#school-sync-switch")).toBeChecked();
    for (const id of ["#school-sync-region", "#school-sync-child", "#school-sync-group"]) await expect(page.locator(id)).toBeVisible();
    await expect(page.locator("#school-sync-child")).toContainText("Maloja");
    await expect(page.getByRole("link", { name: /Open Database License/ })).toHaveAttribute(
      "href",
      "https://opendatacommons.org/licenses/odbl/1-0/",
    );
    await expect(page.getByRole("link", { name: /OpenHolidays API/ })).toHaveAttribute("href", "https://www.openholidaysapi.org");

    // At a phone width the selects stack in one column; on a desktop they sit two abreast.
    const boxes = await Promise.all(
      ["#school-sync-region", "#school-sync-child", "#school-sync-group"].map((id) => page.locator(id).boundingBox()),
    );
    const width = page.viewportSize()!.width;
    if (width < 640) expect(new Set(boxes.map((b) => Math.round(b!.x))).size).toBe(1);
    else expect(Math.round(boxes[1]!.y)).toBe(Math.round(boxes[0]!.y));
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

    await page.getByRole("button", { name: /^(Refresh now|Jetzt aktualisieren|Actualiser)$/ }).click();
    await expect.poll(() => hits.refresh).toBe(1);
    for (const [name, n] of Object.entries(hits)) expect(n, name).toBeGreaterThan(0);
  });
});
