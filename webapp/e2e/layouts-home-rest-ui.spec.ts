import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { establishSession } from "./session";
import { dbContainer } from "./whole-database";

/**
 * The "rest" group of Home widgets in boxes (RFC-022 step 4), drawn on
 * /dev/home-rest-widgets against the stack: every widget at its minimum box
 * and in a large one, at text sizes S and XL, in the light and the dark
 * theme. In each box nothing reaches past the box's edge, no card overflows,
 * and every link and button on Home is at least 48px both ways (§3.3).
 *
 * In a family of its own, `claude-rfc022-s4r`, removed with its devices
 * afterwards. Home Assistant (the car, the speaker), the stock quote and the
 * photo are answered in the page (service worker blocked, each route counted).
 * Set HOME_REST_SHOTS to a directory to keep a screenshot of every case.
 * Run under `--project=desktop` and `--project=webkit`.
 */

test.skip(!process.env.FAMILY_CODE, "needs FAMILY_CODE: a running stack");

const ID = (n: string) => `c1a0de00-0224-4000-8000-00000000${n}`;
const FAMILY = ID("4a01");
const MIA = ID("4a11");
const BEN = ID("4a12");
const JOIN_CODE = "CLAUDES4RX";
const DEVICE = "claude-rfc022-s4r";

function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-tA", "-q", "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf8" },
  ).trim();
}

function purge() {
  psql(`SELECT set_config('kinboard.hard_delete', 'on', false);
    DELETE FROM devices WHERE family_id = '${FAMILY}' OR hardware_id LIKE '%${DEVICE}%';
    DELETE FROM families WHERE id = '${FAMILY}';
    DELETE FROM people WHERE id IN ('${MIA}', '${BEN}');`);
}

/** Lessons all day, every day, so a lesson is always running whenever the test runs. */
const SLOTS = JSON.stringify([
  { period: 1, start: "00:00", end: "05:59", subject: "Mathe", room: "A1" },
  { period: 2, start: "06:00", end: "11:59", subject: "Deutsch", room: "B2" },
  { period: 3, start: "12:00", end: "17:59", subject: "Englisch" },
  { period: 4, start: "18:00", end: "23:59", subject: "Sport" },
]);

test.beforeAll(() => {
  purge();
  psql(`INSERT INTO families (id, name, join_code, setup_completed) VALUES ('${FAMILY}', 'claude-rfc022-s4r', '${JOIN_CODE}', true);
    INSERT INTO people (id, family_id, name, is_child, color) VALUES
      ('${MIA}', '${FAMILY}', 'claude-rfc022-s4r-Mia', true, '#56B6E8'), ('${BEN}', '${FAMILY}', 'claude-rfc022-s4r-Ben', true, '#E85656');
    INSERT INTO creatures (person_id, family_id, species, style, enabled) VALUES
      ('${MIA}', '${FAMILY}', 'dragon', 'gumdrop', true), ('${BEN}', '${FAMILY}', 'princess', 'sticker', true);
    INSERT INTO pocket_money_accounts (family_id, person_id, balance_cents, weekly_allowance_cents) VALUES ('${FAMILY}', '${MIA}', 1234, 300);
    INSERT INTO schedules (family_id, person_id, day_of_week, time_slots)
      SELECT '${FAMILY}', '${MIA}', d, '${SLOTS}'::jsonb FROM generate_series(0, 6) d;
    INSERT INTO timers (family_id, label, duration_seconds, started_at) VALUES ('${FAMILY}', 'claude-rfc022-s4r pasta', 600, now());
    INSERT INTO timers (family_id, label, duration_seconds, started_at, paused_at, paused_seconds) VALUES ('${FAMILY}', 'claude-rfc022-s4r eggs', 300, now() - interval '1 minute', now(), 0);
    INSERT INTO vehicles (family_id, vendor, nickname, config) VALUES ('${FAMILY}', 'generic-ev', 'claude-rfc022-s4r car',
      '{"battery_level":"sensor.claude_s4r_battery","battery_range":"sensor.claude_s4r_range"}');
    INSERT INTO tickers (family_id, symbol, asset_type, nickname) VALUES ('${FAMILY}', 'AAPL', 'stock', 'Apple');
    INSERT INTO media_players (family_id, driver, nickname, config) VALUES ('${FAMILY}', 'home_assistant', 'Kitchen speaker', '{"entity_id":"media_player.claude_s4r"}');
    INSERT INTO settings (family_id, key, value) VALUES ('${FAMILY}', 'photo_source', '{"source":"upload"}');
    -- No screensaver over the widgets while a test waits.
    INSERT INTO settings (family_id, key, value) VALUES ('${FAMILY}', 'screensaver', '{"screensaverTimeout":0}');`);
});

