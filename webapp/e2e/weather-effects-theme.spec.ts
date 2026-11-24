import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";
import { effectPalette } from "../src/lib/weather-effects";
import { codeOnly } from "./source-helpers";

/**
 * The weather effects drawn on a canvas read on the backdrop they are drawn
 * on. Frost was drawn near-white on every theme: on the dark theme it showed,
 * on a light one (linen, #F7F5EF) it all but disappeared — 1.02:1 against the
 * page. A light backdrop now gets a cool blue-grey, a dark one keeps exactly
 * the colours it had. Screenshots of both: the frost PR's verification.
 */

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

type RGB = [number, number, number];
const rgb = (css: string): RGB => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css);
  if (!m) throw new Error(`not a colour: ${css}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};
const alpha = (css: string) => Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(css)?.[1] ?? 1);
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const hsl = (h: number, s: number, l: number): RGB => {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255)) as RGB;
};
const luminance = ([r, g, b]: RGB) => {
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};
const contrast = (a: RGB, b: RGB) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** A colour at `a` over `bg`. */
const over = (fg: RGB, a: number, bg: RGB): RGB => fg.map((v, i) => Math.round(v * a + bg[i] * (1 - a))) as RGB;

// The backdrops: linen, the default light background (globals.css :root) and
// the default dark one (.dark).
const LIGHT = { linen: hex("#F7F5EF"), default: hsl(38, 37, 88) };
const DARK = { default: hsl(28, 30, 10), black: [0, 0, 0] as RGB };

test("frost reads on a light backdrop: crystals and the rim at the edge", () => {
  const p = effectPalette(false);
  for (const [name, bg] of Object.entries(LIGHT)) {
    // The crystals are drawn at 35-80 % opacity; the faintest still has to show.
    expect(contrast(over(rgb(p.frostCrystal), 0.35, bg), bg), `crystals on ${name}`).toBeGreaterThan(1.4);
    expect(contrast(rgb(p.frostCrystal), bg), `crystals, solid, on ${name}`).toBeGreaterThanOrEqual(3);
    // The rim, at the very edge.
    const edge = p.frostRim[2];
    expect(contrast(over(rgb(edge), alpha(edge), bg), bg), `rim on ${name}`).toBeGreaterThan(1.25);
  }
});

test("frost on a dark backdrop keeps the colours it always had", () => {
  const p = effectPalette(true);
  expect(p.frostRim).toEqual(["rgba(215, 235, 255, 0)", "rgba(215, 235, 255, 0.10)", "rgba(225, 242, 255, 0.45)"]);
  expect(p.frostCrystal).toBe("rgb(240, 248, 255)");
  expect(p.frostGlow).toBe("rgba(190, 220, 255, 0.8)");
  for (const [name, bg] of Object.entries(DARK)) {
    expect(contrast(rgb(p.frostCrystal), bg), `crystals on ${name}`).toBeGreaterThanOrEqual(3);
  }
});

test("the light and dark frost differ, and stay cool (blue above red)", () => {
  const light = effectPalette(false);
  const dark = effectPalette(true);
  expect(light.frostCrystal).not.toBe(dark.frostCrystal);
  expect(light.frostRim).not.toEqual(dark.frostRim);
  for (const c of [light.frostCrystal, ...light.frostRim]) {
    const [r, , b] = rgb(c);
    expect(b, c).toBeGreaterThan(r);
  }
});

test("the moving effects read on a light backdrop too: rain, wind streaks, splashes, distant snow, mist", () => {
  const p = effectPalette(false);
  const d = effectPalette(true);
  for (const [name, bg] of Object.entries(LIGHT)) {
    expect(contrast(rgb(`rgb(${p.dropTip})`), bg), `drops on ${name}`).toBeGreaterThanOrEqual(2.5);
    expect(contrast(rgb(`rgb(${p.gust})`), bg), `wind on ${name}`).toBeGreaterThanOrEqual(2);
    expect(contrast(rgb(p.splash), bg), `splashes on ${name}`).toBeGreaterThanOrEqual(2.5);
    expect(contrast(rgb(`rgb(${p.speck})`), bg), `distant flakes on ${name}`).toBeGreaterThanOrEqual(1.8);
    expect(contrast(rgb(`rgb(${p.mist})`), bg), `mist on ${name}`).toBeGreaterThanOrEqual(1.3);
    // A white flake reads by its outline.
    expect(alpha(p.flakeShadow), `flake outline on ${name}`).toBeGreaterThan(alpha(d.flakeShadow));
  }
  // The dark theme's moving effects are as they were.
  expect(d).toMatchObject({ dropTop: "190, 215, 240", dropTip: "215, 235, 255", gust: "225, 232, 240", splash: "rgb(205, 225, 245)", speck: "255, 255, 255", mist: "215, 220, 228", flake: "rgba(255, 255, 255, 0.95)", flakeShadow: "rgba(40, 70, 110, 0.45)" });
});

test("the canvases follow the theme: they read it from <html> and redraw when it changes", () => {
  const overlay = codeOnly(read("src/components/weather-effects.tsx"));
  // One source for the backdrop: the app's dark class, or a photo under the screensaver.
  expect(overlay).toContain('document.documentElement.classList.contains("dark")');
  expect(overlay).toMatch(/new MutationObserver\([^)]*\)[\s\S]{0,200}attributeFilter: \["class"\]/);
  // Frost repaints with the palette of the backdrop it is on.
  expect(overlay).toMatch(/function FrostCanvas\(\{ strength, className, dark \}/);
  expect(overlay).toContain("const colours = effectPalette(dark);");
  expect(overlay).toMatch(/<FrostCanvas strength=\{strength\} dark=\{dark\}/);
  // The moving scene too.
  expect(overlay).toMatch(/weatherLayer\(canvas, ctx, effects, intensity, gust, dpr, effectPalette\(dark\)\)/);
  // A photo on the screensaver is a dark backdrop whatever the theme.
  expect(codeOnly(read("src/components/screensaver.tsx"))).toContain(
    '<WeatherEffects placement="screensaver" enabled={weatherEffects} onPhoto={Boolean(currentBlobUrl)} />',
  );
  // The fog's haze has a light-theme colour of its own.
  expect(read("src/app/globals.css")).toMatch(/\.weather-fog-light \{\s*background:/);
  expect(overlay).toContain(`const fogTone = dark ? "" : " weather-fog-light";`);
});
