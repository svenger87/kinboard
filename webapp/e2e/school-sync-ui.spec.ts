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
  expect(s).toContain("if (status.installEnabled && !status.covered) return null;");
  expect(s).toMatch(/disabled=\{[^}]*!status\.chosen/);
});

test("with the install switched off, rows fetched before stay visible, attributed and removable (final review #3)", () => {
  const s = section();
  expect(s).toContain("if (!status.installEnabled && !anySynced) return null;");
  const off = s.slice(s.indexOf("if (!status.installEnabled) {"), s.indexOf("const regionGroups"));
  for (const part of ["{syncedList}", "{attribution}", "change({ enabled: false })"]) expect(off, part).toContain(part);
  // Nothing in it reaches OpenHolidays: no switch, no region, no Refresh.
  for (const part of ["<Switch", "<Select", 'change({})']) expect(off, part).not.toContain(part);
  // The route lets exactly that one change through, and fetches nothing for it.
  const route = codeOnly(read("src/app/api/school-holidays/sync/route.ts"));
  expect(route).toContain("change.enabled === false && change.region === undefined && change.group === undefined");
  const offBranch = route.slice(route.indexOf("if (!deps.installEnabled) {"), route.indexOf("const holiday = await"));
  expect(offBranch).toContain("if (!isSwitchOff(body.data)) {");
  expect(offBranch).toContain("deps.store.clear(familyId)");
  expect(offBranch).not.toMatch(/fetchIfReady|syncFamily|schoolRegionOptions/);
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

  // afterAll, not afterEach: establishSession replays the first join's cookies
  // for every later test, so deleting the device between tests signs them out.
  test.afterAll(() => {
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
    // An error newer than the last success is told after it, in the live region.
    await expect(page.getByRole("status").filter({ hasText: /OpenHolidays/ })).toHaveText(
      /^(Last updated .+ · couldn't reach OpenHolidays on .+|Zuletzt aktualisiert am .+ · OpenHolidays war am .+ nicht erreichbar|Mis à jour le .+ · OpenHolidays injoignable le .+)$/,
    );
    await expect(page.locator("#school-sync-switch")).toHaveAttribute("aria-describedby", "school-sync-description");
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
    // An empty body is Refresh now, so the refresh wording, not the after-a-pick one.
    await expect(page.getByText(/^(Just refreshed\. Try again in a minute\.|Gerade aktualisiert\. .+|Actualisé à l’instant\. .+|Actualisé à l'instant\. .+)$/)).toBeVisible();
    for (const [name, n] of Object.entries(hits)) expect(n, name).toBeGreaterThan(0);
  });

  test("with the install switched off, the rows fetched before are listed, attributed and can be removed", async ({ page }) => {
    const hits = { status: 0, rows: 0, remove: 0 };
    let removed = false;
    await page.route(/\/api\/school-holidays\/sync$/, async (route) => {
      if (route.request().method() === "POST") {
        hits.remove++;
        expect(route.request().postDataJSON()).toEqual({ enabled: false });
        removed = true;
        return route.fulfill({ json: { setting: null, outcome: { status: "skipped", reason: "install-off" } } });
      }
      hits.status++;
      return route.fulfill({
        json: {
          installEnabled: false, covered: true, chosen: true,
          setting: { enabled: true, region: "DE-NI", group: null, pending: null, last_success_at: null, last_error_at: null, last_error: null },
        },
      });
    });
    await page.route(/\/api\/school-holidays\/options/, () => { throw new Error("the options must not be asked for while the install is off"); });
    await page.route(/\/rest\/v1\/school_holidays/, (route) => {
      hits.rows++;
      const row = { id: "00000000-0000-4000-8000-000000000011", family_id: "x", name: "Herbstferien", starts_on: iso(10), ends_on: iso(20),
        source: "openholidays", external_id: "oh-11", hidden: false, synced_at: null, created_at: iso(0), updated_at: iso(0) };
      return route.fulfill({ json: removed ? [] : [row] });
    });
    await establishSession(page, familyCode!, "claude-school-sync-ui");
    await page.goto("/settings/holidays", { waitUntil: "domcontentloaded" });

    const card = page.getByTestId("school-sync-install-off");
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByTestId("synced-holidays").locator("li")).toHaveCount(1);
    await expect(card.getByTestId("synced-holidays").locator("li")).toHaveAttribute("title", /Open Database License \(ODbL\)/);
    await expect(card.getByRole("link", { name: /Open Database License/ })).toBeVisible();
    await expect(card.getByRole("switch")).toHaveCount(0);
    await expect(card.getByRole("combobox")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

    await card.getByRole("button", { name: /^(Remove fetched holidays|Abgerufene Ferien entfernen|Supprimer les vacances récupérées)$/ }).click();
    await expect.poll(() => hits.remove).toBe(1);
    // No synced row left: the card goes.
    await expect(card).toHaveCount(0, { timeout: 10_000 });
    for (const [name, n] of Object.entries(hits)) expect(n, name).toBeGreaterThan(0);
  });

  test("Dutch groups are holiday regions; Refresh waits for one", async ({ page }) => {
    const hits = { status: 0, options: 0 };
    await page.route(/\/api\/school-holidays\/sync$/, (route) => {
      hits.status++;
      return route.fulfill({
        json: {
          installEnabled: true, covered: true, chosen: true,
          setting: { enabled: true, region: "NL-GE", group: null, pending: "group", last_success_at: null, last_error_at: null, last_error: null },
        },
      });
    });
    await page.route(/\/api\/school-holidays\/options/, (route) => {
      hits.options++;
      return route.fulfill({
        json: {
          subdivisions: [{ code: "NL-GE", name: "Gelderland" }],
          children: [],
          groups: [{ code: "NL-MI", name: "Regio Midden" }, { code: "NL-NO", name: "Regio Noord" }, { code: "NL-ZU", name: "Regio Zuid" }],
        },
      });
    });
    await establishSession(page, familyCode!, "claude-school-sync-ui");
    await page.goto("/settings/holidays", { waitUntil: "domcontentloaded" });

    await expect(page.locator("#school-sync-group")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('label[for="school-sync-group"]')).toHaveText(/^(Holiday region|Ferienregion|Région de vacances)$/);
    await expect(page.getByRole("status").filter({ hasText: /holiday region|Ferienregion|région de vacances/ })).toHaveText(
      /^(Pick your holiday region to start\.|Wähle eure Ferienregion, um zu starten\.|Choisissez votre région de vacances pour commencer\.)$/,
    );
    await expect(page.getByRole("button", { name: /^(Refresh now|Jetzt aktualisieren|Actualiser)$/ })).toBeDisabled();
    for (const [name, n] of Object.entries(hits)) expect(n, name).toBeGreaterThan(0);
  });

  test("a failed options load says so instead of leaving the selects blank", async ({ page }) => {
    const hits = { status: 0, options: 0 };
    await page.route(/\/api\/school-holidays\/sync$/, (route) => {
      hits.status++;
      return route.fulfill({
        json: {
          installEnabled: true, covered: true, chosen: true,
          setting: { enabled: true, region: "DE-NI", group: null, pending: null, last_success_at: null, last_error_at: null, last_error: null },
        },
      });
    });
    await page.route(/\/api\/school-holidays\/options/, (route) => {
      hits.options++;
      return route.fulfill({ status: 502, json: { error: "unreachable", code: "openholidays_unreachable" } });
    });
    await establishSession(page, familyCode!, "claude-school-sync-ui");
    await page.goto("/settings/holidays", { waitUntil: "domcontentloaded" });

    // React Query retries a failed query three times with back-off (~7 s) before isError.
    await expect(page.getByTestId("school-sync-options-error")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("school-sync-options-error")).toHaveText(/OpenHolidays/);
    for (const [name, n] of Object.entries(hits)) expect(n, name).toBeGreaterThan(0);
  });
});
