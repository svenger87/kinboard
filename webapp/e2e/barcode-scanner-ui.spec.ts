import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { establishSession } from "./session";
import { dbContainer } from "./whole-database";

/**
 * The barcode scanner on the phone shopping page (/einkaufen), on a stack:
 * - typed digits: a wrong check digit is caught, a product the family knows
 *   is found and goes on the list with one tap;
 * - a photo: a drawn EAN-13 is read (by ZXing: headless Chromium on Linux has
 *   no BarcodeDetector, so this is the iPhone path) and looked up;
 * - a barcode no database knows: named once, it goes on the list and the
 *   family's catalog remembers it, so the next scan finds it by that name.
 * No camera here (headless): the dialog says so and offers the photo.
 *
 * In a family of its own, `claude-barcode`, removed with its devices afterwards.
 */

test.skip(!process.env.FAMILY_CODE, "needs FAMILY_CODE: a running stack");

const FAMILY = "c1a0de00-0219-4000-8000-00000000f0bc";
const JOIN_CODE = "CLAUDEBARC";
const DEVICE = "claude-barcode";
const KNOWN = "4006381333931";
// Restricted-circulation prefix 2: no database knows it (checked against all four).
const UNKNOWN = "2999999999991";
// A shared catalog row (family_id NULL) with a barcode: no family may read or change it.
const SHARED = "2012345678903";

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
    DELETE FROM item_catalog WHERE family_id = '${FAMILY}';
    DELETE FROM item_catalog WHERE family_id IS NULL AND name_normalized LIKE 'claude barcode shared%';
    DELETE FROM families WHERE id = '${FAMILY}';`);
}

test.beforeAll(() => {
  purge();
  psql(`INSERT INTO families (id, name, join_code, setup_completed) VALUES ('${FAMILY}', 'claude-barcode', '${JOIN_CODE}', true);
    INSERT INTO item_catalog (family_id, name, name_normalized, barcode, category, source)
      VALUES ('${FAMILY}', 'claude Testmilch', 'claude testmilch', '${KNOWN}', 'milchprodukte', 'custom');
    INSERT INTO item_catalog (family_id, name, name_normalized, barcode, category, source)
      VALUES (NULL, 'claude barcode shared', 'claude barcode shared', '${SHARED}', 'sonstiges', 'custom');`);
});

test.afterAll(() => {
  purge();
  expect(psql(`SELECT count(*) FROM families WHERE id = '${FAMILY}'`)).toBe("0");
  expect(psql(`SELECT count(*) FROM devices WHERE hardware_id LIKE '%${DEVICE}%'`)).toBe("0");
});

/** An EAN-13 drawn the way a package prints it, as a PNG. */
async function ean13Png(page: Page, code: string): Promise<Buffer> {
  const dataUrl = await page.evaluate((digits) => {
    const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
    const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
    const R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
    const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];
    const d = digits.split("").map(Number);
    let bits = "101";
    for (let i = 1; i <= 6; i++) bits += (PARITY[d[0]][i - 1] === "L" ? L : G)[d[i]];
    bits += "01010";
    for (let i = 7; i <= 12; i++) bits += R[d[i]];
    bits += "101";
    const unit = 4;
    const quiet = 12;
    const canvas = document.createElement("canvas");
    canvas.width = (bits.length + quiet * 2) * unit;
    canvas.height = 220;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000";
    [...bits].forEach((b, i) => {
      if (b === "1") ctx.fillRect((quiet + i) * unit, 20, unit, 180);
    });
    return canvas.toDataURL("image/png");
  }, code);
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

const listed = (name: string) =>
  psql(`SELECT count(*) FROM shopping_items WHERE family_id = '${FAMILY}' AND name = '${name.replace(/'/g, "''")}'`);