test.afterAll(() => {
  purge();
  expect(psql(`SELECT count(*) FROM families WHERE id = '${FAMILY}'`)).toBe("0");
  expect(psql(`SELECT count(*) FROM devices WHERE hardware_id LIKE '%${DEVICE}%'`)).toBe("0");
});

const PHOTO = readFileSync(join(__dirname, "../../docs/wiki/images/kitchen-wall-mounted.jpg"));

/** Home Assistant, the quote and the photo, answered in the page; counts what was asked. */
async function stub(page: Page) {
  const hits = { ha: 0, states: 0, quote: 0, photos: 0 };
  await page.route(/\/api\/settings\?.*key=home_assistant/, (route) => {
    hits.ha++;
    return route.fulfill({ json: { value: { url: "http://ha.invalid", access_token: "x", dashboards: [] } } });
  });
  await page.route(/\/api\/homeassistant\/states\?/, (route) => {
    hits.states++;
    const ids = new URL(route.request().url()).searchParams.get("entity_ids")?.split(",") ?? [];
    const all: Record<string, unknown> = {
      "sensor.claude_s4r_battery": { entity_id: "sensor.claude_s4r_battery", state: "76", attributes: { unit_of_measurement: "%" } },
      "sensor.claude_s4r_range": { entity_id: "sensor.claude_s4r_range", state: "312", attributes: { unit_of_measurement: "km" } },
      "media_player.claude_s4r": {
        entity_id: "media_player.claude_s4r",
        state: "playing",
        attributes: {
          media_title: "A track with quite a long title",
          media_artist: "The Artists",
          media_position: 42,
          media_duration: 215,
          media_position_updated_at: new Date().toISOString(),
          volume_level: 0.4,
          is_volume_muted: false,
          supported_features: 0xffffff,
        },
      },
    };
    return route.fulfill({ json: { entities: ids.map((id) => all[id]).filter(Boolean) } });
  });
  await page.route(/\/api\/stonks\/quote\?/, (route) => {
    hits.quote++;
    return route.fulfill({
      json: { quotes: [{ symbol: "AAPL", shortName: "Apple", price: 231.47, change: 2.13, changePercent: 0.93, currency: "USD", marketState: "REGULAR", exchange: "NMS", asOf: new Date().toISOString() }] },
    });
  });
  await page.route(/\/api\/photos\?family_id=/, (route) => {
    hits.photos++;
    return route.fulfill({
      json: {
        photos: [{ id: "claude-s4r-photo", url: "/claude-s4r/photo.jpg", thumbnailUrl: "/claude-s4r/photo.jpg", width: null, height: null, takenAt: null, uploadedAt: new Date().toISOString(), byteSize: PHOTO.length }],
        totalBytes: PHOTO.length,
      },
    });
  });
  await page.route("**/claude-s4r/photo.jpg", (route) => route.fulfill({ body: PHOTO, contentType: "image/jpeg" }));
  return hits;
}

