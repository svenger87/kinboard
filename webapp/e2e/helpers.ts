/**
 * Shared e2e helpers.
 *
 * `/join` (post v1.3.0 onboarding redesign, see docs/superpowers/plans/
 * 2026-06-*-redesign-*.md) opens on a welcome screen with two CTAs
 * ("Create a family space" / "Join with a code") rather than a bare code
 * form, and the join code itself is entered into a six-cell `CodeInput`
 * (one `<input maxLength=1>` per character, aria-labelled "Character N") —
 * see src/app/join/page.tsx and src/components/code-input.tsx.
 */

import { expect, type Page } from "@playwright/test";

// Locale-tolerant (EN/DE) — the suite doesn't pin a Playwright locale, and
// next-intl negotiates from the browser/OS. Anchored where a substring
// would risk matching the wrong control (e.g. "Join" also appears in the
// "Join family" tab label once a mode is chosen).
export const JOIN_CTA_RE = /^join with a code$|^mit code beitreten$/i;
export const REJOIN_RE = /sign back in|wieder einloggen/i;
const DEVICE_NAME_LABEL_RE = /^device name$|^gerätename$/i;
const SUBMIT_RE = /^(join|beitreten)$/i;

/**
 * Drives the `/join` flow to an authenticated dashboard, handling both
 * paths the welcome screen can present:
 *
 *   - Fresh device: welcome screen → "Join with a code" CTA → six-cell
 *     code input → (optional) device name → submit.
 *   - Recognized device: a "Sign back in" quick-rejoin offer appears
 *     instead of the welcome screen. This happens on every repeat run
 *     against the same stack — the device fingerprint (src/lib/device-id.ts
 *     `getDeviceFingerprint`) is derived from language/screen/timezone/
 *     hardwareConcurrency, all fixed by the Playwright project config, not
 *     from cookies/localStorage — so a fresh browser context still
 *     fingerprint-matches a device this suite registered on a prior run.
 *
 * No-ops if `page.goto("/join")` redirects away immediately (already
 * authenticated via a persisted device cookie).
 */
export async function joinFamilyViaUI(
  page: Page,
  familyCode: string,
  deviceName: string,
): Promise<void> {
  await page.goto("/join");
  if (!page.url().includes("/join")) return;

  const rejoinButton = page.getByRole("button", { name: REJOIN_RE });
  const joinCta = page.getByRole("button", { name: JOIN_CTA_RE });

  /*
    Poll for whichever button actually appears, rather than racing two waits and
    then taking one `isVisible` snapshot.

    `Promise.race` settles on the FIRST promise to finish — including a caught
    timeout — so the snapshot could be taken while the screen was still deciding
    which of the two it is. Landing on the wrong branch means clicking a button
    that never appears, and Playwright waits for it until the whole test times
    out. Observed as `locator.click: Test timeout of 60000ms exceeded` in a spec
    that has nothing to do with joining.

    Which button appears is not knowable in advance: the fingerprint match
    described above means a repeat run against the same stack gets Rejoin where
    a fresh one gets Join.
  */
  let screen: "rejoin" | "join" | null = null;
  await expect
    .poll(
      async () => {
        if (await rejoinButton.isVisible().catch(() => false)) return (screen = "rejoin");
        if (await joinCta.isVisible().catch(() => false)) return (screen = "join");
        return null;
      },
      { timeout: 20_000, message: "neither the join nor the rejoin button appeared" },
    )
    .not.toBeNull();

  if (screen === "rejoin") {
    await rejoinButton.click();
  } else {
    await joinCta.click();

    // Six-cell CodeInput: focus the first cell and type the code.
    // pressSequentially fires real key events, which the component relies
    // on for its per-cell auto-advance (each keystroke's onChange handler
    // both writes the char and moves focus to the next cell) — the same
    // path a real user's keyboard entry takes.
    const firstCell = page.getByRole("textbox", { name: "Character 1" });
    await firstCell.click();
    await firstCell.pressSequentially(familyCode, { delay: 20 });

    const deviceInput = page.getByLabel(DEVICE_NAME_LABEL_RE);
    if (await deviceInput.isVisible().catch(() => false)) {
      await deviceInput.fill(deviceName);
    }

    const submit = page.getByRole("button", { name: SUBMIT_RE });
    await submit.click();
  }

  await page.waitForURL((url) => !url.pathname.startsWith("/join"), {
    timeout: 15_000,
  });
}
