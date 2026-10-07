import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { establishSession } from "./session";
import { dbContainer } from "./whole-database";

/**
 * The shopping list fits a phone: nothing runs off the right edge, the group
 * counter ("2/3") is on screen, and a long name or amount stays inside its
 * card instead of being cut off.
 *
 * The bug this guards: /shopping wraps its list in a Radix ScrollArea, whose
 * content wrapper is `display: table`. A table is as wide as its content's
 * longest unbreakable line, so a `truncate` item name widened the whole list
 * to ~720px on every phone width, and `main`'s overflow-hidden clipped it —
 * the counters, the steppers and the end of every card were off screen, and
 * `document.documentElement.scrollWidth` still equalled the viewport. That is
 * why this measures elements, not the page's scrollWidth alone.
 *
 * Only psql and the app, so CI runs it under WebKit too (e2e.yml). In a
 * family of its own, `claude-shop-layout`, removed with its devices afterwards.
 */

test.skip(!process.env.FAMILY_CODE, "needs FAMILY_CODE: a running stack");

const FAMILY = "c1a0de00-0219-4000-8000-00000000f001";
const JOIN_CODE = "CLAUDESHLY";
const DEVICE = "claude-shop-layout";
// One German compound with no break opportunity, and an amount that #387's
// merge produces when the same thing is added twice in different units.
const LONG_NAME = "Donaudampfschifffahrtsgesellschaftskapitänsmütze";
const LONG_AMOUNT_UNIT = "Stück + 1 Packung + 500 ml";

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
    DELETE FROM shopping_items WHERE family_id = '${FAMILY}';
    DELETE FROM families WHERE id = '${FAMILY}';`);
}

test.beforeAll(() => {
  purge();
  psql(`INSERT INTO families (id, name, join_code, setup_completed) VALUES ('${FAMILY}', 'claude-shop-layout', '${JOIN_CODE}', true);
    INSERT INTO shopping_items (family_id, name, category, quantity, unit, checked) VALUES
      ('${FAMILY}', '${LONG_NAME}', 'milchprodukte', 2, '${LONG_AMOUNT_UNIT}', false),
      ('${FAMILY}', 'Hafermilch Barista Edition ungesüßt und laktosefrei', 'milchprodukte', 3, 'Stück + 2 Packungen', false),
      ('${FAMILY}', 'Milk', 'milchprodukte', 2, 'L', true);`);
});

test.afterAll(() => {
  purge();
  expect(psql(`SELECT count(*) FROM families WHERE id = '${FAMILY}'`)).toBe("0");
  expect(psql(`SELECT count(*) FROM devices WHERE hardware_id LIKE '%${DEVICE}%'`)).toBe("0");
});

/**
 * Everything in `main` that ends past the viewport's right edge, leaving out
 * what sits inside a container that scrolls sideways on purpose.
 */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const scrollsSideways = (el: Element) => {
      for (let a = el.parentElement; a; a = a.parentElement) {
        const ox = getComputedStyle(a).overflowX;
        if ((ox === "auto" || ox === "scroll") && a.scrollWidth > a.clientWidth) return true;
      }
      return false;
    };
    const past = [...document.querySelectorAll("main *")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > vw + 1 && !scrollsSideways(el);
      })
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 50)} right=${Math.round(el.getBoundingClientRect().right)}`);
    return { vw, scrollWidth: document.documentElement.scrollWidth, past };
  });
}

/** How far each element runs past the right edge of its item card (px). */
async function textOutsideCard(page: Page, cardSel: string, textSel: string) {
  return page.locator(cardSel).evaluateAll(
    (cards, textSel) =>
      cards.flatMap((card) => {
        const cr = card.getBoundingClientRect();
        // The amount is rendered twice on /shopping (under the name on a
        // phone, beside it from sm up); only the one on screen counts.
        return [...card.querySelectorAll(textSel)].filter((el) => el.getClientRects().length > 0).map((el) => {
          const r = el.getBoundingClientRect();
          // Clipped text (truncate) is text the reader cannot see either.
          const clipped = el.scrollWidth - el.clientWidth;
          return {
            text: (el.textContent ?? "").trim().slice(0, 30),
            pastCard: Math.round(r.right - cr.right),
            clipped,
          };
        });
      }),
    textSel,
  );
}

/**
 * For each item on /shopping: its card (the box drawn around the name — the
 * nearest ancestor with a border), how much of the list's width it takes, and
 * which edges of the stepper and the menu lie outside it.
 */
