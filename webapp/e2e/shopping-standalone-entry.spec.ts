import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The standalone shopping app at /einkaufen was reachable from exactly one
 * place: the install banner on /shopping. That banner sets a one-year
 * dismissal cookie, and /einkaufen is in NO_NAV_PATHS so it carries no
 * navigation of its own — so dismissing the banner once made the standalone
 * app unreachable for a year, with nothing to hint it existed.
 *
 * The route now has a permanent home in the page header, independent of
 * whether anyone wants the banner.
 */

const src = (...p: string[]) => readFileSync(join(__dirname, "..", "src", ...p), "utf8");
const shopping = src("app", "shopping", "page.tsx");

test("the shopping header links to the standalone app", () => {
  expect(shopping).toContain('href="/einkaufen"');
});

test("that link is a real navigation, not a client-side one", () => {
  // It must be a plain <a>, never next/link. Both iOS "Add to Home Screen" and
  // Chrome's install prompt decide what they are installing from the document
  // as it was loaded, and /einkaufen carries its own manifest scoped to itself.
  // Arriving there by client-side navigation left the browser still offering
  // the main app, scoped to "/", so people ended up with Kinboard on their home
  // screen when they had asked for the shopping list.
  const link = shopping.slice(shopping.indexOf('href="/einkaufen"') - 200);
  expect(link.slice(0, 260)).toContain('<a href="/einkaufen"');
  expect(shopping).not.toContain('<Link href="/einkaufen"');
});

test("that link is outside the dismissible banner", () => {
  // It must live in the header actions, not inside ShoppingInstallPrompt —
  // otherwise it inherits the same dismissal.
  const actions = shopping.slice(shopping.indexOf("actions={"), shopping.indexOf("<ShoppingInstallPrompt"));
  expect(actions).toContain('href="/einkaufen"');
});

test("it has an accessible name, not just an icon", () => {
  const link = shopping.slice(shopping.indexOf('href="/einkaufen"'));
  expect(link.slice(0, 260)).toContain("aria-label");
});

test("the label exists in all three languages", () => {
  for (const locale of ["en", "de", "fr"]) {
    const m = JSON.parse(readFileSync(join(__dirname, "..", "messages", `${locale}.json`), "utf8"));
    expect(m.components.shoppingPrompt.openStandalone, locale).toBeTruthy();
    expect(m.components.shoppingPrompt.openStandaloneAria, locale).toBeTruthy();
  }
});

test("the standalone page still offers a way back", () => {
  // Reaching it from the header must not be a one-way trip.
  expect(src("app", "einkaufen", "page.tsx")).toContain('<Link href="/"');
});

test("the banner's dismissal is still only the banner's", () => {
  // Dismissing the nudge is fine; it just must not take the route with it.
  const prompt = src("components", "shopping-install-prompt.tsx");
  expect(prompt).toContain("shopping-pwa-prompt-dismissed");
  expect(shopping).not.toContain("shopping-pwa-prompt-dismissed");
});
