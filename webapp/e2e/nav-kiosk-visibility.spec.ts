import { test, expect } from "@playwright/test";
import { canHideNavItem, effectiveHiddenNavItems } from "../src/lib/nav-visibility";

/**
 * Settings → Navigation lets a device switch nav items off, but Home,
 * Calendar, Shopping and Settings were locked on. A device marked as a kiosk
 * may now switch Calendar and Shopping off as well.
 *
 * canHideNavItem decides whether an item's switch is enabled.
 * effectiveHiddenNavItems is the hidden list every bar actually applies --
 * useHiddenNavItems returns it to both bottom bars and the settings page, and
 * the switch shows an item on whenever it is not in that list.
 */

test("a kiosk may switch Calendar and Shopping off, and other devices may not", () => {
  expect(canHideNavItem("/calendar", true)).toBe(true);
  expect(canHideNavItem("/shopping", true)).toBe(true);
  expect(canHideNavItem("/calendar", false)).toBe(false);
  expect(canHideNavItem("/shopping", false)).toBe(false);
});

test("Home and Settings stay on everywhere, so no device is left unrecoverable", () => {
  for (const isKiosk of [true, false]) {
    expect(canHideNavItem("/", isKiosk)).toBe(false);
    expect(canHideNavItem("/settings", isKiosk)).toBe(false);
    // Not even from a hand-edited list.
    expect(effectiveHiddenNavItems(["/", "/settings"], isKiosk)).toEqual([]);
  }
});

test("everything else can be switched off on any device, as before", () => {
  expect(canHideNavItem("/meals", false)).toBe(true);
  expect(effectiveHiddenNavItems(["/meals", "/photos"], false)).toEqual(["/meals", "/photos"]);
});

test("on a kiosk, the bars hide what was switched off", () => {
  expect(effectiveHiddenNavItems(["/calendar", "/shopping", "/meals"], true)).toEqual([
    "/calendar",
    "/shopping",
    "/meals",
  ]);
});

test("turning kiosk mode off brings Calendar back, with its switch on and locked", () => {
  // Switched off while the device was a kiosk. The list lives in the
  // browser and outlives the flag: this used to leave Calendar hidden and
  // its switch locked off, with no way to turn it back on.
  const stored = ["/calendar", "/meals"];
  const hidden = effectiveHiddenNavItems(stored, false);

  expect(hidden).toEqual(["/meals"]);
  // Not in the list, so its switch shows on; and locked, as the hint says.
  expect(hidden.includes("/calendar")).toBe(false);
  expect(canHideNavItem("/calendar", false)).toBe(false);
});

test("the kiosk's choice is kept, and applies again if kiosk mode comes back", () => {
  const stored = ["/calendar"];
  expect(effectiveHiddenNavItems(stored, false)).toEqual([]);
  expect(effectiveHiddenNavItems(stored, true)).toEqual(["/calendar"]);
});