test.describe("the barcode scanner", () => {
  test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  test.describe.configure({ timeout: 120_000 });

  test("typed, photographed, and unknown-then-remembered", async ({ page, baseURL }) => {
    await page.context().addCookies([{ name: "NEXT_LOCALE", value: "en", url: baseURL ?? "http://localhost:3001" }]);
    await establishSession(page, JOIN_CODE, DEVICE);
    await page.goto("/einkaufen", { waitUntil: "domcontentloaded" });
    // The page may use the camera (Permissions-Policy camera=(self)); it used to be refused everywhere.
    expect(
      await page.evaluate(() => {
        const doc = document as Document & { featurePolicy?: { allowsFeature(f: string): boolean } };
        return doc.featurePolicy?.allowsFeature("camera") ?? true;
      }),
    ).toBe(true);

    await page.getByTestId("einkaufen-scan-barcode").click();
    const dialog = page.getByTestId("barcode-scanner");
    await expect(dialog).toBeVisible();
    // Headless: no camera to open. It says so (not "not allowed", which it isn't) and offers the photo.
    await expect(dialog.getByTestId("barcode-no-camera")).toHaveText(/No camera found on this device/, { timeout: 15_000 });

    // Typed: one digit off is caught before any lookup.
    const manual = dialog.getByTestId("barcode-manual");
    await manual.fill("4006381333932");
    await manual.press("Enter");
    await expect(dialog.getByText("That isn't a valid barcode")).toBeVisible();

    // Typed right: the family's own product, onto the list with one tap.
    await manual.fill(KNOWN);
    await manual.press("Enter");
    await expect(dialog.getByTestId("barcode-product-name")).toHaveText("claude Testmilch");
    await expect(dialog.getByText("From your family's own products")).toBeVisible();
    await dialog.getByTestId("barcode-add").click();
    await expect(dialog.getByTestId("barcode-added")).toContainText("claude Testmilch");
    await expect.poll(() => listed("claude Testmilch")).toBe("1");

    // A photo of it: read and looked up the same way.
    await dialog.getByTestId("barcode-photo").setInputFiles({ name: "barcode.png", mimeType: "image/png", buffer: await ean13Png(page, KNOWN) });
    await expect(dialog.getByTestId("barcode-product-name")).toHaveText("claude Testmilch", { timeout: 20_000 });
    await dialog.getByRole("button", { name: "Scan another" }).click();

    // Nobody knows it: named once, listed, and remembered for the family.
    await dialog.getByTestId("barcode-photo").setInputFiles({ name: "unknown.png", mimeType: "image/png", buffer: await ean13Png(page, UNKNOWN) });
    await expect(dialog.getByTestId("barcode-unknown")).toBeVisible({ timeout: 30_000 });
    await dialog.getByTestId("barcode-unknown-name").fill("claude Geheimsaft");
    await dialog.getByTestId("barcode-unknown-name").press("Enter");
    await expect(dialog.getByTestId("barcode-added")).toContainText("claude Geheimsaft");
    await expect.poll(() => listed("claude Geheimsaft")).toBe("1");
    await expect
      .poll(() => psql(`SELECT name FROM item_catalog WHERE family_id = '${FAMILY}' AND barcode = '${UNKNOWN}'`))
      .toBe("claude Geheimsaft");

    // The next scan of it finds the family's name.
    await manual.fill(UNKNOWN);
    await manual.press("Enter");
    await expect(dialog.getByTestId("barcode-product-name")).toHaveText("claude Geheimsaft");
    expect(psql(`SELECT count(*) FROM item_catalog WHERE family_id IS NULL AND barcode = '${UNKNOWN}'`)).toBe("0");
  });

  test("the catalog is the family's own: a shared row is neither read by the scanner nor changed by a save", async ({ page }) => {
    await establishSession(page, JOIN_CODE, DEVICE);
    await page.goto("/einkaufen", { waitUntil: "domcontentloaded" });
    const lookup = await page.evaluate(async (code) => (await fetch(`/api/catalog/barcode?barcode=${code}&lang=en`)).status, SHARED);
    // Not the shared row's name: the family doesn't know it, and neither does any database.
    expect(lookup).toBe(404);
    // A save naming the shared product, without family_id: the family gets its own row, the shared one stays as it was.
    const saved = await page.evaluate(async () => {
      const res = await fetch("/api/catalog/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "claude barcode shared", barcode: "4006381333931", category: "fleisch" }),
      });
      return res.status;
    });
    expect(saved).toBe(200);
    expect(psql(`SELECT barcode || '|' || category FROM item_catalog WHERE family_id IS NULL AND name_normalized = 'claude barcode shared'`)).toBe(`${SHARED}|sonstiges`);
    expect(psql(`SELECT count(*) FROM item_catalog WHERE family_id = '${FAMILY}' AND name_normalized = 'claude barcode shared'`)).toBe("1");
    expect(psql(`SELECT count(*) FROM item_catalog WHERE family_id IS NULL AND name_normalized LIKE 'claude barcode shared%'`)).toBe("1");
  });
});