/** What breaks the box rule in each box: content past its edge, an overflowing card, a target under 48px. */
async function problems(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const box of Array.from(document.querySelectorAll<HTMLElement>("[data-layout-item]"))) {
      const name = box.dataset.layoutItem;
      const b = box.getBoundingClientRect();
      const inside = (r: DOMRect) => r.left >= b.left - 1 && r.top >= b.top - 1 && r.right <= b.right + 1 && r.bottom <= b.bottom + 1;
      // Hidden by an overflow ancestor inside the box (a preset on a wrapped line): not drawn, not a fault.
      const hiddenWithin = (el: Element) => {
        const r = el.getBoundingClientRect();
        for (let a = el.parentElement; a && a !== box; a = a.parentElement) {
          if (getComputedStyle(a).overflow === "visible") continue;
          const p = a.getBoundingClientRect();
          if (r.bottom <= p.top + 1 || r.top >= p.bottom - 1 || r.right <= p.left + 1 || r.left >= p.right - 1) return true;
        }
        return false;
      };
      for (const el of Array.from(box.querySelectorAll<HTMLElement>("*"))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const style = getComputedStyle(el);
        if (style.visibility === "hidden" || style.position === "fixed") continue;
        // Absolutely placed decorations (a festival hat, the birthday cake) may sit on an edge.
        if (el.closest("svg") && el.tagName.toLowerCase() !== "svg") continue;
        if (!inside(r) && !hiddenWithin(el)) {
          out.push(`${name}: <${el.tagName.toLowerCase()} ${el.className.toString().slice(0, 40)}> reaches past the box (${Math.round(r.left - b.left)},${Math.round(r.top - b.top)} ${Math.round(r.width)}x${Math.round(r.height)} in ${Math.round(b.width)}x${Math.round(b.height)})`);
        }
      }
      for (const el of Array.from(box.querySelectorAll<HTMLElement>("[data-fills-box]"))) {
        if (el.scrollHeight > el.clientHeight + 1) out.push(`${name}: card overflows by ${el.scrollHeight - el.clientHeight}px`);
      }
      for (const el of Array.from(box.querySelectorAll<HTMLElement>("a[href], button"))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || hiddenWithin(el) || getComputedStyle(el).visibility === "hidden") continue;
        if (r.width < 47.5 || r.height < 47.5) out.push(`${name}: target ${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 20)} is ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    return out;
  });
}

// The PWA's service worker answers fetches before page.route sees them.
test.use({ serviceWorkers: "block" });

const EXPECTED = ["weekOverview", "schedule", "vehicles", "stonks", "pocketMoney", "creatures", "photos", "timers", "media"];

for (const size of ["min", "large"] as const) {
  for (const text of ["S", "XL"] as const) {
    for (const theme of ["light", "dark"] as const) {
      test(`${size} boxes, text ${text}, ${theme}: nothing overflows, targets are 48px`, async ({ page }, info) => {
        test.setTimeout(300_000);
        await page.setViewportSize({ width: 1080, height: 1920 });
        await page.addInitScript((t) => {
          try {
            localStorage.setItem("theme", t);
          } catch {}
        }, theme);
        const hits = await stub(page);
        await establishSession(page, JOIN_CODE, DEVICE);
        await page.goto(`/dev/home-rest-widgets?size=${size}&text=${text}`, { waitUntil: "domcontentloaded" });
        const grid = page.getByTestId("home-rest-grid");
        await expect(grid).toBeVisible({ timeout: 90_000 });
        // The first visit of a run waits for the widgets' chunks and queries; the timers draw without any.
        await expect(page.getByTestId("home-timers")).toBeVisible({ timeout: 90_000 });
        // Every widget drew something real: the data has arrived. Soft, so the screenshot is taken either way.
        await expect.soft(page.getByTestId("home-media")).toBeVisible({ timeout: 20_000 });
        // The photo comes last on a first visit: the source setting, then the library, then the image.
        await expect.soft(page.getByTestId("home-photo")).toBeVisible({ timeout: 60_000 });
        await expect.soft(page.getByTestId("home-timer-row").first()).toBeVisible({ timeout: 20_000 });
        await expect.soft(page.getByTestId("home-creature-cell").first()).toBeVisible({ timeout: 20_000 });
        await expect.soft(page.getByTestId("home-pocket-money-child").first()).toBeVisible({ timeout: 20_000 });
        await expect.soft(page.getByTestId("home-schedule").locator("[data-box-header], [data-testid=schedule-now]").first()).toBeVisible({ timeout: 20_000 });
        await expect.soft(page.getByTestId("home-stonks")).toContainText("231", { timeout: 20_000 });
        await expect.soft(page.getByTestId("home-vehicles")).toContainText("76", { timeout: 20_000 });
        await expect.soft(page.getByTestId("week-day")).toHaveCount(7);
        await expect.soft(page.locator("html")).toHaveClass(new RegExp(theme));
        // Let the fitting settle (fonts, the photo, the last measurement).
        await page.waitForTimeout(1500);

        const dir = process.env.HOME_REST_SHOTS;
        if (dir) {
          mkdirSync(dir, { recursive: true });
          const engine = info.project.name;
          // The minimum boxes fill the top of the screen; the large ones most of it.
          await page.screenshot({ path: join(dir, `${engine}-${size}-${text}-${theme}.png`), clip: { x: 0, y: 0, width: 1080, height: size === "min" ? 760 : 1600 } });
        }
        const items = await page.locator("[data-layout-item]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.layoutItem));
        expect(items.sort()).toEqual([...EXPECTED].sort());
        const found = await problems(page);
        if (dir && found.length) writeFileSync(join(dir, `${info.project.name}-${size}-${text}-${theme}.txt`), found.join("\n"));
        expect(found).toEqual([]);
        expect(hits.states, "Home Assistant was never asked: the car and speaker are not under test").toBeGreaterThan(0);
        expect(hits.quote).toBeGreaterThan(0);
        expect(hits.photos).toBeGreaterThan(0);
      });
    }
  }
}
