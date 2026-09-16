import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { choosePhotoFit, aspectOf } from "../src/lib/photo-fit";

/**
 * RFC-009 §3.4. Every photo surface was `object-cover` — screensaver.tsx:569
 * and :579, photos-widget.tsx:111 inside a fixed aspect-[4/3]. On a 16:9 wall
 * panel that crops a portrait phone photo to its middle third, which is where
 * the faces are not.
 *
 * `cover` is still right most of the time: it fills the screen and a modest
 * crop costs nothing. It is only wrong when the photo and the screen disagree
 * badly about their shape.
 */

const LANDSCAPE_16_9 = 16 / 9;
const PORTRAIT_KIOSK = 9 / 16;

test("a landscape photo on a landscape screen fills it", () => {
  expect(choosePhotoFit(LANDSCAPE_16_9, LANDSCAPE_16_9)).toBe("cover");
});

test("a 4:3 photo on a 16:9 screen still fills it", () => {
  // Cropping 4:3 to 16:9 loses some sky and some floor. That is a normal
  // photograph on a normal television and must not get letterboxed.
  expect(choosePhotoFit(4 / 3, LANDSCAPE_16_9)).toBe("cover");
});

test("a portrait phone photo on a landscape panel is not cropped", () => {
  // The case from discussion #264's household: 3:4 or 9:16 out of a phone.
  expect(choosePhotoFit(3 / 4, LANDSCAPE_16_9)).toBe("contain");
  expect(choosePhotoFit(9 / 16, LANDSCAPE_16_9)).toBe("contain");
});

test("the same rule protects a landscape photo on a portrait kiosk", () => {
  // Kinboard runs on portrait wall panels too, where the mismatch inverts.
  expect(choosePhotoFit(LANDSCAPE_16_9, PORTRAIT_KIOSK)).toBe("contain");
  expect(choosePhotoFit(PORTRAIT_KIOSK, PORTRAIT_KIOSK)).toBe("cover");
});

test("a square photo is contained rather than half eaten", () => {
  // Covering 1:1 into 16:9 discards ~44% of the height.
  expect(choosePhotoFit(1, LANDSCAPE_16_9)).toBe("contain");
});

test("the decision is symmetric — neither shape is privileged", () => {
  const a = 3 / 4;
  const b = LANDSCAPE_16_9;
  expect(choosePhotoFit(a, b)).toBe(choosePhotoFit(b, a));
});

test("nonsense dimensions fall back to today's behaviour instead of guessing", () => {
  // Sources that cannot report a size (RFC-009 §3.4) must not be letterboxed
  // on the strength of a zero.
  expect(choosePhotoFit(0, LANDSCAPE_16_9)).toBe("cover");
  expect(choosePhotoFit(Number.NaN, LANDSCAPE_16_9)).toBe("cover");
  expect(choosePhotoFit(4 / 3, 0)).toBe("cover");
  expect(choosePhotoFit(Number.POSITIVE_INFINITY, LANDSCAPE_16_9)).toBe("cover");
});

test("aspectOf turns stored dimensions into a ratio, or null when it cannot", () => {
  expect(aspectOf(4032, 3024)).toBeCloseTo(4 / 3);
  expect(aspectOf(null, 3024)).toBeNull();
  expect(aspectOf(4032, 0)).toBeNull();
});

test.describe("wiring", () => {
  const widget = readFileSync("src/components/widgets/photos-widget.tsx", "utf8");
  const screensaver = readFileSync("src/components/screensaver.tsx", "utf8");

  test("neither surface crops unconditionally any more", () => {
    for (const [name, source] of [["widget", widget], ["screensaver", screensaver]] as const) {
      expect(
        source.includes("choosePhotoFit"),
        `${name} still picks its object-fit without consulting the photo's shape`,
      ).toBe(true);
    }
  });

  test("the alt text supplies the index its translation demands", () => {
    // `photoAria` is "Photo {index}". Called as tp("photoAria") it throws
    // IntlError: FORMATTING_ERROR and renders the raw ICU pattern as the alt
    // text. Every source whose photos carry no title hits it — Immich, and
    // the uploaded library, where a title has nowhere to come from.
    const call = widget.match(/tp\("photoAria"[^)]*\)/);
    expect(call, "could not find the photoAria call — did it move?").toBeTruthy();
    expect(
      call![0],
      "photoAria is called with no index, so every untitled photo logs an " +
        "IntlError and gets the raw pattern as its alt text",
    ).toContain("index");
  });

  test("the blurred backdrop stays out — eslint bans it on kiosk surfaces", () => {
    // The obvious treatment for a contained photo, and the reason RFC-009
    // §3.4 carries a correction. Compositing a full-screen blur for hours on
    // an ARM panel is what eslint.config.mjs exists to prevent.
    expect(screensaver).not.toMatch(/\bblur-(2xl|3xl)\b/);
    expect(screensaver).not.toMatch(/\bbackdrop-blur\b/);
  });
});
