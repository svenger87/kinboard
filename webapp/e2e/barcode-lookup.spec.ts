import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { codeOnly } from "./source-helpers";
import { barcodeCandidates, expandUpcE, isValidGtin, normalizeBarcode, parseBarcode } from "../src/lib/barcode/gtin";
import {
  OPEN_FACTS_DATABASES,
  OPEN_FACTS_USER_AGENT,
  categoryFor,
  lookupOpenFacts,
  openFactsUrl,
  parseOpenFacts,
} from "../src/lib/barcode/open-facts";

/**
 * The shopping list's barcode scanner, the parts without a browser: which
 * digits make a barcode (lib/barcode/gtin.ts), and the product lookup in
 * Open Food Facts and its sister databases (lib/barcode/open-facts.ts).
 * barcode-scanner-ui.spec.ts drives the dialog on a stack.
 */

test("barcodes: the check digit decides, UPC-A widens to 13 digits, UPC-E expands", () => {
  expect(isValidGtin("4006381333931")).toBe(true); // EAN-13
  expect(isValidGtin("4006381333932")).toBe(false); // one digit off
  expect(isValidGtin("96385074")).toBe(true); // EAN-8
  expect(isValidGtin("036000291452")).toBe(true); // UPC-A
  expect(isValidGtin("12345")).toBe(false);
  expect(isValidGtin("abcdefghijklm")).toBe(false);
  expect(normalizeBarcode("0 36000 29145 2")).toBe("0036000291452");
  // UPC-E 0 123456 5 stands for UPC-A 0 12345 00006 5.
  expect(expandUpcE("01234565")).toBe("0012345000065");
  expect(expandUpcE("21234565")).toBeNull(); // number system 2 isn't UPC-E
  expect(parseBarcode("4006381333931")).toBe("4006381333931");
  expect(parseBarcode("036000291452")).toBe("0036000291452");
  // Typed, 01234565 is an EAN-8 and a UPC-E at once: both are tried, EAN-8 first.
  expect(parseBarcode("01234565")).toBe("01234565");
  expect(barcodeCandidates("01234565")).toEqual(["01234565", "0012345000065"]);
  expect(barcodeCandidates("96385074")).toEqual(["96385074"]); // not a UPC-E (number system 9)
  expect(barcodeCandidates("4006381333931")).toEqual(["4006381333931"]);
  expect(barcodeCandidates("4006381333932")).toEqual([]);
  expect(parseBarcode("96385074")).toBe("96385074");
  expect(parseBarcode("4006381333932")).toBeNull();
  expect(parseBarcode("../../etc")).toBeNull();
});

const nutella = {
  status: 1,
  product: {
    code: "3017620422003",
    product_name: "Nutella",
    product_name_fr: "Nutella pâte à tartiner",
    brands: "Ferrero, Nutella",
    quantity: "400 g",
    image_url: "https://images.openfoodfacts.org/full.jpg",
    image_thumb_url: "https://images.openfoodfacts.org/thumb.jpg",
    categories_tags: ["en:breakfasts", "en:spreads", "en:sweet-spreads"],
  },
};

test("a product: named in the family's language where the database has it, first brand, our category", () => {
  const fr = parseOpenFacts(nutella, "fr", "food", "3017620422003")!;
  expect(fr).toMatchObject({ name: "Nutella pâte à tartiner", brand: "Ferrero", quantity: "400 g", category: "fruehstueck", database: "food" });
  expect(fr.thumbnail_url).toBe("https://images.openfoodfacts.org/thumb.jpg");
  // No name in German: the product's main name.
  expect(parseOpenFacts(nutella, "de", "food", "3017620422003")!.name).toBe("Nutella");
  // Nothing at all to call it, or no product: nothing.
  expect(parseOpenFacts({ status: 1, product: { code: "1" } }, "de", "food", "1")).toBeNull();
  expect(parseOpenFacts({ status: 0 }, "de", "food", "1")).toBeNull();
  expect(parseOpenFacts(null, "de", "food", "1")).toBeNull();
});

test("categories: food by its tags, the rest by the database it came from", () => {
  expect(categoryFor(["en:dairies", "en:cheeses"], "food")).toBe("milchprodukte");
  expect(categoryFor(["en:frozen-foods"], "food")).toBe("tiefkuehl");
  expect(categoryFor(["en:something-new"], "food")).toBe("sonstiges");
  expect(categoryFor(undefined, "food")).toBeNull();
  expect(categoryFor([], "beauty")).toBe("drogerie");
  expect(categoryFor(undefined, "petfood")).toBe("tierbedarf");
  expect(categoryFor(undefined, "products")).toBe("haushalt");
});

test("the request: the family's language, only the fields used, the barcode escaped, and Kinboard named", () => {
  const url = new URL(openFactsUrl("https://world.openfoodfacts.org", "4006381333931", "fr"));
  expect(url.pathname).toBe("/api/v2/product/4006381333931");
  expect(url.searchParams.get("lc")).toBe("fr");
  expect(url.searchParams.get("fields")).toContain("product_name_fr");
  expect(openFactsUrl("https://x", "1/2", "de")).toContain("/product/1%2F2?");
  expect(OPEN_FACTS_USER_AGENT).toMatch(/^Kinboard \(\+https:\/\/github\.com\/svenger87\/kinboard\)$/);
  expect(OPEN_FACTS_DATABASES.map((d) => d.id)).toEqual(["food", "beauty", "petfood", "products"]);
});

test("the lookup asks the databases in turn: a miss or a failure moves on, the first hit wins", async () => {
  const asked: string[] = [];
  const shampoo = { status: 1, product: { code: "3600523307432", product_name: "Shampoo", brands: "Elseve" } };
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    asked.push(new URL(url).host);
    expect((init?.headers as Record<string, string>)["User-Agent"]).toBe(OPEN_FACTS_USER_AGENT);
    if (url.includes("openfoodfacts")) return new Response(JSON.stringify({ status: 0 }), { status: 404 });
    if (url.includes("openbeautyfacts")) throw new Error("timeout");
    if (url.includes("openpetfoodfacts")) return new Response(JSON.stringify(shampoo), { status: 200 });
    throw new Error("asked too far");
  }) as typeof fetch;
  const found = await lookupOpenFacts("3600523307432", "de", fakeFetch);
  expect(asked).toEqual(["world.openfoodfacts.org", "world.openbeautyfacts.org", "world.openpetfoodfacts.org"]);
  expect(found).toMatchObject({ name: "Shampoo", brand: "Elseve", database: "petfood", category: "tierbedarf" });

  const nowhere = (async () => new Response(JSON.stringify({ status: 0 }), { status: 404 })) as typeof fetch;
  expect(await lookupOpenFacts("2999999999991", "de", nowhere)).toBeNull();
});

test("the family's catalog is its own: the scanner reads only its rows, a save writes only its rows", () => {
  const read = (file: string) => codeOnly(readFileSync(join(process.cwd(), file), "utf8"));
  const lookup = read("src/app/api/catalog/barcode/route.ts");
  expect(lookup).toContain('.eq("family_id", auth.session.familyId)');
  expect(lookup).not.toContain("family_id.is.null");
  const save = read("src/app/api/catalog/search/route.ts");
  const post = save.slice(save.indexOf("export async function POST"));
  expect(post).toContain("const ownFamily = auth.session.familyId;");
  expect(post).not.toContain("family_id.is.null");
  expect(post).not.toContain("family_id: family_id || null");
  expect(post).toContain('.eq("id", existing.id)\n        .eq("family_id", ownFamily)');
});