async function card(page: Page) {
  return page.getByTestId("shopping-item").evaluateAll((rows) =>
    rows.map((row) => {
      const name = row.querySelector('[data-testid="shopping-item-name"]')!;
      let box: Element | null = name;
      while (box && box !== row.parentElement && parseFloat(getComputedStyle(box).borderTopWidth) === 0) {
        box = box.parentElement;
      }
      const cr = (box ?? row).getBoundingClientRect();
      const list = row.parentElement!.getBoundingClientRect();
      const outside = (sel: string) => {
        const el = row.querySelector(sel);
        if (!el) return ["missing"];
        const r = el.getBoundingClientRect();
        const out: string[] = [];
        if (r.left < cr.left - 1) out.push(`left ${Math.round(cr.left - r.left)}px`);
        if (r.right > cr.right + 1) out.push(`right ${Math.round(r.right - cr.right)}px`);
        if (r.top < cr.top - 1) out.push(`top ${Math.round(cr.top - r.top)}px`);
        if (r.bottom > cr.bottom + 1) out.push(`bottom ${Math.round(r.bottom - cr.bottom)}px`);
        return out;
      };
      const size = (el: Element | null) => {
        const r = el?.getBoundingClientRect();
        return r ? Math.round(Math.min(r.width, r.height)) : 0;
      };
      const stepper = row.querySelector('[data-testid="shopping-item-stepper"]');
      const buttons = stepper ? [...stepper.querySelectorAll("button")] : [];
      return {
        name: (name.textContent ?? "").slice(0, 30),
        cardShare: Math.round((cr.width / list.width) * 100),
        stepperOutside: outside('[data-testid="shopping-item-stepper"]'),
        menuOutside: outside('[data-testid="shopping-item-menu"]'),
        targets: {
          "−": size(buttons[0] ?? null),
          "+": size(buttons[1] ?? null),
          "⋮": size(row.querySelector('[data-testid="shopping-item-menu"]')),
        },
      };
    }),
  );
}

for (const width of [360, 402]) {
  test.describe(`at ${width}px`, () => {
    test.use({ serviceWorkers: "block", viewport: { width, height: 860 } });

    test("/shopping stays on screen: no overflow, counter visible, text inside its card", async ({ page }) => {
      test.setTimeout(120_000);
      await establishSession(page, JOIN_CODE, DEVICE);
      await page.goto("/shopping", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("shopping-item-name").filter({ hasText: LONG_NAME })).toBeVisible({ timeout: 60_000 });
      // The list fades and slides in; measure where it lands.
      await page.waitForTimeout(1500);

      const o = await overflow(page);
      expect.soft(o.scrollWidth, "the page scrolls sideways").toBeLessThanOrEqual(o.vw);
      expect.soft(o.past, `elements run past the ${o.vw}px viewport`).toEqual([]);

      const counter = page.getByTestId("shopping-group-count");
      await expect(counter).toHaveText("2/3");
      const c = (await counter.boundingBox())!;
      expect.soft(c.x, "the counter starts off screen").toBeGreaterThanOrEqual(0);
      expect.soft(c.x + c.width, "the counter ends past the viewport").toBeLessThanOrEqual(width);

      const text = await textOutsideCard(
        page,
        '[data-testid="shopping-item"]',
        '[data-testid="shopping-item-name"], [data-testid="shopping-item-quantity"]',
      );
      // three names, three amounts: a selector that matched nothing cannot pass
      expect(text.length).toBe(6);
      for (const t of text) {
        expect.soft(t.pastCard, `"${t.text}" runs past its card`).toBeLessThanOrEqual(1);
        expect.soft(t.clipped, `"${t.text}" is cut off`).toBeLessThanOrEqual(1);
      }
      await expect(
        page.getByTestId("shopping-item-quantity").filter({ hasText: LONG_AMOUNT_UNIT, visible: true }),
      ).toBeVisible();

      // The card takes the row, and the stepper and the menu are in it. Before
      // this the card was ~55% of the row and the stepper and ⋮ stood beside
      // it in a column of their own, so a long name wrapped over four lines
      // next to 40% of empty-looking width.
      const rows = await card(page);
      expect(rows).toHaveLength(3);
      for (const r of rows) {
        expect.soft(r.cardShare, `"${r.name}": the card is ${r.cardShare}% of the list`).toBeGreaterThanOrEqual(85);
        expect.soft(r.stepperOutside, `"${r.name}": the stepper sits outside its card`).toEqual([]);
        expect.soft(r.menuOutside, `"${r.name}": the ⋮ menu sits outside its card`).toEqual([]);
        // a thumb, not a cursor: 44px
        for (const [what, size] of Object.entries(r.targets)) {
          expect.soft(size, `"${r.name}": ${what} is ${size}px`).toBeGreaterThanOrEqual(44);
        }
      }
    });

    test("/einkaufen stays on screen and shows the whole name and amount", async ({ page }) => {
      test.setTimeout(120_000);
      await establishSession(page, JOIN_CODE, DEVICE);
      await page.goto("/einkaufen", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("einkaufen-item-name").filter({ hasText: LONG_NAME })).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(1500);

      const o = await overflow(page);
      expect.soft(o.scrollWidth, "the page scrolls sideways").toBeLessThanOrEqual(o.vw);
      expect.soft(o.past, `elements run past the ${o.vw}px viewport`).toEqual([]);

      const text = await textOutsideCard(
        page,
        "main",
        '[data-testid="einkaufen-item-name"], [data-testid="einkaufen-item-quantity"]',
      );
      // the two open items' names and amounts (done items are listed apart)
      expect(text.length).toBeGreaterThanOrEqual(4);
      for (const t of text) {
        expect.soft(t.pastCard, `"${t.text}" runs past the screen`).toBeLessThanOrEqual(1);
        expect.soft(t.clipped, `"${t.text}" is cut off`).toBeLessThanOrEqual(1);
      }
    });
  });
}
